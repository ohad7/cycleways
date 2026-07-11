import { cp, copyFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFeaturedRouteSnapshots } from "./lib/featuredRouteSnapshotBuilder.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const distDir = resolve(repoRoot, "dist");

const files = new Set([
  "CNAME",
  "robots.txt",
  "sitemap.xml",
]);

// Image assets live under public/ (Vite's publicDir), which Vite copies into
// the build automatically — so they are not listed here.
const directories = ["icons", "public-data"];

await import("./build-sticker-redirects.mjs");

const dataFiles = ["data/places.json", "data/region-zones.json", "data/sticker-redirects.json"];

for (const filePath of dataFiles) {
  files.add(filePath);
}

await mkdir(distDir, { recursive: true });

// Regenerate route snapshots BEFORE copying public-data/ into dist/ so
// the freshly generated public-data/featured-routes/*.json are included in the
// build. Snapshots are derived public data; never hand-edit them.
{
  const { written, removed, errors } = await buildFeaturedRouteSnapshots({});
  console.log(
    `Route snapshots: ${written.length} written, ${removed.length} removed`,
  );
  if (errors.length > 0) {
    for (const { slug, error } of errors) {
      console.error(`Route snapshot failed for ${slug}: ${error}`);
    }
    throw new Error("route snapshot generation failed");
  }
}

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

const builtIndex = resolve(distDir, "index.html");
if (existsSync(builtIndex)) {
  await copyFile(builtIndex, resolve(distDir, "404.html"));
  console.log("Copied built index.html to 404.html");

  const spaShellDirectories = new Set([
    "featured",
    "routes",
    "privacy",
    "terms",
    "support",
    "s",
  ]);
  try {
    const catalog = JSON.parse(
      await readFile(resolve(repoRoot, "public-data/route-catalog.json"), "utf8"),
    );
    for (const entry of catalog.entries || []) {
      if (typeof entry.slug !== "string") continue;
      if (!/^[a-z0-9-]+$/.test(entry.slug)) {
        console.warn(`Skipping route with unsafe slug: ${entry.slug}`);
        continue;
      }
      spaShellDirectories.add(`routes/${entry.slug}`);
      if (entry.featured) spaShellDirectories.add(`featured/${entry.slug}`);
    }
  } catch (error) {
    console.warn(`Skipping route shells: ${error.message}`);
  }

  for (const directoryPath of spaShellDirectories) {
    const destination = resolve(distDir, directoryPath, "index.html");
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(builtIndex, destination);
    console.log(`Copied SPA shell to ${directoryPath}/index.html`);
  }
} else {
  console.warn("Skipping SPA fallback: dist/index.html is missing");
}
