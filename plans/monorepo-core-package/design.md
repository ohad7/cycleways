# Monorepo + `@cycleways/core` Package — Design

**Date:** 2026-05-29
**Status:** Approved (design)
**Branch:** `claude/iphone-app`

## Purpose

First sub-project of the React Native transition (see [[iphone-app-direction]]).
Establish a shared code package so the web app and a future RN app
(`apps/mobile`) consume one source of truth for the platform-agnostic logic.
**Zero web behavior change** — this is a structural restructure, not a feature
change.

Locked decisions (from RN-transition brainstorming): monorepo via **npm
workspaces**; the web app **stays at the repo root** (root = web app + workspace
manager); shared code moves into **`packages/core`** (`@cycleways/core`); RN
tooling will be **Expo + `@rnmapbox/maps`** with a **thin vertical slice** as the
first mobile milestone (later sub-projects).

## Scope

**In:** create `packages/core`, move the shared modules into it with the small
boundary fixes below, repoint every consumer (web, tests, editor server, scripts)
at `@cycleways/core`, keep web/CI/Pages green. **Out:** the RN app, any
`*.native.js` implementations, moving the web app into `apps/web`, any
logic/behavior change.

## Section 1 — Workspace layout & tooling

npm workspaces (repo already uses npm + `package-lock.json`; no new tool). Root
`package.json` remains the web app *and* the workspace manager.

```
/package.json            # web app; "workspaces": ["packages/*"]; dep "@cycleways/core": "*"
/index.html, vite.config.mjs, public/, editor/, processing/, data/, scripts/   # stay at root
/src/                    # WEB-ONLY: components/, pages/, map/ (Mapbox layer + MapSurface),
                         #   App.jsx, main.jsx, react-app.css, config/
/packages/core/
   package.json          # name "@cycleways/core", type module, subpath exports
   route-manager.js      # the CommonJS engine (moved from root)
   src/
     routing/  utils/  data/  app/useCyclewaysApp.js
     platform/           # location.js, storage.js, analytics.js (web impls; RN adds *.native.js)
     domain/             # relocated pure helpers (data markers, direction animator, shared constants)
     index.js            # optional barrel for the "." export
```

Web import sites change `../routing/x` / `../../utils/x` / `../data/x` /
`../app/useCyclewaysApp` / `../../route-manager.js` → `@cycleways/core/...`.
Vite resolves the workspace symlink and the ESM package with no extra config;
Metro (later) resolves the same package and prefers `*.native.js` siblings.

## Section 2 — What goes in `core` + boundary fixes

**Moves into `core` (platform-agnostic):** `route-manager.js`, `src/routing/*`,
`utils/*` (minus `analytics.js`, see fix 4), `src/data/*` (catalog, mapAssets,
poiTypes), `src/app/useCyclewaysApp.js`.

**Boundary fixes (mechanical, behavior-neutral):**
1. **`dataMarkerFeaturesFromSegments`** — pure, but currently lives in the Mapbox
   `mapLayers.product.js`. Move it into `core` (`core/src/domain/dataMarkers.js`).
   Update importers: `useCyclewaysApp`, the web `mapLayers` (re-export or import
   from core), `FeaturedRoute.jsx`. Prevents the Mapbox layer graph leaking into
   core.
2. **`routeDirectionAnimator.js`** — move to `core` after checking its 2 platform
   touch points: if `requestAnimationFrame` (RN-supported) keep as-is; if DOM,
   inject a clock. Verify during implementation.
3. **`WELCOME_WIZARD_SKIP_FLAG`** — currently a constant inside the web
   `WelcomeWizard.jsx` but read by `useCyclewaysApp`. Move the constant into
   `core` (shared constants module); `WelcomeWizard.jsx` imports it from core.
4. **`analytics.js` is a platform service** (uses `window.location.hostname` +
   `gtag`), not pure core. Move to `core/src/platform/analytics.js` as the **web**
   impl, alongside `location.js`/`storage.js`. RN later adds `analytics.native.js`.

**Stays web-only (NOT in core):** `src/map/*` (Mapbox layer, `MapSurface`,
`OsmDebugOverlay`), `src/components/*`, `src/pages/*`, `App.jsx`, `main.jsx`,
CSS. `src/config/featureFlags.js` moves to core (plain config the RN app needs).

**Platform dual-impl strategy:** `core/src/platform/*.js` are the web
implementations; RN adds `*.native.js` siblings in the same folder. Vite ignores
`.native.js`; Metro prefers it. One `core` package serves both — no per-app
platform forks.

## Section 3 — How web imports `core`

`packages/core/package.json`:
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
`"./*": "./src/*"` maps `@cycleways/core/routing/routeActions.js` →
`packages/core/src/routing/routeActions.js`; the explicit entry exposes the CJS
engine. Inside `core`, modules keep their **relative** imports unchanged.

Root `package.json` adds `"workspaces": ["packages/*"]` and
`"@cycleways/core": "*"`; `npm install` symlinks it into `node_modules`.

**Engine + Vite plugin:** the CJS engine moves to `packages/core/route-manager.js`.
The existing `routeManagerEsmPlugin` in root `vite.config.mjs` keeps rewriting
`module.exports`→`export default` for the web bundle; change its id match to
`id.endsWith("/route-manager.js")` so it works through the workspace symlink.

## Section 4 — Tests, CI/deploy, engine references

**Tests stay in `tests/` (lower churn), repointed at `core`:** the ~25 Node tests
update their loads — `require("../route-manager.js")` →
`require("../packages/core/route-manager.js")`; `../src/routing` / `../utils` /
`../src/data` / `../src/app` imports → `@cycleways/core/...` (also exercises the
package resolution). Root `package.json` `test` script unchanged in shape. A
later cleanup may move core's tests into the package.

**Other engine consumers repointed (engine stays CommonJS → all keep working):**
`editor/server.mjs` (2× `nodeRequire(resolve(repoRoot, "route-manager.js"))` →
`"packages/core/route-manager.js"`); `scripts/inspect-base-route.mjs` +
`scripts/compare-base-route-shards.mjs` (`require("../route-manager.js")` →
`"../packages/core/route-manager.js"`); `scripts/copy-static-assets.mjs` — remove
the moved, web-bundled `route-manager.js` from its copy list (else ENOENT).

**CI/deploy:** `ci.yml` (`npm ci` → build → test → smoke) and `pages.yml` (build →
Pages) work with workspaces (`npm ci` supports them); deployed site unchanged.
`index.html`/`404.html` already have no engine script tag (prior step).

## Verification (zero behavior change)

- `npm install` succeeds; `node_modules/@cycleways/core` symlink resolves.
- `npm test` → 9/9 + all JS green (importing from `core`).
- `npm run build` → succeeds (Vite resolves `@cycleways/core` + the engine plugin).
- dev-probe: app renders and a route loads from `?route=…`, no page errors.
- `npm run test:smoke` → baseline (40 pass / 12 fail; the 12 are pre-existing
  stale specs), no new failures.
- `node -e "require('./packages/core/route-manager.js')"` resolves; an
  editor-server-style require of the engine still works.

## Risks & mitigations

- **Broad path churn** (web import sites + ~25 tests + editor + scripts):
  mechanical; fully guarded by `npm test` + build + smoke + dev-probe.
- **`exports`-map correctness** for both Vite and Node resolution: validated by
  the test suite (which imports via `@cycleways/core/...`) and the build.
- **Engine plugin path through the workspace symlink:** matched on
  `/route-manager.js` basename; validated by build + dev-probe.
- **npm workspaces install behavior:** validated by `npm install` + `npm ci`
  parity (CI).
