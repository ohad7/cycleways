import { readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// Directories where full-size images are shipped alongside `<name>-thumb.*`.
// Only files with a `-thumb` sibling are removable; files without thumbs are
// treated as display sources and must remain.
const THUMB_IMAGE_DIRS = [
  "public-data/poi-images",
  "public-data/route-map-images",
];

// Website-only assets that can be dropped from the in-app WebView webroot without
// affecting route-detail pages.
const WEBSITE_ONLY_PATHS = [
  "404.html",
  "CNAME",
  "public-data/base-routing-shards",
  "public-data/exports",
  "robots.txt",
  "sitemap.xml",
];

export async function collectPrunePaths(webrootDir) {
  const paths = [];

  for (const rel of WEBSITE_ONLY_PATHS) {
    if (existsSync(path.join(webrootDir, rel))) {
      paths.push(rel);
    }
  }

  for (const dirRel of THUMB_IMAGE_DIRS) {
    const dir = path.join(webrootDir, dirRel);
    if (!existsSync(dir)) continue;
    const names = await readdir(dir);
    const nameSet = new Set(names);

    for (const name of names) {
      const match = name.match(/^(.+)\.(webp|jpe?g|png)$/i);
      if (!match || match[1].endsWith("-thumb")) continue;
      const [_, stem, ext] = match;
      const thumb = `${stem}-thumb.${ext}`;
      if (nameSet.has(thumb)) {
        paths.push(path.join(dirRel, name));
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
