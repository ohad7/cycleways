# iOS App Size — Webroot Prune: Design

**Date:** 2026-07-05
**Status:** Approved (analysis done in-session; implementation plan in `implementation-plan.md`)

## Problem

Ahead of the App Store release, the iOS app is too large. Measured on the
Release-iphoneos build (2026-07-05):

| Component | On disk | Notes |
|---|---|---|
| Frameworks | 58 MB | Mapbox 32 MB (3 dynamic frameworks), React 11.5 MB, Hermes 5.9 MB, Expo ~7 MB |
| **webroot** | **42 MB** | full web `dist/` served by the in-app static server |
| Native binary | 14 MB | statically linked pods |
| Metro assets | 9.7 MB | offline JSONs, routing shards, JPG thumbs, splash |
| main.jsbundle | 5.4 MB | Hermes bundle |
| **Total** | **129 MB** | **~81 MB zipped (download ballpark)** |

The frameworks are at their floor: Mapbox ships only as precompiled dynamic
XCFrameworks (single stripped arm64 slices), and machine code compresses
~2.5–4× at App Store delivery (~20 MB download for all frameworks). The
webroot is the only meaningful lever — and most of it is unreachable.

## Key findings

- The native app's WebView loads **only** `/routes/<slug>?app=1` route-detail
  pages (`RouteDetailWeb.jsx`). The planner SPA, deploy artifacts, and
  website-only downloads in the webroot are never requested.
- `public-data/poi-images` = 32 MB: 74 full-size webp (29.8 MB) + 74 thumbs
  (2.8 MB). **Every** image renderer, web and native, resolves
  `thumbnail || photo` (`RoutePoiGallery`, `POICard`, `RouteCard`, `Warnings`,
  `RoutePoiStoryList`, `imageSrc`, native `ROUTE_IMAGES`) — and every
  full-size file has a thumb, so the full-size files are unreachable
  fallbacks. Same pattern in `route-map-images` (~1.2 MB of 1.4 MB).
- `public-data/base-routing-shards` (5 MB) is consumed only by the planner
  (`packages/core/src/routing/*`); the native planner uses its own
  Metro-bundled copy — the webroot copy is a pure duplicate.
- `exports/map.kml` (0.7 MB), `404.html`, `CNAME`, `robots.txt`,
  `sitemap.xml` are website-deploy artifacts; route pages generate GPX
  client-side.
- Because webp is already compressed, pruned image bytes come off the App
  Store **download** size nearly 1:1 (unlike binary code).

## Goals

1. Cut ~37 MB from the app bundle by pruning website-only webroot content.
2. Prepare — but do **not** enable — loading full-size images on demand from
   the production site (`https://www.cycleways.app`), for a future in-app
   photo viewer.

## Non-goals

- No change to the website build/deploy (`dist/`, GitHub Pages).
- No change to pipeline-owned data (`public-data/`, `data/map-source.geojson`).
- No framework/SDK changes (Mapbox stays), no On-Demand Resources /
  Background Assets (complexity not justified at these sizes).
- No new full-size photo UI now — groundwork only.

## Design

### Prune (enabled by default)

A standalone module `apps/mobile/scripts/prune-webroot.mjs` computes and
deletes webroot-relative paths, called by `sync-web-bundle.mjs` right after
the `dist/` → `webroot/` copy (so the `ios/webroot` mirror ships pruned).

Rules, deliberately conservative:

- **Thumb-sibling rule:** in `public-data/poi-images` and
  `public-data/route-map-images`, delete `<name>.<ext>` only when
  `<name>-thumb.<ext>` exists beside it. An image without a thumb *is* the
  displayed image and stays. This keeps the prune correct even as content
  changes — it never encodes a file list.
- **Website-only list:** `public-data/base-routing-shards`,
  `public-data/exports`, `404.html`, `CNAME`, `robots.txt`, `sitemap.xml`.

Escape hatch: `--no-prune` / `SKIP_WEBROOT_PRUNE=1` for debugging webroot
parity with the website. The prune operates only on the git-ignored webroot
copies; `dist/` and source `public-data/` are physically separate copies
(verified: distinct inodes).

**Risk & mitigation:** the shard prune is the only rule not proven by static
analysis alone (the WebView *could* theoretically hit planner code paths).
Verification plan: exercise route-detail pages in the app; if anything
breaks, drop only the shard rule and keep the ~31 MB image win.

### On-demand remote images (prepared, disabled)

Two dormant pieces, connected by one browser global:

1. **Helper** `src/components/routes/fullImageSrc.js` —
   `fullImageSrc({ photo, thumbnail })` returns
   `<window.CYCLEWAYS_REMOTE_ASSET_BASE>/<photo>` when the global is set,
   otherwise the local `thumbnail || photo` resolution (matching existing
   helpers). Thumbnail-first fallback is deliberate: inside the app the
   full-size file no longer exists locally.
2. **Config write** in `sync-web-bundle.mjs` — only when
   `WEBROOT_REMOTE_ASSET_BASE` is set at bundle time, append
   `window.CYCLEWAYS_REMOTE_ASSET_BASE = "<base>";` to the webroot's
   `mapbox-token.js`. That file is chosen because every built page already
   loads it as its runtime-config script — no rewriting of built HTML.

Default state: env unset → no global written → helper resolves locally →
zero behavior change. Enabling later = build a viewer that calls
`fullImageSrc` + set the env var in the bundle step. The WebView already
requires network for map tiles, so online-only full images are consistent
with the page's existing behavior.

### Alternatives considered

- **Allowlist instead of denylist:** bundling only known-needed files is
  tighter but brittle — any new web asset would silently break route pages.
  The denylist removes only proven-dead categories.
- **Serving full images from the native Metro assets:** they were never
  bundled there (native uses JPG thumbs) — nothing to reuse.
- **ODR/Background Assets for shards/images:** deprecated-or-heavyweight
  Apple machinery for ~5 MB of savings beyond the prune; rejected.

## Expected outcome

webroot 42 → ~5 MB; app ~129 → ~92 MB installed; download ~81 → ~46 MB
(zip-estimated). Follow-up (out of scope): splash/icon PNG optimization
(~1–1.5 MB).
