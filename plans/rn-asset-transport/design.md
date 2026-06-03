# RN Mobile — Phase 2.3a: injectable asset transport in core (web-neutral)

**Date:** 2026-05-30
**Status:** Approved (design)
**Branch:** `claude/iphone-app`

## Purpose

Foundation for loading map + routing data on React Native (and, later, offline).
Today `@cycleways/core` loads assets with `fetch()` + web-only path resolution
(`import.meta.env.BASE_URL`, `new URL(path, window.location.href)`). Introduce a
**platform asset transport** so the *what* (logical asset paths) is decoupled
from the *how* (fetch a URL on web; read a bundled asset on RN). This phase
delivers the **web implementation only**, with **zero web behavior change**; the
RN `assets.native.js` + bundling come in Phase 2.3b.

## Scope

**In:** new `core/src/platform/assets.js` (web transport); route `mapAssets.js`
and `baseRoutingShards.js` through it; keep the web app byte-for-byte behaviorally
identical. **Out:** the RN `assets.native.js`, bundling data, the other `.native`
adapters, wiring `useCyclewaysApp` (later phases).

## Current web-coupling to abstract

- `mapAssets.js` `fetchJsonAsset(filePath, options, basePath)`: `resolveAssetPath`
  then, for relative paths, prefixes `import.meta.env?.BASE_URL` (Vite) and
  `fetch().json()`.
- `baseRoutingShards.js` `createBaseRoutingShardFetchLoader(manifestPath,
  fetchOptions, location = window.location, { format })`: per shard,
  `new URL(format.path, new URL(manifestPath, location.href))` (+ `?h=sha256`),
  `fetch()`, then `decodeCompactBaseRoutingShard`/`decodeMessagePack`/`json` from
  the `arrayBuffer()`/`json()`.

## Design — the transport

`packages/core/src/platform/assets.js` (web implementation):

```js
// Web asset transport. Resolves LOGICAL asset paths (relative file paths +
// a base) to URLs on the deployed site and fetches them. React Native provides
// a sibling assets.native.js that resolves the same logical paths against
// bundled assets. Keeps the rest of core free of fetch/import.meta/URL specifics.

export function resolveAssetPath(filePath, basePath = null) { /* moved verbatim */ }

// JSON asset relative to a manifest base (segments, network, manifests, …).
export async function getJsonAsset(filePath, { basePath = null, ...fetchOptions } = {}) {
  const assetPath = resolveAssetPath(filePath, basePath);
  const requestPath =
    assetPath.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(assetPath)
      ? assetPath
      : `${siteBase()}${assetPath}`;
  const response = await fetch(requestPath, fetchOptions);
  if (!response.ok) throw new Error(`${assetPath}: HTTP ${response.status} ${response.statusText}`);
  return response.json();
}

// Binary asset (routing shard) resolved relative to a base href.
export async function getBinaryAsset(relativePath, { baseHref, sha256, ...fetchOptions } = {}) {
  const url = new URL(relativePath, baseHref);
  if (sha256) url.searchParams.set("h", sha256);
  const response = await fetch(url, fetchOptions);
  if (!response.ok) throw new Error(`${relativePath}: HTTP ${response.status} ${response.statusText}`);
  return response.arrayBuffer();
}

function siteBase() {
  return (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
}
```

### Rewiring (behavior-preserving)

- `mapAssets.js`: delete its local `resolveAssetPath` + `fetchJsonAsset`; import
  `getJsonAsset` from `../platform/assets.js`. Replace `fetchJsonAsset(path, opts,
  basePath)` calls with `getJsonAsset(path, { basePath, ...opts })`. The
  `assetPathWithVersion` helper stays in `mapAssets.js` (it builds the `?v=`
  path that is passed to `getJsonAsset`).
- `baseRoutingShards.js`: in `createBaseRoutingShardFetchLoader`, replace the
  per-shard `fetch` with `getBinaryAsset(format.path, { baseHref: manifestUrl.href,
  sha256: format.sha256, ...fetchOptions })`, then decode the returned
  `arrayBuffer`: `compact` → `decodeCompactBaseRoutingShard(buf)`, `msgpack` →
  `decodeMessagePack(buf)`, `json` → `JSON.parse(new TextDecoder().decode(buf))`
  (behavior-equivalent to the old `response.json()`). Drop the
  `location = window.location` default — callers already pass `location`
  (`getShardLoaderLocation()` on web); keep `location` required.

## Verification (zero web behavior change)

- `npm test` → 9/9 + all JS green, especially `tests/test-map-assets.mjs`,
  `tests/test-base-routing-shards.mjs`, `tests/test-base-routing-network.mjs`,
  `tests/test-compact-base-routing-shard.mjs` (which exercise these loaders;
  they mock `global.fetch`, which the transport still uses).
- `npm run build` green; web dev-probe (route loads from `?route=`, shards fetch)
  clean.
- `npm run test:smoke` → baseline (40 pass / 12 fail), no new failures — the
  route-restore + planning tests exercise shard loading.
- Grep: `mapAssets.js` and `baseRoutingShards.js` no longer call `fetch(` or
  reference `import.meta`/`window.location` directly (only via the transport).

## Risks

- Tests that mock `global.fetch` must still work — the web transport uses
  `global fetch`, so they do; verify each loader test.
- The `json`-format shard path now parses from an arrayBuffer rather than
  `response.json()` — behavior-equivalent; covered by the shard tests.
