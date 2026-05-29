# @cycleways/core

Shared, **platform-agnostic** logic for the CycleWays web app (`/src`, Vite) and
a future React Native app. One source of truth: routing engine, route
session/reducer/actions, GPX + encoding + geometry utils, data loaders, the
`useCyclewaysApp` controller hook, and platform-service interfaces.

Consumers import via subpaths, e.g.:

```js
import { addPoint } from "@cycleways/core/routing/routeActions.js";
import { useCyclewaysApp } from "@cycleways/core/app/useCyclewaysApp.js";
import RouteManager from "@cycleways/core/route-manager.js";
```

## Rules for code that lives here

- **No DOM, JSX, Mapbox, or browser globals** in `src/**`. Anything web-specific
  goes through `src/platform/*` (a web impl that a React Native app overrides
  with a `*.native.js` sibling — Metro resolves `.native.js` automatically; Vite
  ignores it). Current platform services: `location`, `storage`, `analytics`,
  `download`.

## ⚠️ CJS/ESM split — do not "fix" the missing `type` field

`package.json` intentionally has **no `"type"` field** so that the engine
`route-manager.js` (authored as CommonJS — `module.exports = RouteManager`) is
loaded as CommonJS by Node `require()` (the test suite, the editor server, and
CLI scripts all `require` it). ESM is enabled only for `src/**` via
`src/package.json` (`{"type":"module"}`).

If you add `"type":"module"` to this `package.json`, Node will parse
`route-manager.js` as ESM and `require('@cycleways/core/route-manager.js')` will
return `{}` / throw — breaking the editor server, the scripts, and the tests.
The web bundle gets an ESM default export via the `routeManagerEsmPlugin` Vite
plugin (see root `vite.config.mjs`), which rewrites `module.exports` →
`export default` at build time without changing the on-disk source.
