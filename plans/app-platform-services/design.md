# App Platform-Service Seams — Design

**Date:** 2026-05-29
**Status:** Approved (proceed-to-implement authorized by user)
**Branch:** `claude/iphone-app`

## Purpose

Next RN-readiness step toward sharing most React/JS code (see
[[iphone-app-direction]]). Decouple `src/App.jsx`'s orchestration from
browser-only APIs by routing its `window.location` / `window.history` /
`localStorage` access through a small, swappable **platform-services** layer with
web implementations now. **Zero web behavior change.** This isolates the
browser-specific touchpoints so a future React Native app supplies native
implementations (deep-link params, AsyncStorage) without rewriting App's logic.

## Context

The earlier surveys showed browser-API coupling is concentrated almost entirely
in `src/App.jsx`; the engine, `src/routing`, `src/data`, `utils`, and
`src/components` are already clean. Within App.jsx the relevant touchpoints are:

- **URL query reads:** `route` (restore + wizard gating), and the web-only debug
  flags `osm`/`osmDebug`, `osmLayer`, `routingShardFormat`.
- **URL writes (`history.replaceState`):** clear the `route` param
  (`clearRouteUrl`); set/clear the `osmLayer` debug param.
- **Storage read:** the welcome-wizard skip flag (`localStorage.getItem`).
- **Shard-loader base:** `window.location` passed to
  `createBaseRoutingShardFetchLoader` (2×) to resolve shard fetch URLs.

Left as-is (out of scope): `window.setTimeout`/`clearTimeout` (universal),
`window.addEventListener("keydown")` (desktop-only affordance; RN omits it), the
OSM-debug overlay `fetch`es (web-only dev tooling), and the Nominatim search
`fetch` (universal). The wizard flag is **written** in
`WelcomeWizard.jsx`, not App.jsx; that write moves to the storage adapter too for
consistency.

## Design

New web-implementation modules under `src/platform/`:

- `src/platform/location.js`
  - `getQueryParam(name) → string | null`
  - `hasQueryParam(name) → boolean`
  - `setUrlParam(name, value)` — `value == null` deletes; uses
    `history.replaceState` (no navigation), preserving current behavior.
  - `removeUrlParam(name)` — convenience for delete.
  - `getShardLoaderLocation() → Location` — returns `window.location` (the base
    the shard fetch-loader resolves against).
- `src/platform/storage.js`
  - `getStoredItem(key) → string | null` (try/catch → null, matching today's
    guarded read).
  - `setStoredItem(key, value)` (try/catch no-op on failure).

These are the **web** implementations. They are named plainly so React Native can
later add `location.native.js` / `storage.native.js` (Metro resolves `.native.js`
automatically) — no web change needed when that happens. No barrel; consumers
import the module directly.

### Call-site changes (behavior-identical)

`src/App.jsx`:
- `osmLayer` init read → `getQueryParam("osmLayer")`.
- wizard gating: `hasQueryParam("route")`; flag read → `getStoredItem(WELCOME_WIZARD_SKIP_FLAG)`.
- OSM debug effect `?osm`/`osmDebug` reads → `hasQueryParam(...)`.
- restore: `getQueryParam("route")`.
- shard loader (2×): `getShardLoaderLocation()`.
- `handleOsmDebugLayerModeChange`: `setUrlParam("osmLayer", mode === "graph" ? "graph" : null)`.
- `clearRouteUrl`: `if (!hasQueryParam("route")) return; removeUrlParam("route");`.
- `routingShardFormat()`: `getQueryParam("routingShardFormat")`.

`src/components/WelcomeWizard.jsx`:
- the two `localStorage.setItem(SKIP_FLAG_KEY, "1")` → `setStoredItem(SKIP_FLAG_KEY, "1")`.

The `typeof window === "undefined"` SSR guard in the wizard `useState`
initializer stays in App (the web adapters assume a browser at call time, which
matches today).

## Scope

**In:** the two `src/platform/` web modules and routing App.jsx +
WelcomeWizard.jsx through them. **Out:** RN native implementations, extracting an
app-controller hook (a later step), abstracting `keydown`/`setTimeout`/`fetch`,
the `new URL(shareUrl)` string-parse for the GPX filename (parses an app-produced
string, not the environment).

## Verification (zero behavior change)

- `npm test` → 9/9 + all JS green (no engine/logic impact).
- `npm run build` → succeeds.
- `npm run test:smoke` → matches baseline (40 pass / 12 fail; the 12 are the
  pre-existing stale specs). Especially `react-migration-smoke:31` (restore route
  from `?route=`) and the wizard specs (`welcome-wizard:*` — skip-on-`?route=`,
  dismiss-persists, which exercise the query read + storage flag) must not
  regress beyond baseline.
- Grep: `src/App.jsx` and `src/components/WelcomeWizard.jsx` have no direct
  `window.location` / `window.history` / `localStorage` for the routed
  operations (only the deliberately-out-of-scope `setTimeout`/`keydown` remain in
  App).
