import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createHash } from "crypto";
import sharp from "sharp";
import { routeThumbnailPath } from "@cycleways/core/data/catalog.js";
import { isWarningType, primaryPoiImage } from "@cycleways/core/data/poiTypes.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(mobileRoot, "../..");
const sourceRoot = path.join(repoRoot, "public-data");
const targetRoot = path.join(mobileRoot, "assets/data/public-data");
const generatedFile = path.join(
  repoRoot,
  "packages/core/src/platform/bundledAssets.native.js",
);
const appImageModuleFile = path.join(
  mobileRoot,
  "src/planner/routeImages.js",
);
const appGalleryModuleFile = path.join(
  mobileRoot,
  "src/planner/routeGalleries.js",
);

const jsonAssets = [
  { logicalPath: "public-data/map-manifest.json" },
  { logicalPath: "public-data/route-catalog.json" },
];

// places.json lives under the web data/ dir, not public-data/. Bundle it under a
// public-data logical key so the native catalog/Discover code can load it via
// getJsonAsset("public-data/places.json").
const extraJsonAssets = [
  {
    logicalPath: "public-data/places.json",
    sourceAbsolute: path.join(repoRoot, "data/places.json"),
  },
];

async function main() {
  await fs.rm(targetRoot, { recursive: true, force: true });
  await fs.mkdir(targetRoot, { recursive: true });

  const mapManifest = JSON.parse(
    await fs.readFile(path.join(sourceRoot, "map-manifest.json"), "utf8"),
  );
  const manifestAssets = manifestReferencedJsonAssets(mapManifest);
  const snapshotAssets = await featuredRouteSnapshotAssets(mapManifest);
  const videoAssets = await featuredVideoAssets();
  const allJsonAssets = dedupeLogicalAssets([
    ...jsonAssets,
    ...manifestAssets,
    ...snapshotAssets,
    ...videoAssets,
  ]);

  await verifyManifestAssetHashes(mapManifest);

  for (const asset of allJsonAssets) {
    await copyLogicalAsset(asset.logicalPath, asset.targetPath);
  }

  for (const asset of extraJsonAssets) {
    await copyAbsoluteAsset(asset.sourceAbsolute, asset.logicalPath);
  }

  // Catalog hero thumbnails (Discover cards) + on-route POI thumbnails (the
  // "נקודות עניין בדרך" panel) + per-route snapshot POI thumbnails. Source
  // images are webp, which React Native's core <Image> can't decode on iOS, so
  // transcode each to JPG (via sharp, the same image lib the editor uses) at
  // the same logical key. JPG keeps photo thumbnails small (~10x smaller than
  // PNG). Deduped by source path.
  const imagePaths = dedupeBySource([
    ...(await collectCatalogThumbnailPaths(mapManifest)),
    ...(await collectPoiThumbnailPaths(mapManifest)),
    ...(await collectSnapshotImagePaths(mapManifest)),
  ]);
  for (const image of imagePaths) {
    await convertWebpToJpg(image.sourceLogical, image.targetLogical);
  }

  const routingBinaries = await manifestRoutingBinaryAssets(mapManifest);
  for (const asset of routingBinaries) {
    await copyLogicalAsset(asset.logicalPath);
  }

  await fs.writeFile(
    generatedFile,
    generateBundledAssetModule(allJsonAssets, routingBinaries),
    "utf8",
  );

  // Image require map authored INSIDE apps/mobile. Metro does not serve images
  // require()d from the symlinked @cycleways/core workspace package, so the
  // route-card thumbnails must be required from within the app package itself.
  await fs.writeFile(appImageModuleFile, generateAppImageModule(imagePaths), "utf8");

  // Per-route gallery manifest (slug -> ordered thumbnail logical paths) + the
  // set of slugs that have a synced video, for the rich Discover cards. Keyed by
  // the original webp paths so the card resolves them through ROUTE_IMAGES.
  const galleries = await collectRouteGalleries(mapManifest);
  await fs.writeFile(
    appGalleryModuleFile,
    generateRouteGalleriesModule(galleries),
    "utf8",
  );

  console.log(
    `[mobile-assets] copied ${allJsonAssets.length + extraJsonAssets.length} JSON assets, ${imagePaths.length} images, and ${routingBinaries.length} routing shards`,
  );
}

// One { logicalPath } entry per catalog slug for public-data/featured-routes/<slug>.json.
async function featuredRouteSnapshotAssets(manifest = {}) {
  const catalogRelative = manifest.routeCatalog || "route-catalog.json";
  const snapshotsBase = manifest.featuredRoutesBase || "featured-routes";
  const catalogPath = path.join(sourceRoot, catalogRelative);
  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  return entries
    .map((e) => e.slug)
    .filter(Boolean)
    .map((slug) => ({ logicalPath: `public-data/${snapshotsBase}/${slug}.json` }));
}

// The route-video index + per-route keyframe files, so the native synced-video
// player can load them offline via getJsonAsset.
async function featuredVideoAssets() {
  const indexPath = path.join(sourceRoot, "route-videos/index.json");
  let index;
  try {
    index = JSON.parse(await fs.readFile(indexPath, "utf8"));
  } catch {
    return [];
  }
  const files = new Set(["index.json", ...Object.values(index?.routes || {})]);
  return [...files]
    .filter(Boolean)
    .map((file) => ({ logicalPath: `public-data/route-videos/${file}` }));
}

// POI image paths referenced by per-route snapshot files, so ROUTE_IMAGES
// covers detail-screen thumbnails too.
async function collectSnapshotImagePaths(manifest = {}) {
  const sources = new Set();
  const dir = path.join(sourceRoot, manifest.featuredRoutesBase || "featured-routes");
  let files = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  for (const file of files) {
    const snap = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
    const points = snap?.pois?.activeDataPoints || [];
    for (const p of points) {
      const imgs = Array.isArray(p?.images) ? p.images : [];
      for (const img of imgs) {
        const t = (img?.thumbnail || img?.photo || "").trim();
        if (t.startsWith("public-data/")) sources.add(t);
      }
    }
  }
  return [...sources].sort().map((sourceLogical) => ({
    sourceLogical,
    targetLogical: sourceLogical.replace(/\.webp$/i, ".jpg"),
  }));
}

// Per-route Discover-card gallery: the card display thumbnail followed by the
// route's POI thumbnails (in route order), keyed by webp logical paths so the
// card resolves them through ROUTE_IMAGES. Plus the set of slugs with a video.
async function collectRouteGalleries(manifest = {}) {
  const catalog = JSON.parse(
    await fs.readFile(
      path.join(sourceRoot, manifest.routeCatalog || "route-catalog.json"),
      "utf8",
    ),
  );
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  const galleries = {};
  for (const entry of entries) {
    if (!entry?.slug) continue;
    const ordered = [];
    const seen = new Set();
    const add = (t) => {
      if (
        typeof t === "string" &&
        t.startsWith("public-data/") &&
        /\.webp$/i.test(t) &&
        !seen.has(t)
      ) {
        seen.add(t);
        ordered.push(t);
      }
    };
    add(routeThumbnailPath(entry));
    let snap = null;
    try {
      snap = JSON.parse(
        await fs.readFile(
          path.join(
            sourceRoot,
            manifest.featuredRoutesBase || "featured-routes",
            `${entry.slug}.json`,
          ),
          "utf8",
        ),
      );
    } catch {
      // no snapshot for this slug — gallery is just the display thumbnail
    }
    for (const p of snap?.pois?.activeDataPoints || []) {
      const img = Array.isArray(p?.images) ? p.images[0] : null;
      add(img?.thumbnail || img?.photo);
    }
    galleries[entry.slug] = ordered;
  }
  let videoSlugs = [];
  try {
    const index = JSON.parse(
      await fs.readFile(path.join(sourceRoot, "route-videos/index.json"), "utf8"),
    );
    videoSlugs = Object.keys(index?.routes || {});
  } catch {
    // no video index — no video badges
  }
  return { galleries, videoSlugs };
}

function generateRouteGalleriesModule({ galleries, videoSlugs }) {
  return `// Generated by apps/mobile/scripts/sync-offline-assets.mjs. Do not edit.
// Per-route Discover-card gallery: ordered thumbnail logical paths (resolve via
// ROUTE_IMAGES) + the set of slugs with a synced video (for the play badge).

export const ROUTE_GALLERIES = ${JSON.stringify(galleries, null, 2)};

export const ROUTE_VIDEO_SLUGS = new Set(${JSON.stringify(videoSlugs)});
`;
}

// Returns [{ sourceLogical (webp), targetLogical (jpg) }] for each catalog
// hero thumbnail. Keyed by the original (webp) logical path so callers don't
// need to know about the jpg transcode.
async function collectCatalogThumbnailPaths(manifest = {}) {
  const catalogPath = path.join(
    sourceRoot,
    manifest.routeCatalog || "route-catalog.json",
  );
  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  const sources = new Set();
  for (const entry of entries) {
    // Same resolver the native Discover card uses (heroImage -> start/end POI
    // photo -> ...), so every route whose card shows a photo has it bundled.
    const t = routeThumbnailPath(entry);
    if (typeof t === "string" && t.startsWith("public-data/")) {
      sources.add(t);
    }
  }
  return [...sources].sort().map((sourceLogical) => ({
    sourceLogical,
    targetLogical: sourceLogical.replace(/\.webp$/i, ".jpg"),
  }));
}

// Primary thumbnails of every on-route POI (non-warning data point) across all
// segments, so the native "נקודות עניין בדרך" panel has its photos offline.
async function collectPoiThumbnailPaths(manifest = {}) {
  const segmentsPath = path.join(sourceRoot, manifest.segments || "segments.json");
  const segments = JSON.parse(await fs.readFile(segmentsPath, "utf8"));
  const sources = new Set();
  for (const segmentInfo of Object.values(segments || {})) {
    const data = Array.isArray(segmentInfo?.data) ? segmentInfo.data : [];
    for (const dataPoint of data) {
      if (isWarningType(dataPoint?.type)) continue;
      const image = primaryPoiImage(dataPoint);
      const t = image?.thumbnail || image?.photo;
      if (typeof t === "string" && t.startsWith("public-data/")) sources.add(t);
    }
  }
  return [...sources].sort().map((sourceLogical) => ({
    sourceLogical,
    targetLogical: sourceLogical.replace(/\.webp$/i, ".jpg"),
  }));
}

function dedupeBySource(images) {
  const bySource = new Map();
  for (const image of images) bySource.set(image.sourceLogical, image);
  return [...bySource.values()].sort((a, b) =>
    a.sourceLogical.localeCompare(b.sourceLogical),
  );
}

async function convertWebpToJpg(sourceLogical, targetLogical) {
  const sourceRel = sourceLogical.replace(/^public-data\//, "");
  const targetRel = targetLogical.replace(/^public-data\//, "");
  const sourcePath = path.join(sourceRoot, sourceRel);
  const targetPath = path.join(targetRoot, targetRel);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await sharp(sourcePath)
    .flatten({ background: "#ffffff" }) // JPG has no alpha; composite onto white
    .jpeg({ quality: 80 })
    .toFile(targetPath);
}

async function copyLogicalAsset(logicalPath, targetLogicalPath = logicalPath) {
  const relativePath = logicalPath.replace(/^public-data\//, "");
  const targetRelativePath = targetLogicalPath.replace(/^public-data\//, "");
  const sourcePath = path.join(sourceRoot, relativePath);
  const targetPath = path.join(targetRoot, targetRelativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
}

async function copyAbsoluteAsset(sourceAbsolute, targetLogicalPath) {
  const targetRelativePath = targetLogicalPath.replace(/^public-data\//, "");
  const targetPath = path.join(targetRoot, targetRelativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourceAbsolute, targetPath);
}

function generateBundledAssetModule(jsonList, routingBinaries) {
  const jsonEntries = [
    ...jsonList.map((asset) =>
      assetMapEntry(asset.logicalPath, asset.targetPath),
    ),
    ...extraJsonAssets.map((asset) => assetMapEntry(asset.logicalPath)),
  ].join("\n");
  const binaryEntries = routingBinaries
    .map((asset) => assetMapEntry(asset.logicalPath))
    .join("\n");

  return `// Generated by apps/mobile/scripts/sync-offline-assets.mjs.
// Do not edit by hand. Metro needs these literal require() calls to bundle
// the offline JSON and .cwb routing assets into the native app.

export const JSON_ASSETS = {
${jsonEntries}
};

export const BINARY_ASSETS = {
${binaryEntries}
};
`;
}

// Image require map authored inside apps/mobile (require paths are relative to
// apps/mobile/src/planner/). Keyed by the catalog's original (webp) logical path
// so RouteCard can look up by routeThumbnailPath(entry).
function generateAppImageModule(imagePaths) {
  const entries = imagePaths
    .map((image) => {
      const targetRel = image.targetLogical.replace(/^public-data\//, "");
      const requirePath = `../../assets/data/public-data/${targetRel}`;
      return `  ${JSON.stringify(image.sourceLogical)}: require(${JSON.stringify(requirePath)}),`;
    })
    .join("\n");
  return `// Generated by apps/mobile/scripts/sync-offline-assets.mjs.
// Do not edit by hand. Bundled route images: Discover-card hero thumbnails AND
// on-route POI thumbnails ("נקודות עניין בדרך"), required from within the app
// package (Metro won't serve images required from the @cycleways/core workspace
// package). Keyed by the original webp logical path; the bundled file is a jpg
// (RN core <Image> can't decode webp on iOS).

export const ROUTE_IMAGES = {
${entries}
};
`;
}

function assetMapEntry(logicalPath, targetLogicalPath = logicalPath) {
  const requirePath = `../../../../apps/mobile/assets/data/${targetLogicalPath}`;
  return `  ${JSON.stringify(logicalPath)}: require(${JSON.stringify(requirePath)}),`;
}

export function optionalManifestJsonAssets(manifest = {}) {
  return [manifest.roundabouts, manifest.crossings, manifest.networkJunctions]
    .filter(Boolean)
    .map((relative) => ({ logicalPath: `public-data/${String(relative).replace(/^\/+/, "")}` }));
}

export function manifestReferencedJsonAssets(manifest = {}) {
  const assets = [];
  const add = (relativePath, targetPath = null) => {
    if (!relativePath) return;
    const clean = String(relativePath).replace(/^\/+/, "");
    assets.push({
      logicalPath: `public-data/${clean}`,
      ...(targetPath ? { targetPath } : {}),
    });
  };
  add(
    manifest.bikeRoads,
    manifest.bikeRoads
      ? `public-data/${String(manifest.bikeRoads).replace(/^\/+/, "")}.json`
      : null,
  );
  add(manifest.segments);
  add(manifest.cwBaseIndex);
  add(manifest.baseRoutingShards);
  add(manifest.roundabouts);
  add(manifest.crossings);
  add(manifest.networkJunctions);
  add(manifest.cwAlignmentGeometry);
  add(manifest.legacyRoutingCompatibility?.cwBaseIndex);
  add(manifest.legacyRoutingCompatibility?.metadata);
  add(manifest.routeCatalog);
  return dedupeLogicalAssets(assets);
}

async function manifestRoutingBinaryAssets(manifest) {
  if (!manifest?.baseRoutingShards) return [];
  const relativeManifest = String(manifest.baseRoutingShards).replace(/^\/+/, "");
  const shardManifest = JSON.parse(
    await fs.readFile(path.join(sourceRoot, relativeManifest), "utf8"),
  );
  const baseDir = path.posix.dirname(relativeManifest);
  const assets = [];
  for (const entry of shardManifest.shards || []) {
    const compact = entry?.formats?.compact;
    const relative = compact?.path || entry?.path;
    if (!relative) throw new Error(`Routing shard ${entry?.id || "unknown"} has no path`);
    const logicalPath = `public-data/${path.posix.join(baseDir, relative)}`;
    const sourcePath = path.join(sourceRoot, path.posix.join(baseDir, relative));
    const digest = await sha256File(sourcePath);
    const expected = compact?.sha256;
    if (expected && digest !== expected) {
      throw new Error(`Routing shard digest mismatch: ${entry.id}`);
    }
    assets.push({ logicalPath, sha256: digest });
  }
  return assets.sort((a, b) => a.logicalPath.localeCompare(b.logicalPath));
}

async function verifyManifestAssetHashes(manifest) {
  const references = {
    bikeRoads: manifest.bikeRoads,
    segments: manifest.segments,
    cwBaseIndex: manifest.cwBaseIndex,
    baseRoutingShards: manifest.baseRoutingShards,
    roundabouts: manifest.roundabouts,
    crossings: manifest.crossings,
    networkJunctions: manifest.networkJunctions,
    cwAlignmentGeometry: manifest.cwAlignmentGeometry,
    legacyCwBaseIndex: manifest.legacyRoutingCompatibility?.cwBaseIndex,
    legacyRoutingCompatibilityMetadata:
      manifest.legacyRoutingCompatibility?.metadata,
    routeCatalog: manifest.routeCatalog,
  };
  for (const [key, relative] of Object.entries(references)) {
    const expected = manifest.hashes?.[key];
    if (!relative || !expected) continue;
    const actual = await sha256File(
      path.join(sourceRoot, String(relative).replace(/^\/+/, "")),
    );
    if (actual !== expected) throw new Error(`Manifest asset digest mismatch: ${key}`);
  }
  const legacy = manifest.legacyRoutingCompatibility;
  if (
    legacy?.cwBaseIndexSha256 &&
    legacy.cwBaseIndexSha256 !== manifest.hashes?.legacyCwBaseIndex
  ) {
    throw new Error("Legacy compatibility index hash disagrees with map manifest");
  }
  if (manifest.releaseIndex) {
    if (
      manifest.hashes?.routeCatalog !==
      manifest.releaseIndex.routeCatalogSha256
    ) {
      throw new Error("Route catalog digest disagrees with release index");
    }
    const releaseDigest = createHash("sha256")
      .update(JSON.stringify(manifest.releaseIndex))
      .digest("hex");
    if (releaseDigest !== manifest.releaseBundleDigest) {
      throw new Error("Release bundle digest mismatch");
    }
    const snapshotHashes = {};
    for (const slug of Object.keys(
      manifest.releaseIndex.featuredRouteSnapshotHashes || {},
    ).sort()) {
      const expected = manifest.releaseIndex.featuredRouteSnapshotHashes[slug];
      const actual = await sha256File(
        path.join(
          sourceRoot,
          manifest.featuredRoutesBase,
          `${slug}.json`,
        ),
      );
      if (actual !== expected) {
        throw new Error(`Featured route snapshot digest mismatch: ${slug}`);
      }
      snapshotHashes[slug] = actual;
    }
    const snapshotIndexDigest = createHash("sha256")
      .update(JSON.stringify(snapshotHashes))
      .digest("hex");
    if (snapshotIndexDigest !== manifest.hashes?.featuredRouteSnapshots) {
      throw new Error("Featured route snapshot index digest mismatch");
    }
  }
}

async function sha256File(filePath) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

function dedupeLogicalAssets(assets) {
  const byLogicalPath = new Map();
  for (const asset of assets) byLogicalPath.set(asset.logicalPath, asset);
  return [...byLogicalPath.values()].sort((a, b) =>
    a.logicalPath.localeCompare(b.logicalPath),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
