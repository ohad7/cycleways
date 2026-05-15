import { cp, copyFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const distDir = resolve(repoRoot, "dist");

const files = new Set([
  "CNAME",
  "robots.txt",
  "sitemap.xml",
  "map-manifest.json",
  "bike_roads_v18.geojson",
  "segments.json",
  "route-manager.js",
]);

const directories = ["attached_assets", "exports", "icons"];

const manifestPath = resolve(repoRoot, "map-manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const filePath of [manifest.bikeRoads, manifest.segments, manifest.kml]) {
    if (filePath) {
      files.add(filePath);
    }
  }

  for (const filePath of [
    manifest.stable?.bikeRoads,
    manifest.stable?.segments,
    manifest.stable?.kml,
  ]) {
    if (filePath && existsSync(resolve(repoRoot, filePath))) {
      files.add(filePath);
    }
  }
}

await mkdir(distDir, { recursive: true });

for (const filePath of files) {
  const source = resolve(repoRoot, filePath);
  if (!existsSync(source)) {
    console.warn(`Skipping missing static asset: ${filePath}`);
    continue;
  }

  const destination = resolve(distDir, filePath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  console.log(`Copied ${filePath}`);
}

for (const directoryPath of directories) {
  const source = resolve(repoRoot, directoryPath);
  if (!existsSync(source)) {
    console.warn(`Skipping missing static directory: ${directoryPath}`);
    continue;
  }

  await cp(source, resolve(distDir, directoryPath), {
    recursive: true,
    force: true,
  });
  console.log(`Copied ${directoryPath}/`);
}
