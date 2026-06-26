import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(mobileRoot, "../..");
const sourceRoot = path.join(repoRoot, "public-data");
const targetRoot = path.join(mobileRoot, "assets/data/public-data");
const generatedFile = path.join(
  repoRoot,
  "packages/core/src/platform/bundledAssets.native.js",
);

const jsonAssets = [
  { logicalPath: "public-data/map-manifest.json" },
  {
    logicalPath: "public-data/bike_roads.geojson",
    targetPath: "public-data/bike_roads.geojson.json",
  },
  { logicalPath: "public-data/segments.json" },
  { logicalPath: "public-data/route-catalog.json" },
  { logicalPath: "public-data/cw-base-index.json" },
  { logicalPath: "public-data/base-routing-shards/manifest.json" },
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

  for (const asset of jsonAssets) {
    await copyLogicalAsset(asset.logicalPath, asset.targetPath);
  }

  for (const asset of extraJsonAssets) {
    await copyAbsoluteAsset(asset.sourceAbsolute, asset.logicalPath);
  }

  // Catalog hero thumbnails for the native Discover cards. Source images are
  // webp, which React Native's core <Image> can't decode on iOS, so convert
  // each to PNG (via macOS sips) at the same logical key.
  const imagePaths = await collectCatalogThumbnailPaths();
  for (const image of imagePaths) {
    await convertWebpToPng(image.sourceLogical, image.targetLogical);
  }

  const shardSourceDir = path.join(sourceRoot, "base-routing-shards/shards");
  const shardNames = (await fs.readdir(shardSourceDir))
    .filter((name) => name.endsWith(".cwb"))
    .sort();
  for (const shardName of shardNames) {
    await copyLogicalAsset(
      `public-data/base-routing-shards/shards/${shardName}`,
    );
  }

  await fs.writeFile(
    generatedFile,
    generateBundledAssetModule(shardNames, imagePaths),
    "utf8",
  );

  console.log(
    `[mobile-assets] copied ${jsonAssets.length + extraJsonAssets.length} JSON assets, ${imagePaths.length} images, and ${shardNames.length} routing shards`,
  );
}

// Returns [{ sourceLogical (webp), targetLogical (png) }] for each catalog
// hero thumbnail. getImageAsset is keyed by the original (webp) logical path so
// callers don't need to know about the png conversion.
async function collectCatalogThumbnailPaths() {
  const catalogPath = path.join(sourceRoot, "route-catalog.json");
  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  const sources = new Set();
  for (const entry of entries) {
    const hero = entry?.heroImage;
    const t = hero?.thumbnail || hero?.photo;
    if (typeof t === "string" && t.startsWith("public-data/")) {
      sources.add(t);
    }
  }
  return [...sources].sort().map((sourceLogical) => ({
    sourceLogical,
    targetLogical: sourceLogical.replace(/\.webp$/i, ".png"),
  }));
}

async function convertWebpToPng(sourceLogical, targetLogical) {
  const sourceRel = sourceLogical.replace(/^public-data\//, "");
  const targetRel = targetLogical.replace(/^public-data\//, "");
  const sourcePath = path.join(sourceRoot, sourceRel);
  const targetPath = path.join(targetRoot, targetRel);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await execFileAsync("sips", [
    "-s",
    "format",
    "png",
    sourcePath,
    "--out",
    targetPath,
  ]);
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

function generateBundledAssetModule(shardNames, imagePaths) {
  const jsonEntries = [
    ...jsonAssets.map((asset) =>
      assetMapEntry(asset.logicalPath, asset.targetPath),
    ),
    ...extraJsonAssets.map((asset) => assetMapEntry(asset.logicalPath)),
  ].join("\n");
  const binaryEntries = shardNames
    .map((name) =>
      assetMapEntry(`public-data/base-routing-shards/shards/${name}`),
    )
    .join("\n");
  const imageEntries = imagePaths
    .map((image) => assetMapEntry(image.sourceLogical, image.targetLogical))
    .join("\n");

  return `// Generated by apps/mobile/scripts/sync-offline-assets.mjs.
// Do not edit by hand. Metro needs these literal require() calls to bundle
// the offline JSON, image, and .cwb routing assets into the native app.

export const JSON_ASSETS = {
${jsonEntries}
};

export const IMAGE_ASSETS = {
${imageEntries}
};

export const BINARY_ASSETS = {
${binaryEntries}
};
`;
}

function assetMapEntry(logicalPath, targetLogicalPath = logicalPath) {
  const requirePath = `../../../../apps/mobile/assets/data/${targetLogicalPath}`;
  return `  ${JSON.stringify(logicalPath)}: require(${JSON.stringify(requirePath)}),`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
