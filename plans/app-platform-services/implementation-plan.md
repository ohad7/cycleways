# App Platform-Service Seams — Implementation Plan

**Goal:** Route App.jsx's (and WelcomeWizard's) `window.location` / `history` /
`localStorage` access through `src/platform/{location,storage}.js` web adapters.
Zero web behavior change. See `plans/app-platform-services/design.md`.

**Gates:** `npm test` 9/9 · `npm run build` · `npm run test:smoke` = baseline
(40 pass / 12 fail). Branch `claude/iphone-app` (no branch switching).

---

### Task 1: Baseline
- [ ] `npm test` → green. STOP if red.

### Task 2: Create the web platform adapters
- [ ] Create `src/platform/location.js`:
  ```js
  // Web implementation of the location/URL platform service. React Native will
  // provide a sibling `location.native.js` (deep-link params) — Metro resolves
  // `.native.js` automatically; no web change needed then.
  export function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }
  export function hasQueryParam(name) {
    return new URLSearchParams(window.location.search).has(name);
  }
  export function setUrlParam(name, value) {
    const url = new URL(window.location.href);
    if (value == null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    window.history.replaceState(null, "", url.toString());
  }
  export function removeUrlParam(name) {
    setUrlParam(name, null);
  }
  export function getShardLoaderLocation() {
    return window.location;
  }
  ```
- [ ] Create `src/platform/storage.js`:
  ```js
  // Web implementation of the key/value storage platform service. React Native
  // will provide a sibling `storage.native.js` (AsyncStorage-backed).
  export function getStoredItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  export function setStoredItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage can be unavailable in some privacy modes.
    }
  }
  ```

### Task 3: Route App.jsx through the adapters
**File:** `src/App.jsx`. Add imports:
```js
import {
  getQueryParam,
  hasQueryParam,
  setUrlParam,
  removeUrlParam,
  getShardLoaderLocation,
} from "./platform/location.js";
import { getStoredItem } from "./platform/storage.js";
```
Then replace (behavior-identical):
- [ ] `osmDebugLayerMode` init: `new URLSearchParams(window.location.search)` + `params.get("osmLayer")` → `getQueryParam("osmLayer") === "graph" ? "graph" : "ways"`.
- [ ] wizard init: `new URLSearchParams(window.location.search).has("route")` → `hasQueryParam("route")`; `localStorage.getItem(WELCOME_WIZARD_SKIP_FLAG)` → `getStoredItem(WELCOME_WIZARD_SKIP_FLAG)`.
- [ ] OSM debug effect (~L205): the `?osm`/`osmDebug` read → `hasQueryParam("osm") || hasQueryParam("osmDebug")` (match the existing condition exactly — read the current code and preserve its logic).
- [ ] restore (~L390): `new URLSearchParams(window.location.search).get("route")` → `getQueryParam("route")`.
- [ ] shard loader (2×, ~L358, ~L1109): `window.location` → `getShardLoaderLocation()`.
- [ ] `handleOsmDebugLayerModeChange` (~L475-481): replace the `new URL`/`replaceState` block with `setUrlParam("osmLayer", mode === "graph" ? "graph" : null)`.
- [ ] `clearRouteUrl` (~L526-530): `if (!hasQueryParam("route")) return; removeUrlParam("route");`.
- [ ] `routingShardFormat()` (~L1464): `new URLSearchParams(...).get("routingShardFormat")` → `getQueryParam("routingShardFormat")`.

### Task 4: Route WelcomeWizard.jsx storage writes
**File:** `src/components/WelcomeWizard.jsx`.
- [ ] Add `import { setStoredItem } from "../platform/storage.js";`
- [ ] Replace both `localStorage.setItem(SKIP_FLAG_KEY, "1")` → `setStoredItem(SKIP_FLAG_KEY, "1")`.

### Task 5: Verify
- [ ] `grep -nE "window\\.location|window\\.history|localStorage" src/App.jsx src/components/WelcomeWizard.jsx` → only the out-of-scope `setTimeout`/`keydown` (no `location`/`history`/`localStorage`) remain.
- [ ] `npm test` → 9/9 + all JS green.
- [ ] `npm run build` → succeeds.
- [ ] `npm run test:smoke` → 40 pass / 12 fail (baseline); no NEW failures
      (watch `react-migration-smoke:31` route-restore and `welcome-wizard:*`).

### Task 6: Commit
- [ ] `git commit -m "refactor(app): route browser location/storage through a platform-services layer"`
