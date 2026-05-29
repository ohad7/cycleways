# Monorepo + `@cycleways/core` Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Branch `claude/iphone-app` — NO branch/checkout/reset operations.

**Goal:** Introduce an npm-workspaces monorepo with a `@cycleways/core` package holding the platform-agnostic shared modules; repoint the web app, tests, editor server, and scripts at it. Zero web behavior change.

**Architecture:** Root stays the web app + workspace manager. `packages/core` (`@cycleways/core`, ESM, subpath exports) holds the engine + routing + utils + data + `useCyclewaysApp` + platform (web impls) + relocated pure helpers. The web bundler (Vite) and a future Metro resolve the same package; Metro will later prefer `*.native.js` siblings.

**Tech Stack:** npm workspaces, Vite 7, Node 22, plain-Node assertion tests (`node tests/*.mjs`/`.js`), Playwright (desktop + mobile).

**Verification gates (run after each task that changes resolution):** `npm test` (9/9 + all JS), `npm run build`, and for structural milestones the dev-probe + `npm run test:smoke` (baseline 40 pass / 12 fail — no new failures). See `plans/monorepo-core-package/design.md`.

**Note:** This is a behavior-preserving restructure, not feature TDD — the "test" is the existing suite staying green before and after each move. Do not change any logic.

---

### Task 0: Baseline
- [ ] `npm test` → 9/9 + all JS green. STOP if red.
- [ ] `npm run build` → succeeds. Record both as the baseline.

---

### Task 1: Create the workspace skeleton (no code moved yet)

**Files:**
- Create: `packages/core/package.json`, `packages/core/src/index.js`
- Modify: `package.json` (root)

- [ ] **Step 1:** Create `packages/core/package.json`:
```json
{
  "name": "@cycleways/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.js",
    "./*": "./src/*",
    "./route-manager.js": "./route-manager.js"
  }
}
```
- [ ] **Step 2:** Create `packages/core/src/index.js` with a placeholder comment:
```js
// @cycleways/core — shared, platform-agnostic logic for the CycleWays web and
// React Native apps. Subpath imports: "@cycleways/core/routing/...",
// "@cycleways/core/utils/...", "@cycleways/core/app/useCyclewaysApp.js", etc.
export {};
```
- [ ] **Step 3:** In root `package.json`, add top-level `"workspaces": ["packages/*"]` and add `"@cycleways/core": "*"` to `"dependencies"`.
- [ ] **Step 4:** Run `npm install`. Expected: completes; `node_modules/@cycleways/core` exists as a symlink. Verify: `node -e "require('node:fs').realpathSync('node_modules/@cycleways/core')"` prints the `packages/core` path.
- [ ] **Step 5:** `npm test` and `npm run build` → still green (web doesn't import core yet).
- [ ] **Step 6:** Commit:
```bash
git add package.json package-lock.json packages/core/package.json packages/core/src/index.js
git commit -m "chore(monorepo): add npm workspace skeleton for @cycleways/core"
```

---

### Task 2: Boundary fix 1 — relocate `dataMarkerFeaturesFromSegments` out of the Mapbox layer

It is pure (segments → GeoJSON features) but lives in `src/map/mapLayers.product.js`; `useCyclewaysApp` and `FeaturedRoute` import it, which would drag the Mapbox graph into core. Move it to a standalone module now (still in web `src/` — it moves to core in Task 8).

**Files:**
- Create: `src/data/dataMarkers.js`
- Modify: `src/map/mapLayers.product.js`, `src/map/mapLayers.js` (barrel re-export), `src/app/useCyclewaysApp.js`, `src/components/featured/FeaturedRoute.jsx`

- [ ] **Step 1:** Read `dataMarkerFeaturesFromSegments` in `src/map/mapLayers.product.js`. Move the entire function (and any pure helper it uses that is not used elsewhere in that file) into new `src/data/dataMarkers.js` as `export function dataMarkerFeaturesFromSegments(segmentsData) { … }`. If it uses `getDistance`, import it there: `import { getDistance } from "../../utils/distance.js";`.
- [ ] **Step 2:** In `src/map/mapLayers.product.js`, delete the moved definition and instead `import { dataMarkerFeaturesFromSegments } from "../data/dataMarkers.js";` then `export { dataMarkerFeaturesFromSegments };` (so the existing barrel `mapLayers.js` still re-exports it for any web caller).
- [ ] **Step 3:** Point `src/app/useCyclewaysApp.js` and `src/components/featured/FeaturedRoute.jsx` at the new module: replace their `dataMarkerFeaturesFromSegments` import source with `../data/dataMarkers.js` (adjust relative depth per file).
- [ ] **Step 4:** `npm test` (esp. `tests/test-map-layers.mjs`, `tests/test-poi-types.mjs`) and `npm run build` → green.
- [ ] **Step 5:** Commit:
```bash
git add src/data/dataMarkers.js src/map/mapLayers.product.js src/map/mapLayers.js src/app/useCyclewaysApp.js src/components/featured/FeaturedRoute.jsx
git commit -m "refactor(map): move dataMarkerFeaturesFromSegments out of the Mapbox layer"
```

---

### Task 3: Boundary fix 2 — move `WELCOME_WIZARD_SKIP_FLAG` to a shared constant

The flag is defined in the web `WelcomeWizard.jsx` but read by `useCyclewaysApp`. Make it a standalone constant.

**Files:**
- Create: `src/data/welcomeFlags.js`
- Modify: `src/components/WelcomeWizard.jsx`, `src/app/useCyclewaysApp.js`

- [ ] **Step 1:** Create `src/data/welcomeFlags.js`:
```js
// Shared key for the "skip the welcome wizard" persisted flag.
export const WELCOME_WIZARD_SKIP_FLAG = "cycleways:skipWelcome";
```
- [ ] **Step 2:** In `src/components/WelcomeWizard.jsx`, replace the local `const SKIP_FLAG_KEY = "cycleways:skipWelcome";` with `import { WELCOME_WIZARD_SKIP_FLAG as SKIP_FLAG_KEY } from "../data/welcomeFlags.js";` and keep the existing `export const WELCOME_WIZARD_SKIP_FLAG = SKIP_FLAG_KEY;` (back-compat for any importer) OR re-export from the new module. Confirm the string value is unchanged (`cycleways:skipWelcome`).
- [ ] **Step 3:** In `src/app/useCyclewaysApp.js`, change the import of `WELCOME_WIZARD_SKIP_FLAG` from `../components/WelcomeWizard.jsx` to `../data/welcomeFlags.js`.
- [ ] **Step 4:** `npm test` and `npm run build` → green. Quick dev-probe optional (wizard gating reads this flag).
- [ ] **Step 5:** Commit:
```bash
git add src/data/welcomeFlags.js src/components/WelcomeWizard.jsx src/app/useCyclewaysApp.js
git commit -m "refactor(app): extract WELCOME_WIZARD_SKIP_FLAG to a shared constant"
```

---

### Task 4: Boundary fix 3 — treat analytics as a platform service

`utils/analytics.js` uses `window.location.hostname` + `gtag` → it is the web implementation of a platform service. Move it into the platform layer (still web `src/` for now).

**Files:**
- Create: `src/platform/analytics.js` (moved content)
- Modify: every importer of `utils/analytics.js` (grep first), `utils/analytics.js` (delete after move)

- [ ] **Step 1:** `grep -rn "utils/analytics" src/ tests/` to list importers.
- [ ] **Step 2:** Move `utils/analytics.js` → `src/platform/analytics.js` verbatim (`git mv utils/analytics.js src/platform/analytics.js`). Keep its exported function names unchanged.
- [ ] **Step 3:** Update every importer's path to `…/platform/analytics.js` (correct relative depth). For `tests/test-analytics-parity.mjs`, update its import too.
- [ ] **Step 4:** `npm test` (esp. `tests/test-analytics-parity.mjs`) and `npm run build` → green.
- [ ] **Step 5:** Commit:
```bash
git add -A
git commit -m "refactor(platform): move analytics into the platform layer (web impl)"
```

---

### Task 5: Boundary fix 4 — make `routeDirectionAnimator` core-safe

It has 2 platform touch points. Inspect and neutralize.

**Files:**
- Modify: `src/map/routeDirectionAnimator.js` (only if a touch point is DOM-bound)

- [ ] **Step 1:** `grep -nE "mapboxgl|window\.|document\.|requestAnimationFrame|cancelAnimationFrame|map\." src/map/routeDirectionAnimator.js`. Classify each hit.
- [ ] **Step 2:** If the only hits are `requestAnimationFrame`/`cancelAnimationFrame` (RN supports both as globals) → no change needed; record that. If a hit is `document.`/`window.` (other than rAF) → inject it (e.g. accept a `now = () => Date.now()` or scheduler param defaulting to the global) so the module has no hard DOM dependency. Do NOT change animation behavior.
- [ ] **Step 3:** `npm test` (`tests/test-route-direction-animator.mjs`) and `npm run build` → green.
- [ ] **Step 4:** Commit (skip if no change was needed):
```bash
git add src/map/routeDirectionAnimator.js
git commit -m "refactor(map): make routeDirectionAnimator free of hard DOM deps"
```

---

### Task 6: Move `featureFlags` config alongside the soon-to-move core

`src/config/featureFlags.js` is plain config the RN app needs; it will live in core. Stage it for the move (it has no web deps).

- [ ] **Step 1:** Confirm `src/config/featureFlags.js` imports nothing web-specific (`grep -nE "window|document|import" src/config/featureFlags.js`).
- [ ] No code change in this task — it moves in Task 8. (This task is a no-op checkpoint; delete it if the executor prefers, or fold the confirmation into Task 8.)

---

### Task 7: Inventory the shared set and its consumers (pre-move map)

No edits — produce the exact move map so Task 8 is mechanical.

- [ ] **Step 1:** Record the **modules that move into core** (final web paths → core paths):
  - `route-manager.js` → `packages/core/route-manager.js`
  - `src/routing/*` → `packages/core/src/routing/*`
  - `utils/*` (now without `analytics.js`) → `packages/core/src/utils/*`
  - `src/data/*` (catalog, mapAssets, poiTypes, dataMarkers, welcomeFlags) → `packages/core/src/data/*`
  - `src/platform/*` (location, storage, analytics) → `packages/core/src/platform/*`
  - `src/app/useCyclewaysApp.js` → `packages/core/src/app/useCyclewaysApp.js`
  - `src/map/routeDirectionAnimator.js` → `packages/core/src/domain/routeDirectionAnimator.js`
  - `src/config/featureFlags.js` → `packages/core/src/config/featureFlags.js`
- [ ] **Step 2:** `grep -rn "from \"\.\./\(routing\|utils\|data\|platform\|app\|config\)\|route-manager.js\|routeDirectionAnimator" src/ tests/ editor/ scripts/ vite.config.mjs` to enumerate every consumer import that must be repointed. Save the list.

---

### Task 8: The bulk move — relocate shared modules into core and repoint all consumers

Do this as one coherent change; verify with the full gates at the end. **Keep intra-core imports relative; repoint external (web/tests/editor/scripts) imports to `@cycleways/core/...`.**

**Files:** moves listed in Task 7; plus `vite.config.mjs`, `scripts/copy-static-assets.mjs`, `editor/server.mjs`, `scripts/inspect-base-route.mjs`, `scripts/compare-base-route-shards.mjs`, and the ~25 `tests/*` files + web `src/*` importers.

- [ ] **Step 1: Move the files** with `git mv` (preserves history), creating `packages/core/src/{routing,utils,data,platform,app,domain,config}` and `packages/core/route-manager.js`. Example:
  `git mv route-manager.js packages/core/route-manager.js`;
  `git mv src/routing packages/core/src/routing`; `git mv utils packages/core/src/utils` (then handle `utils/package.json` — delete it or fold into core); `git mv src/data packages/core/src/data`; `git mv src/platform packages/core/src/platform`; `mkdir -p packages/core/src/app && git mv src/app/useCyclewaysApp.js packages/core/src/app/useCyclewaysApp.js`; `mkdir -p packages/core/src/domain && git mv src/map/routeDirectionAnimator.js packages/core/src/domain/routeDirectionAnimator.js`; `mkdir -p packages/core/src/config && git mv src/config/featureFlags.js packages/core/src/config/featureFlags.js`.
  Note: `utils/package.json` declared `{"type":"module"}`; core's `package.json` already sets `"type":"module"`, so remove the now-redundant `packages/core/src/utils/package.json`.
- [ ] **Step 2: Fix intra-core relative imports.** Inside the moved files, paths between core modules must stay valid relative paths. Most already are (e.g. `routing/routeActions.js` importing `./routeReducer.js`, or `../../utils/distance.js`). The depth-sensitive ones to recheck: `useCyclewaysApp.js` (was `src/app/`, now `packages/core/src/app/`) imports of `../../route-manager.js` → now `../../../route-manager.js`; `../routing/*` → `../routing/*` (still one up from `app/`); `../data/*`, `../platform/*` → unchanged relative shape; `../map/routeDirectionAnimator.js` → `../domain/routeDirectionAnimator.js`; `../map/mapLayers.js` (dataMarkers already moved in Task 2, so this import is gone); `../components/WelcomeWizard.jsx` (skip flag moved in Task 3, so now `../data/welcomeFlags.js`); `../config/featureFlags.js` → `../config/featureFlags.js`. Run `npm run build` iteratively is NOT enough (web side); instead `node --input-type=module -e "import('@cycleways/core/app/useCyclewaysApp.js')"` will surface unresolved core-internal paths — but it pulls React; simpler: rely on the test suite + build to surface them. Fix every unresolved import reported.
- [ ] **Step 3: Repoint web consumers** (`src/**`): replace imports of the moved modules with `@cycleways/core/...`. Patterns: `from "../routing/X"`→`from "@cycleways/core/routing/X"`; `from "../../utils/X"`→`from "@cycleways/core/utils/X"`; `from "../data/X"`→`from "@cycleways/core/data/X"`; `from "../platform/X"`→`from "@cycleways/core/platform/X"`; `from "./app/useCyclewaysApp.js"`→`from "@cycleways/core/app/useCyclewaysApp.js"`; engine `from "../route-manager.js"`→`from "@cycleways/core/route-manager.js"`; `from "../map/routeDirectionAnimator.js"`→`from "@cycleways/core/domain/routeDirectionAnimator.js"`; `from "../config/featureFlags.js"`→`from "@cycleways/core/config/featureFlags.js"`. Use the Task-7 list to hit every site (App.jsx, main.jsx, map/*, components/*, pages/*, featured/*).
- [ ] **Step 4: Repoint tests** (`tests/**`): `require("../route-manager.js")`→`require("../packages/core/route-manager.js")`; `import … from "../src/routing/X"`/`"../utils/X"`/`"../src/data/X"`/`"../src/app/X"` → `from "@cycleways/core/routing/X"` etc. (the workspace symlink makes `@cycleways/core` resolvable to `node tests/*`). Keep `tests/test-map-layers.mjs` etc. that import web `src/map/*` pointing at `../src/map/*` (those stay web).
- [ ] **Step 5: Repoint editor + scripts:** `editor/server.mjs` two `resolve(repoRoot, "route-manager.js")` → `resolve(repoRoot, "packages/core/route-manager.js")`; `scripts/inspect-base-route.mjs` + `scripts/compare-base-route-shards.mjs` `require("../route-manager.js")` → `require("../packages/core/route-manager.js")` (and any `../src/routing`/`../utils` imports → `../packages/core/src/...` or `@cycleways/core/...`).
- [ ] **Step 6: Vite engine plugin:** in `vite.config.mjs`, change `routeManagerPath`/the transform match so it matches the engine at its new location — simplest: match `id.split("?")[0].endsWith("/route-manager.js")` instead of an absolute `resolve(repoRoot, "route-manager.js")`. Keep the rewrite logic identical.
- [ ] **Step 7: copy-static-assets:** remove `"route-manager.js"` from the copy list in `scripts/copy-static-assets.mjs` (the engine is bundled by Vite and no longer at root). Confirm nothing else in the list moved.
- [ ] **Step 8: Reinstall + resolve:** `npm install` (re-link workspace). Then `node -e "console.log(require('./packages/core/route-manager.js').name)"` → prints `RouteManager`.

---

### Task 9: Full verification of the move
- [ ] `grep -rn "from \"\.\./\(routing\|utils\|data\|platform\)\|route-manager.js" src/` → no stale web imports of the moved modules remain (only `@cycleways/core/...`). Investigate any hit.
- [ ] `npm test` → 9/9 + all JS green.
- [ ] `npm run build` → succeeds.
- [ ] Dev-probe: start `npm run dev -- --port 5188`; load `/?route=Bjjy1nRHHDArrNAoctqGv4RHL3un`; assert `#root` non-empty, route-description shows a `ק"מ` distance, zero page errors. (If `#root` empty → an unresolved/renamed import; fix.)
- [ ] `npm run test:smoke` → 40 pass / 12 fail (baseline); no NEW failures.
- [ ] Editor sanity: `node -e "const r=require('./packages/core/route-manager.js'); new r();" ` resolves (the editor server require path).

---

### Task 10: Commit the move
- [ ] Commit:
```bash
git add -A
git commit -m "refactor(monorepo): move shared modules into @cycleways/core and repoint consumers"
```

---

### Task 11: CI parity check
- [ ] Confirm `.github/workflows/ci.yml` and `pages.yml` still work with workspaces: they run `npm ci` (supports workspaces), then build/test/smoke (ci) and build/deploy (pages). No workflow edits expected; if `npm ci` needs the lockfile refreshed, the committed `package-lock.json` from Task 1/8 covers it. (No push required here — this is a local confirmation that the commands used by CI pass locally, already covered by Tasks 9.)

---

## Self-review notes (author)

- **Spec coverage:** workspace layout (T1), boundary fixes 1–4 (T2 dataMarkers, T3 skip-flag, T4 analytics→platform, T5 animator), featureFlags→core (T6/T8), import mechanism + exports map (T1, T8 S3), engine + Vite plugin path (T8 S6), tests/editor/scripts repoint (T8 S4–S5), copy-static-assets (T8 S7), CI/Pages (T11), full verification incl. dev-probe + smoke (T9). All design sections map to tasks.
- **Placeholder scan:** boundary-fix tasks include concrete code; the bulk move is a mechanical repoint specified by exact grep/replace patterns + a move map + verification gates (appropriate for a mass relocation — no hand-waved logic).
- **Consistency:** package name `@cycleways/core`, subpath `"./*": "./src/*"`, engine kept CommonJS at `packages/core/route-manager.js`, plugin matches `/route-manager.js`, flag value `cycleways:skipWelcome` — used consistently across tasks.
- **Risk:** the move is one large diff (T8); the dev-probe (fast) catches blank-page/import errors before the 8-min smoke. If T8 can't be made green, bisect by reverting the repoint of one consumer group at a time.
