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

// Full-size images WITH thumb siblings are deleted; thumb versions remain.
await put("public-data/poi-images/poi-aaa.webp");
await put("public-data/poi-images/poi-aaa-thumb.webp");
await put("public-data/route-map-images/slug-map-bbb.webp");
await put("public-data/route-map-images/slug-map-bbb-thumb.webp");

// Full-size image WITHOUT thumb sibling is kept.
await put("public-data/poi-images/solo.webp");

// Website-only paths are deleted.
await put("public-data/base-routing-shards/manifest.json");
await put("public-data/base-routing-shards/shards/g711_664.cwb");
await put("public-data/exports/map.kml");
await put("404.html");
await put("CNAME");
await put("robots.txt");
await put("sitemap.xml");

// App-needed files remain.
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

// Idempotent on a clean tree.
assert.deepEqual(await collectPrunePaths(root), []);
const second = await pruneWebroot(root);
assert.deepEqual(second.removed, []);
assert.equal(second.bytes, 0);

await rm(root, { recursive: true, force: true });
console.log("test-prune-webroot: OK");

