// Copies the built web app (repo-root `dist/`, produced by `npm run build`) into
// the mobile app as the static server's `webroot/`. The native app bundles this
// folder and serves it from a local HTTP server, so the route-detail WebView
// loads the real site — HTML/JS/CSS/data/images — fully offline (only map tiles
// and the YouTube video need the network).
//
// Run AFTER `npm run build` at the repo root. `webroot/` is git-ignored (a build
// artifact); regenerate it as part of the mobile build.
import { cp, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(mobileRoot, "../..");
const distDir = path.join(repoRoot, "dist");
const webrootDir = path.join(mobileRoot, "webroot");

async function main() {
  if (!existsSync(distDir) || !existsSync(path.join(distDir, "index.html"))) {
    console.error(
      "[web-bundle] dist/ not found or incomplete. Run `npm run build` at the repo root first.",
    );
    process.exit(1);
  }
  await rm(webrootDir, { recursive: true, force: true });
  await cp(distDir, webrootDir, { recursive: true });

  // Sanity: the SPA entry + per-route fallbacks + data must be present.
  const checks = ["index.html", "public-data", "routes"];
  const missing = checks.filter((p) => !existsSync(path.join(webrootDir, p)));
  if (missing.length) {
    console.error(`[web-bundle] webroot is missing: ${missing.join(", ")}`);
    process.exit(1);
  }
  const routeDirs = (await readdir(path.join(webrootDir, "routes"))).length;
  const bytes = await dirSize(webrootDir);
  console.log(
    `[web-bundle] webroot ready: ${routeDirs} route pages, ${(bytes / 1e6).toFixed(1)} MB at ${path.relative(repoRoot, webrootDir)}`,
  );
}

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else total += (await stat(full)).size;
  }
  return total;
}

main().catch((error) => {
  console.error("[web-bundle] failed:", error);
  process.exit(1);
});
