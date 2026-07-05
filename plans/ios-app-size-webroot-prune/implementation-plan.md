# iOS App Size — Webroot Prune Implementation Plan

> **For agentic workers:** Implement this plan exactly in order. If your environment has `superpowers:executing-plans`, use it; otherwise follow this file literally and check off each `- [ ]` step as it is completed. Do not skip the failing-test steps, and do not touch pipeline-owned data.

**Date:** 2026-07-05

**Goal:** Cut ~37 MB from the iOS app bundle by pruning website-only files from the mobile `webroot/` copy, and lay dormant groundwork for loading full-size images on demand from the production site.

**Architecture:** The native app bundles the entire web `dist/` as `webroot/` (42 MB) and serves it from an in-app static server; the WebView only ever loads `/routes/<slug>?app=1` route-detail pages. A new prune module deletes files those pages can never surface — full-size images whose `-thumb` sibling is always preferred (`thumbnail || photo` in every consumer), the base-routing shards (planner-only; the native app bundles its own copy in Metro assets), and website deploy artifacts. The prune runs inside `sync-web-bundle.mjs` on the webroot copy only — `dist/` and the website deploy are untouched. A second, initially-disabled mechanism lets the web pages resolve full-size photos against `https://www.cycleways.app` via a `window.CYCLEWAYS_REMOTE_ASSET_BASE` global, written into the webroot only when an env flag is set at bundle time.

**Tech Stack:** Node ESM scripts (`node:fs/promises`), plain-node tests with `assert/strict` (matching `tests/test-*.mjs` style), existing `sync-web-bundle.mjs` pipeline.

## Analysis background (measured 2026-07-05, Release-iphoneos build)

- `CycleWays.app` = 129 MB on disk, ~81 MB zipped (download ballpark).
- `webroot/` = 42 MB, of which `public-data/poi-images` = 32 MB: 74 full-size webp (29.8 MB) + 74 thumbs (2.8 MB). Every full-size file has a `-thumb` sibling.
- Every renderer — `RoutePoiGallery.jsx`, `POICard.jsx`, `RouteCard.jsx`, `Warnings.jsx`, `RoutePoiStoryList.jsx`, `routePoiStoryData.js#imageSrc`, native `ROUTE_IMAGES`/`routeGalleries.js` — uses `thumbnail || photo`. The full-size `photo` is an unreachable fallback.
- Same pattern for `public-data/route-map-images` (1.4 MB, ~1.2 MB full-size).
- `public-data/base-routing-shards` (5 MB) is consumed only by the planner SPA (`packages/core/src/routing/*` via `useCyclewaysApp`); the WebView loads only route-detail pages, and the native planner uses its own Metro-bundled copy of the shards.
- `public-data/exports/map.kml` (0.7 MB) is a website-only download; the route pages generate GPX client-side (`generateGPX` in `FeaturedVideoRoute.jsx`).
- Expected result: webroot 42 MB → ~5 MB; app ~129 → ~92 MB installed, download ~81 → ~46 MB (webp is already compressed, so pruned bytes come off the download nearly 1:1).

## Global Constraints

- **Never hand-edit pipeline-owned data:** `public-data/` at the repo root and `data/map-source.geojson` must not be touched. The prune operates only on `apps/mobile/webroot/` (git-ignored build artifact) and its `ios/webroot` mirror.
- The website build (`dist/`, GitHub Pages deploy) must remain complete — prune only the mobile copy.
- Only delete a full-size image when its `-thumb` sibling exists in the same directory.
- Remote full-image loading ships **disabled**: no behavior change unless `WEBROOT_REMOTE_ASSET_BASE` is set at bundle time.
- Production origin for remote assets: `https://www.cycleways.app` (from `CNAME`).
- Tests are plain node scripts using `node:assert/strict`, wired into the root `package.json` `test` chain.
- If you commit, use the commit commands shown in the tasks. Do not add unrelated files.

## File Structure

- Create: `apps/mobile/scripts/prune-webroot.mjs` — pure prune logic (`collectPrunePaths`, `pruneWebroot`), no CLI.
- Create: `tests/test-prune-webroot.mjs` — fixture-based test for the prune module.
- Modify: `apps/mobile/scripts/sync-web-bundle.mjs` — call the prune after the dist→webroot copy; write the optional remote-asset global.
- Create: `src/components/routes/fullImageSrc.js` — dormant web-side helper resolving full-size photos remotely (sibling of the existing `routeImageSrc.js`).
- Create: `tests/test-full-image-src.mjs` — test for the helper.
- Modify: `package.json` (root) — add the two tests to the `test` chain.

---

## Preflight

- Run `git status --short` first. Do not revert or overwrite unrelated changes.
- Work from the repo root: `/Users/ohad/projects/isravelo`.
- If any command fails differently from the expected failure in a "failing test" step, stop and report the command plus its output. Do not improvise a different implementation.
- Do not commit a task until that task's test/verification steps pass.
- This plan assumes the current repo shape where `src/main.jsx` lazy-loads route-detail pages separately from the planner. That keeps the planner's base-routing code out of the `/routes/:slug` page chunk and supports pruning `public-data/base-routing-shards` from the app webroot.
- Current source data count is 74 non-thumb files in `public-data/poi-images` and 9 non-thumb files in `public-data/route-map-images`; the expected prune count is based on those numbers.

### Task 1: Prune module with tests

**Files:**
- Create: `apps/mobile/scripts/prune-webroot.mjs`
- Test: `tests/test-prune-webroot.mjs`
- Modify: `package.json` (root, `test` script)

**Interfaces:**
- Produces: `collectPrunePaths(webrootDir) -> Promise<string[]>` (sorted webroot-relative paths that should be deleted) and `pruneWebroot(webrootDir) -> Promise<{ removed: string[], bytes: number }>`. Task 2 imports `pruneWebroot`.

- [ ] **Step 1: Write the failing test**

Create `tests/test-prune-webroot.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectPrunePaths,
  pruneWebroot,
} from "../apps/mobile/scripts/prune-webroot.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "prune-webroot-"));

async function put(rel, content = "x".repeat(64)) {
  const full = path.join(root, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
}

// Full-size images WITH a -thumb sibling → pruned; thumbs kept.
await put("public-data/poi-images/poi-aaa.webp");
await put("public-data/poi-images/poi-aaa-thumb.webp");
await put("public-data/route-map-images/slug-map-bbb.webp");
await put("public-data/route-map-images/slug-map-bbb-thumb.webp");
// Full-size image WITHOUT a thumb sibling → must be kept (it IS the display image).
await put("public-data/poi-images/solo.webp");
// Website-only paths → pruned.
await put("public-data/base-routing-shards/manifest.json");
await put("public-data/base-routing-shards/shards/g711_664.cwb");
await put("public-data/exports/map.kml");
await put("404.html");
await put("CNAME");
await put("robots.txt");
await put("sitemap.xml");
// App-needed files → kept.
await put("index.html");
await put("mapbox-token.js");
await put("routes/some-slug/index.html");
await put("public-data/segments.json");
await put("public-data/route-catalog.json");
await put("public-data/featured-routes/some-slug.json");
await put("public-data/cw-base-index.json");

const planned = await collectPrunePaths(root);
assert.deepEqual(planned, [
  "404.html",
  "CNAME",
  "public-data/base-routing-shards",
  "public-data/exports",
  "public-data/poi-images/poi-aaa.webp",
  "public-data/route-map-images/slug-map-bbb.webp",
  "robots.txt",
  "sitemap.xml",
]);

const { removed, bytes } = await pruneWebroot(root);
assert.deepEqual(removed, planned);
assert.ok(bytes > 0, "reports freed bytes");

for (const rel of planned) {
  assert.ok(!existsSync(path.join(root, rel)), `${rel} removed`);
}
for (const rel of [
  "public-data/poi-images/poi-aaa-thumb.webp",
  "public-data/poi-images/solo.webp",
  "public-data/route-map-images/slug-map-bbb-thumb.webp",
  "index.html",
  "mapbox-token.js",
  "routes/some-slug/index.html",
  "public-data/segments.json",
  "public-data/route-catalog.json",
  "public-data/featured-routes/some-slug.json",
  "public-data/cw-base-index.json",
]) {
  assert.ok(existsSync(path.join(root, rel)), `${rel} kept`);
}

// Idempotent: a second run finds nothing left to prune.
assert.deepEqual(await collectPrunePaths(root), []);
const second = await pruneWebroot(root);
assert.deepEqual(second.removed, []);
assert.equal(second.bytes, 0);

await rm(root, { recursive: true, force: true });
console.log("test-prune-webroot: OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-prune-webroot.mjs`
Expected: FAIL with `Cannot find module .../apps/mobile/scripts/prune-webroot.mjs`

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/scripts/prune-webroot.mjs`:

```js
// Prunes website-only files from the mobile webroot (the copy of the web
// `dist/` that the native app bundles and serves to its route-detail WebView).
// The WebView only ever loads `/routes/<slug>?app=1`, and every image renderer
// (web and native) resolves `thumbnail || photo` — so full-size images with a
// `-thumb` sibling, the planner's base-routing shards (the native planner uses
// its own Metro-bundled copy), and website deploy artifacts can never be
// surfaced inside the app. webroot/ is a git-ignored build artifact; the
// website's dist/ is never touched.
import { readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// Directories whose full-size images ship alongside `<name>-thumb.<ext>`
// siblings. Only files WITH a thumb sibling are pruned — an image without a
// thumb is itself the displayed fallback and must stay.
const THUMB_IMAGE_DIRS = [
  "public-data/poi-images",
  "public-data/route-map-images",
];

// Paths (webroot-relative) only the public website needs.
const WEBSITE_ONLY_PATHS = [
  "404.html",
  "CNAME",
  "public-data/base-routing-shards", // planner SPA only; native bundles its own copy
  "public-data/exports", // whole-map KML download; route pages generate GPX client-side
  "robots.txt",
  "sitemap.xml",
];

export async function collectPrunePaths(webrootDir) {
  const paths = [];
  for (const rel of WEBSITE_ONLY_PATHS) {
    if (existsSync(path.join(webrootDir, rel))) paths.push(rel);
  }
  for (const dirRel of THUMB_IMAGE_DIRS) {
    const dir = path.join(webrootDir, dirRel);
    if (!existsSync(dir)) continue;
    const names = await readdir(dir);
    const nameSet = new Set(names);
    for (const name of names) {
      const match = name.match(/^(.+)\.(webp|jpe?g|png)$/i);
      if (!match || match[1].endsWith("-thumb")) continue;
      if (nameSet.has(`${match[1]}-thumb.${match[2]}`)) {
        paths.push(`${dirRel}/${name}`);
      }
    }
  }
  return paths.sort();
}

export async function pruneWebroot(webrootDir) {
  const removed = await collectPrunePaths(webrootDir);
  let bytes = 0;
  for (const rel of removed) {
    const full = path.join(webrootDir, rel);
    bytes += await pathSize(full);
    await rm(full, { recursive: true, force: true });
  }
  return { removed, bytes };
}

async function pathSize(target) {
  const info = await stat(target);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of await readdir(target, { withFileTypes: true })) {
    total += await pathSize(path.join(target, entry.name));
  }
  return total;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-prune-webroot.mjs`
Expected: `test-prune-webroot: OK`

- [ ] **Step 5: Wire the test into the root test chain**

In root `package.json`, in the `test` script, insert immediately after `node tests/test-map-assets.mjs && `:

```
node tests/test-prune-webroot.mjs &&
```

(so the chain reads `... && node tests/test-map-assets.mjs && node tests/test-prune-webroot.mjs && node tests/test-route-manager-snap.js && ...`)

Run: `node tests/test-prune-webroot.mjs` once more to confirm, then verify the JSON is still valid: `node -e "require('./package.json')"`

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/scripts/prune-webroot.mjs tests/test-prune-webroot.mjs package.json
git commit -m "feat(mobile): add webroot prune module for app-size reduction"
```

---

### Task 2: Run the prune inside sync-web-bundle

**Files:**
- Modify: `apps/mobile/scripts/sync-web-bundle.mjs` (prune after the dist→webroot copy at the `await cp(distDir, webrootDir, ...)` call, before the sanity checks; the existing `ios/webroot` mirroring then picks up the pruned tree automatically)

**Interfaces:**
- Consumes: `pruneWebroot(webrootDir)` from Task 1.
- Produces: `npm run bundle:web -w @cycleways/mobile` now emits a pruned webroot; `--no-prune` / `SKIP_WEBROOT_PRUNE=1` escape hatch for debugging webroot parity with the website.

- [ ] **Step 1: Add the prune call**

In `apps/mobile/scripts/sync-web-bundle.mjs`:

Add the import at the top with the other imports:

```js
import { pruneWebroot } from "./prune-webroot.mjs";
```

Add the flag next to the existing `skipBuild` definition:

```js
const skipPrune =
  process.argv.includes("--no-prune") || process.env.SKIP_WEBROOT_PRUNE === "1";
```

Then, in `main()`, immediately after:

```js
  await rm(webrootDir, { recursive: true, force: true });
  await cp(distDir, webrootDir, { recursive: true });
```

insert:

```js
  // Strip website-only content the app's WebView can never surface (full-size
  // images with -thumb siblings, planner routing shards, deploy artifacts).
  // This is the main app-store size lever: ~37 MB of the 42 MB webroot.
  if (skipPrune) {
    console.log(
      "[web-bundle] skipping webroot prune (--no-prune/SKIP_WEBROOT_PRUNE).",
    );
  } else {
    const { removed, bytes } = await pruneWebroot(webrootDir);
    console.log(
      `[web-bundle] pruned ${removed.length} website-only paths, ${(bytes / 1e6).toFixed(1)} MB`,
    );
  }
```

The existing sanity checks (`index.html`, `public-data`, `routes`) and the `ios/webroot` mirror run after this point unchanged — the mirror therefore ships the pruned tree.

- [ ] **Step 2: Run the bundle against the existing dist and verify**

Run: `npm run bundle:web -w @cycleways/mobile -- --skip-build`

If this fails because `dist/` is missing, run `npm run build` at the repo root once, then rerun the command above.

Expected output includes:
- `[web-bundle] pruned N website-only paths, ~36.x MB` (N ≈ 89: 74 poi-images + 9 route-map-images full-size files + 6 website-only paths; exact count depends on current dist)
- `[web-bundle] webroot ready: 9 route pages, ~5.x MB ...` (was ~44 MB)
- `[web-bundle] mirrored into apps/mobile/ios/webroot`

Then verify by hand:

```bash
find apps/mobile/webroot/public-data/poi-images -maxdepth 1 -type f ! -name '*-thumb.*' -print
find apps/mobile/webroot/public-data/poi-images -maxdepth 1 -type f -name '*-thumb.*' | wc -l
test ! -e apps/mobile/webroot/public-data/base-routing-shards && test ! -e apps/mobile/webroot/public-data/exports && echo "website-only dirs removed"
find apps/mobile/webroot/routes -mindepth 1 -maxdepth 1 | wc -l
du -sh apps/mobile/webroot apps/mobile/ios/webroot
```

Expected: first command prints no files; thumb count is 74; website-only dirs are removed; route count is 10 (9 slugs + `index.html`); both webroot copies are about 5 MB.

- [ ] **Step 3: Verify the escape hatch**

Run: `npm run bundle:web -w @cycleways/mobile -- --skip-build --no-prune`
Expected: `[web-bundle] skipping webroot prune`, and `ls apps/mobile/webroot/public-data/base-routing-shards` exists again. Re-run without `--no-prune` afterwards to leave a pruned webroot in place.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/scripts/sync-web-bundle.mjs
git commit -m "feat(mobile): prune website-only content from bundled webroot"
```

---

### Task 3: Dormant full-image helper for future remote loading

**Files:**
- Create: `src/components/routes/fullImageSrc.js`
- Test: `tests/test-full-image-src.mjs`
- Modify: `package.json` (root, `test` script)

**Interfaces:**
- Consumes: `routeImageSrc` from `src/components/routes/routeImageSrc.js` for local URL/base-path handling.
- Produces: `fullImageSrc(item) -> string` and `remoteAssetBase() -> string`, for a future lightbox/full-photo viewer. **No production code calls these yet** — that is intentional; this task only establishes the contract and tests.

Contract for `fullImageSrc({ photo, thumbnail })`:
1. If `window.CYCLEWAYS_REMOTE_ASSET_BASE` is set (app webroot with remote images enabled) and `photo` is a relative logical path (e.g. `public-data/poi-images/x.webp`), return `<base>/<photo>` — the full-size image served by the production site.
2. If the remote base is set and `photo` is already an absolute URL, return `photo` unchanged, even if a thumbnail is present.
3. Otherwise return the local resolution of `thumbnail || photo` by delegating to `routeImageSrc`. Thumbnail-first is deliberate: in the app the full-size file is pruned from the webroot, so the thumb is the best locally-available image. Do not duplicate the local URL/base-path logic from `routeImageSrc`.
4. On the public website (no global set) a future lightbox that wants the true full-size local file should call it with `{ photo, thumbnail: "" }`.

- [ ] **Step 1: Write the failing test**

Create `tests/test-full-image-src.mjs`:

```js
import assert from "node:assert/strict";
import {
  fullImageSrc,
  remoteAssetBase,
} from "../src/components/routes/fullImageSrc.js";

const item = {
  photo: "public-data/poi-images/poi-aaa.webp",
  thumbnail: "public-data/poi-images/poi-aaa-thumb.webp",
};

// No window at all (node) → local thumbnail resolution.
assert.equal(remoteAssetBase(), "");
assert.equal(fullImageSrc(item), "/public-data/poi-images/poi-aaa-thumb.webp");

// Window without the global (public website / flag off) → still local thumb.
globalThis.window = {};
assert.equal(fullImageSrc(item), "/public-data/poi-images/poi-aaa-thumb.webp");

// Global set (app webroot with remote images enabled) → remote full photo.
globalThis.window = {
  CYCLEWAYS_REMOTE_ASSET_BASE: "https://www.cycleways.app/",
};
assert.equal(remoteAssetBase(), "https://www.cycleways.app");
assert.equal(
  fullImageSrc(item),
  "https://www.cycleways.app/public-data/poi-images/poi-aaa.webp",
);

// Absolute photo URLs pass through untouched even with a remote base, even when
// a thumbnail exists.
assert.equal(
  fullImageSrc({
    photo: "https://example.com/x.jpg",
    thumbnail: "public-data/poi-images/poi-aaa-thumb.webp",
  }),
  "https://example.com/x.jpg",
);

// No thumbnail, no remote base → local full photo (website lightbox case).
globalThis.window = {};
assert.equal(
  fullImageSrc({ photo: "public-data/poi-images/poi-aaa.webp", thumbnail: "" }),
  "/public-data/poi-images/poi-aaa.webp",
);

// Empty item → empty string.
assert.equal(fullImageSrc({}), "");
assert.equal(fullImageSrc(null), "");

delete globalThis.window;
console.log("test-full-image-src: OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-full-image-src.mjs`
Expected: FAIL with `Cannot find module .../src/components/routes/fullImageSrc.js`

- [ ] **Step 3: Write the implementation**

Create `src/components/routes/fullImageSrc.js`:

```js
// Resolves a POI/route image's FULL-SIZE photo for a future lightbox/photo
// viewer. The app's bundled webroot prunes full-size images (only -thumb files
// ship), so inside the app the full photo is only reachable remotely: when the
// webroot bundle sets window.CYCLEWAYS_REMOTE_ASSET_BASE (see
// apps/mobile/scripts/sync-web-bundle.mjs, WEBROOT_REMOTE_ASSET_BASE env),
// resolve against the production site; otherwise fall back to the local
// thumbnail-or-photo like every existing renderer does. Currently dormant —
// no caller ships the remote flag.
import { routeImageSrc } from "./routeImageSrc.js";

const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:/i;

export function remoteAssetBase() {
  if (typeof window === "undefined") return "";
  return String(window.CYCLEWAYS_REMOTE_ASSET_BASE || "")
    .trim()
    .replace(/\/+$/, "");
}

export function fullImageSrc(item) {
  const photo = String(item?.photo || "").trim();
  const thumbnail = String(item?.thumbnail || "").trim();
  const base = remoteAssetBase();
  if (photo && base) {
    if (ABSOLUTE_URL_RE.test(photo) || photo.startsWith("//")) return photo;
    if (!photo.startsWith("/")) {
      return `${base}/${photo.replace(/^\.?\//, "")}`;
    }
  }
  return routeImageSrc(thumbnail || photo);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-full-image-src.mjs`
Expected: `test-full-image-src: OK`

- [ ] **Step 5: Wire the test into the root test chain**

In root `package.json`, in the `test` script, insert immediately after `node tests/test-prune-webroot.mjs && ` (added in Task 1):

```
node tests/test-full-image-src.mjs &&
```

Verify: `node -e "require('./package.json')"`

- [ ] **Step 6: Commit**

```bash
git add src/components/routes/fullImageSrc.js tests/test-full-image-src.mjs package.json
git commit -m "feat(web): add dormant fullImageSrc helper for remote full-size images"
```

---

### Task 4: Env-gated remote-asset config in the webroot bundle

**Files:**
- Modify: `apps/mobile/scripts/sync-web-bundle.mjs` (extend `writeMapboxToken` call site in `main()`)

**Interfaces:**
- Consumes: nothing new.
- Produces: when `WEBROOT_REMOTE_ASSET_BASE` is set at bundle time, `webroot/mapbox-token.js` additionally sets `window.CYCLEWAYS_REMOTE_ASSET_BASE`, which `fullImageSrc` (Task 3) reads. Default (env unset): file unchanged, feature dormant.

**Why piggyback on `mapbox-token.js`:** every built page already loads `/mapbox-token.js` as a runtime-config script; appending one assignment there avoids rewriting the built HTML of every route page. It is runtime config, not just the token.

- [ ] **Step 1: Append the global when the env flag is set**

In `apps/mobile/scripts/sync-web-bundle.mjs`, in `main()`, right after the `await writeMapboxToken(webrootDir);` line, insert:

```js
  await appendRemoteAssetBase(webrootDir);
```

And add this function next to `writeMapboxToken`:

```js
// Future/off-by-default: lets the served pages load pruned full-size images
// from the production site (fullImageSrc reads this global). Enable per-build:
//   WEBROOT_REMOTE_ASSET_BASE=https://www.cycleways.app npm run bundle:web -w @cycleways/mobile
// Appended to mapbox-token.js because every built page already loads that file
// as its runtime config script.
async function appendRemoteAssetBase(targetDir) {
  const base = (process.env.WEBROOT_REMOTE_ASSET_BASE || "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) return;
  const dest = path.join(targetDir, "mapbox-token.js");
  await appendFile(
    dest,
    `\nwindow.CYCLEWAYS_REMOTE_ASSET_BASE = ${JSON.stringify(base)};\n`,
  );
  console.log(`[web-bundle] remote asset base enabled: ${base}`);
}
```

Extend the existing `node:fs/promises` import at the top of the file to include `appendFile`:

```js
import { cp, rm, readdir, stat, writeFile, appendFile } from "node:fs/promises";
```

Note: `appendRemoteAssetBase` must run after `writeMapboxToken` — if no token source exists, `writeMapboxToken` writes nothing and `appendFile` will simply create the file with only the remote-base line, which is still correct.

- [ ] **Step 2: Verify both states**

Flag ON:

```bash
WEBROOT_REMOTE_ASSET_BASE=https://www.cycleways.app npm run bundle:web -w @cycleways/mobile -- --skip-build
grep CYCLEWAYS_REMOTE_ASSET_BASE apps/mobile/webroot/mapbox-token.js
grep CYCLEWAYS_REMOTE_ASSET_BASE apps/mobile/ios/webroot/mapbox-token.js
```

Expected: `window.CYCLEWAYS_REMOTE_ASSET_BASE = "https://www.cycleways.app";` present (and the mirrored `apps/mobile/ios/webroot/mapbox-token.js` matches).

Flag OFF (the shipping default) — rerun to leave a clean state:

```bash
npm run bundle:web -w @cycleways/mobile -- --skip-build
grep CYCLEWAYS_REMOTE_ASSET_BASE apps/mobile/webroot/mapbox-token.js || true
grep CYCLEWAYS_REMOTE_ASSET_BASE apps/mobile/ios/webroot/mapbox-token.js || true
```

Expected: no output from either `grep`.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/scripts/sync-web-bundle.mjs
git commit -m "feat(mobile): env-gated remote asset base for webroot bundle"
```

---

### Task 5: End-to-end verification on device/simulator

**Files:** none (verification only).

**Interfaces:**
- Consumes: the pruned webroot from Task 2.

The critical runtime question is the shard prune: nothing in the route-detail code references `base-routing-shards`, but this step proves it against the real WebView.

- [ ] **Step 1: Full bundle + app run**

```bash
npm run bundle:web -w @cycleways/mobile        # full web build + prune + mirror
npm run ios -w @cycleways/mobile               # preios re-runs bundle + asset sync
```

(If a physical-device run is preferred, use `apps/mobile/scripts/run-on-device.sh` as usual.)

- [ ] **Step 2: Exercise every webroot consumer in the app**

In the running app, for at least two routes (e.g. `banias-gan-hatsafon` and one `sovev-*` route), open the route-detail web page and verify:

- Hero image renders (thumb-resolved).
- POI story list / gallery images render, including tapping a POI to enlarge (the enlarged view uses the thumbnail — confirm no broken image).
- Warnings section images render (if the route has warnings).
- PiP map initializes (mapbox-token.js intact after prune).
- Synced video plays with its poster image.
- GPX download button still works (client-side generation).
- No blank page / infinite spinner (would indicate the WebView needed a pruned file — check the static server's 404s by attaching Safari Web Inspector to the WebView if anything looks off).

If anything breaks because of the shard prune specifically, remove `"public-data/base-routing-shards"` from `WEBSITE_ONLY_PATHS` in `prune-webroot.mjs`, update the expected list in `tests/test-prune-webroot.mjs`, and note it in this plan — the images alone are ~31 MB of the win.

- [ ] **Step 3: Measure the result**

```bash
du -sh apps/mobile/webroot                     # expected ~5 MB (was 42 MB)
```

Then produce a Release build the usual way and record the new `.app` size and zipped size (previous baseline: 129 MB / 81 MB zipped):

```bash
xcodebuild -workspace apps/mobile/ios/CycleWays.xcworkspace -scheme CycleWays -configuration Release -sdk iphoneos -derivedDataPath /tmp/cw-size-check build CODE_SIGNING_ALLOWED=NO
APP=/tmp/cw-size-check/Build/Products/Release-iphoneos/CycleWays.app
du -sh "$APP"
ditto -c -k --sequesterRsrc "$APP" /tmp/cw-app-estimate.zip && du -sh /tmp/cw-app-estimate.zip
```

Expected: ~92 MB on disk, ~46 MB zipped.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all green (including the two new tests).

- [ ] **Step 5: Commit any verification-driven adjustments**

Only needed if Step 2 forced a rule change; otherwise nothing to commit.

---

## Future work (explicitly out of scope now)

- **Enable remote full-size images:** build a lightbox/photo viewer that calls `fullImageSrc`, and set `WEBROOT_REMOTE_ASSET_BASE=https://www.cycleways.app` in the bundle step. No other changes needed.
- **Splash/icon PNG optimization** (~1–1.5 MB): run `assets/splash-screen-ios.png` and `assets/splash-icon.png` through pngquant/oxipng.
- Mapbox/React/Hermes frameworks are at their floor (~20 MB download after App Store compression); no action available.
