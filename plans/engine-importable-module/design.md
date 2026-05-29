# Engine as an Importable Module — Design

**Date:** 2026-05-29
**Status:** Approved (proceed-to-implement authorized by user)
**Branch context:** continues `claude/iphone-app`

## Purpose

Next intermediate step toward a React Native iPhone app that shares most of the
React/JS code (see [[iphone-app-direction]] / `plans/map-surface-abstraction/`).
Make the routing **engine** (`route-manager.js`, ~3,000 lines — the single
biggest shared asset) consumable by a module bundler instead of a browser global,
**without changing any web logic.**

## Problem

Today the engine is delivered as a classic browser script:

- `index.html` loads `<script src="route-manager.js">`, which assigns
  `window.RouteManager = RouteManager`.
- The engine file also has `module.exports = RouteManager` (for Node tests via
  `require`).
- Three call sites read the global: `src/App.jsx:350`, `src/App.jsx:373`,
  `src/components/featured/FeaturedRoute.jsx:60` — each passes
  `window.RouteManager` into `createRouteManager(RouteManagerClass, …)` /
  `createShardedRouteSession(RouteManagerClass, …)` (the routing layer already
  takes the class as an injected parameter — a clean seam in `src/routing`).

RN's bundler (Metro) cannot consume a `window`-global `<script>`. So the engine
is currently un-importable off the web, blocking every later "share the JS" step.

## Decision: keep it CommonJS, import it

Convert `route-manager.js` into a **clean CommonJS module** — `module.exports =
RouteManager` only, dropping the `window` assignment — and `import` it at the
three call sites. Remove the `<script>` tag from `index.html`.

Rationale (chosen over a full ESM conversion):

- **Minimal churn, zero test changes.** All ~10 Node test files load the engine
  via `require("../route-manager.js")` (the `.mjs` ones through
  `createRequire`). A clean CommonJS module keeps every one of them working
  unchanged. A full ESM (`export default`) conversion would break `require` and
  force migrating those ~10 files.
- **Universally consumable.** Vite imports source CommonJS via its
  esbuild (dev) / Rollup-commonjs (build) interop; RN/Metro consumes CommonJS
  natively. `import RouteManager from "../route-manager.js"` yields the class on
  both.
- **Web-logic-neutral.** Same class, same behavior; only delivery changes (Vite
  bundles/hashes the engine instead of an unhashed global `<script>`). The
  `window.RouteManager` global and the script tag disappear.

A future full-ESM cleanup (and matching test migration) remains possible but is
out of scope here.

## Changes

1. `route-manager.js`: replace the trailing
   ```js
   if (typeof window !== "undefined") { window.RouteManager = RouteManager; }
   if (typeof module !== "undefined" && module.exports) { module.exports = RouteManager; }
   ```
   with an unconditional `module.exports = RouteManager;`. (Keep a comment.)
2. `index.html`: remove `<script src="route-manager.js"></script>`.
3. `src/App.jsx`: add `import RouteManager from "../route-manager.js";`; replace
   the two `window.RouteManager` reads (lines ~350, ~373) with `RouteManager`.
4. `src/components/featured/FeaturedRoute.jsx`: add
   `import RouteManager from "../../../route-manager.js";`; replace the
   `window.RouteManager` read (line ~60) with `RouteManager`.
5. No changes to `src/routing/*` (already parameterized), and **no test
   changes** (CommonJS `require` still resolves).

## Scope

**In:** the four file edits above. **Out:** full ESM migration, platform-service
seams in App.jsx (URL-sharing/storage/asset loading — the planned *next* step),
any RN code, any engine-logic change.

## Risks & verification

- **Risk: Vite source-CJS interop.** If `import` of the CommonJS engine fails in
  dev or build, fall back to a full ESM conversion (`export default RouteManager`)
  + migrate the ~10 Node tests to `import`. Decide based on actual build/test
  output.
- **Verification (zero behavior change):**
  - `npm test` — the engine test suite (`test-route-manager*`,
    `test-base-routing-*`, `test-gpx-parity`, `test-poi-types`,
    `test-react-route-actions`, …) must stay green (this is the engine
    correctness gate and it exercises `require`).
  - `npm run build` — must succeed (proves Vite resolves the import).
  - `npm run test:smoke` — must match the established baseline (39 pass / 12
    fail; no new failures), confirming the planner still loads/plans routes and
    `window.RouteManager` is no longer needed at runtime.
  - Grep: zero `window.RouteManager` and zero `route-manager.js` `<script>`
    remaining.
