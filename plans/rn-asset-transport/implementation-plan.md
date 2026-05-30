# Phase 2.3a Implementation Plan — injectable asset transport (web impl)

**Goal:** Route `core`'s asset loading through `core/src/platform/assets.js`; zero
web behavior change. See `plans/rn-asset-transport/design.md`. Branch
`claude/iphone-app`, no branch ops.

**Gate:** `npm test` 9/9 + all JS, `npm run build`, web dev-probe, `npm run
test:smoke` = baseline (40/12).

---

### Task 1 — Baseline
- [ ] `npm test` green. STOP if red.

### Task 2 — Create the web asset transport
- [ ] Create `packages/core/src/platform/assets.js` with `resolveAssetPath`
      (moved verbatim from mapAssets), `getJsonAsset(filePath, { basePath,
      ...fetchOptions })`, `getBinaryAsset(relativePath, { baseHref, sha256,
      ...fetchOptions })`, and a private `siteBase()` — exactly as in the design
      spec (preserving the existing relative/absolute/`import.meta.env.BASE_URL`
      and error-message behavior).

### Task 3 — Rewire mapAssets.js
- [ ] Remove local `resolveAssetPath` + `fetchJsonAsset`; `import { getJsonAsset }
      from "../platform/assets.js"`.
- [ ] Replace each `fetchJsonAsset(p, opts, basePath)` with
      `getJsonAsset(p, { basePath, ...opts })`. Keep `assetPathWithVersion`.
- [ ] Confirm `resolveAssetPath` is still available where mapAssets used it
      (it's only used inside the old fetchJsonAsset + for
      `baseRoutingShardManifestPath` — re-import `resolveAssetPath` from the
      transport if mapAssets still references it directly).

### Task 4 — Rewire baseRoutingShards.js
- [ ] `import { getBinaryAsset } from "../platform/assets.js"`.
- [ ] In `createBaseRoutingShardFetchLoader`, build `manifestUrl` as today, then
      per shard: `const buf = await getBinaryAsset(format.path, { baseHref:
      manifestUrl.href, sha256: format.sha256, ...fetchOptions });` and decode:
      `msgpack`→`decodeMessagePack(buf)`, `compact`→`decodeCompactBaseRoutingShard(buf)`,
      else `JSON.parse(new TextDecoder().decode(buf))`.
- [ ] Make `location` a required param (drop `= window.location`); confirm all
      callers pass it (`useCyclewaysApp` passes `getShardLoaderLocation()`; check
      `shardedRouteSession`, scripts, tests).

### Task 5 — Verify
- [ ] `grep -n "fetch(\|import.meta\|window.location" packages/core/src/data/mapAssets.js packages/core/src/routing/baseRoutingShards.js` → none (only via transport).
- [ ] `npm test` → 9/9 + all JS (esp. test-map-assets, test-base-routing-shards,
      test-base-routing-network, test-compact-base-routing-shard).
- [ ] `npm run build`; web dev-probe (`/?route=…` loads + plans).
- [ ] `npm run test:smoke` → baseline, no new failures.

### Task 6 — Commit
- [ ] `refactor(core): route asset loading through a platform asset transport`.
