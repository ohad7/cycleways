# Engine as an Importable Module — Implementation Plan

**Goal:** Make `route-manager.js` an importable CommonJS module (no `window`
global, no `<script>` tag); import it at the three call sites. Zero web-logic
change. See `plans/engine-importable-module/design.md`.

**Verification gates:** `npm test` (engine suite via `require` must stay green),
`npm run build` (Vite must resolve the import), `npm run test:smoke` (must match
the 39-pass/12-fail baseline — no new failures).

---

### Task 1: Baseline
- [ ] `npm test` → 9/9 + all JS green. STOP if red.
- [ ] Record current `grep -rn "window.RouteManager" src/ index.html` → 3 hits
      (App.jsx:350,373; FeaturedRoute.jsx:60) and the `<script src="route-manager.js">`
      at index.html:120.

### Task 2: Convert the engine to a clean CommonJS export
**File:** `route-manager.js` (trailing UMD block).
- [ ] Replace:
  ```js
  // Export for use in other files
  if (typeof window !== "undefined") {
    window.RouteManager = RouteManager;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = RouteManager;
  }
  ```
  with:
  ```js
  // Importable engine module: bundlers (Vite web, Metro RN) and Node tests
  // consume this via `import RouteManager from "./route-manager.js"` /
  // `require("./route-manager.js")`. No browser global.
  module.exports = RouteManager;
  ```
- [ ] `node tests/test-route-manager-snap.js` (a `require`-based test) → still passes.

### Task 3: Import the engine in App.jsx
**File:** `src/App.jsx`.
- [ ] Add near the top imports: `import RouteManager from "../route-manager.js";`
- [ ] Line ~350: `window.RouteManager,` → `RouteManager,`
- [ ] Line ~373: `window.RouteManager,` → `RouteManager,`

### Task 4: Import the engine in FeaturedRoute.jsx
**File:** `src/components/featured/FeaturedRoute.jsx`.
- [ ] Add to imports: `import RouteManager from "../../../route-manager.js";`
- [ ] Line ~60: `window.RouteManager,` → `RouteManager,`

### Task 5: Remove the script tag
**File:** `index.html`.
- [ ] Delete line ~120: `<script src="route-manager.js"></script>`.

### Task 6: Verify
- [ ] `grep -rn "window.RouteManager" src/ index.html` → 0 hits.
- [ ] `grep -n "route-manager.js" index.html` → 0 hits.
- [ ] `npm test` → still 9/9 + all JS green (engine `require` path intact).
- [ ] `npm run build` → succeeds (Vite resolves the CJS import). If it FAILS:
      fall back to ESM — change the engine to `export default RouteManager;` and
      migrate the Node tests (`require`/`createRequire`) to `import`; re-verify.
- [ ] `npm run test:smoke` → 39 pass / 12 fail (baseline), no NEW failures
      (especially the planner route-load/plan tests in `react-migration-smoke`).

### Task 7: Commit
- [ ] `git commit -m "refactor(engine): load route-manager as an importable module (drop window global)"`
