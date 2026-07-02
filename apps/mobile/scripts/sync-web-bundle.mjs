// Builds the web app (root `npm run build` → `dist/`) and copies it into the
// mobile app as the static server's `webroot/`. The native app bundles this
// folder and serves it from a local HTTP server, so the route-detail WebView
// loads the real site — HTML/JS/CSS/data/images — fully offline (only map tiles
// and the YouTube video need the network).
//
// The root build runs by default so `npm run ios` can never ship stale web
// code. Skip it (native-only iteration) with --skip-build or SKIP_WEB_BUILD=1.
// `webroot/` is git-ignored (a build artifact); regenerate it as part of the
// mobile build.
import { cp, rm, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(mobileRoot, "../..");
const distDir = path.join(repoRoot, "dist");
const webrootDir = path.join(mobileRoot, "webroot");
const iosWebrootDir = path.join(mobileRoot, "ios/webroot");
const rootTokenFile = path.join(repoRoot, "mapbox-token.js");

const skipBuild =
  process.argv.includes("--skip-build") || process.env.SKIP_WEB_BUILD === "1";

async function main() {
  if (skipBuild) {
    console.log("[web-bundle] skipping root build (SKIP_WEB_BUILD/--skip-build).");
  } else {
    console.log("[web-bundle] running root `npm run build`...");
    const result = spawnSync("npm", ["run", "build"], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      console.error("[web-bundle] root build failed.");
      process.exit(result.status ?? 1);
    }
  }
  if (!existsSync(distDir) || !existsSync(path.join(distDir, "index.html"))) {
    console.error(
      "[web-bundle] dist/ not found or incomplete. Run `npm run build` at the repo root first.",
    );
    process.exit(1);
  }
  if (skipBuild) {
    const distAgeMs =
      Date.now() - (await stat(path.join(distDir, "index.html"))).mtimeMs;
    const distAgeHours = distAgeMs / 3_600_000;
    if (distAgeHours > 1) {
      console.warn(
        `[web-bundle] WARNING: dist/ was built ${distAgeHours.toFixed(1)} h ago — run \`npm run build\` at the repo root if you changed web code.`,
      );
    }
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

  // The web pages load the Mapbox token from `/mapbox-token.js`. The Vite dev
  // server serves it via middleware and the Pages deploy writes it after the
  // build, but a plain `vite build` never emits the file — so the copied
  // webroot has none and every WebView map (route detail + featured PiP map)
  // fails to init. Emit it here, mirroring the Vite plugin's token precedence.
  await writeMapboxToken(webrootDir);

  const routeDirs = (await readdir(path.join(webrootDir, "routes"))).length;
  const bytes = await dirSize(webrootDir);
  console.log(
    `[web-bundle] webroot ready: ${routeDirs} route pages, ${(bytes / 1e6).toFixed(1)} MB at ${path.relative(repoRoot, webrootDir)}`,
  );

  // Mirror into ios/webroot: that copy is what Xcode actually bundles (the
  // withWebroot plugin refreshes it only during prebuild, which `expo run:ios`
  // skips whenever ios/ already exists).
  if (existsSync(path.join(iosWebrootDir, ".."))) {
    await rm(iosWebrootDir, { recursive: true, force: true });
    await cp(webrootDir, iosWebrootDir, { recursive: true });
    console.log(
      `[web-bundle] mirrored into ${path.relative(repoRoot, iosWebrootDir)}`,
    );
  }
}

// Writes `<targetDir>/mapbox-token.js` so the served pages can read
// `window.CYCLEWAYS_MAPBOX_TOKEN`. Precedence mirrors the Vite dev middleware
// (mapboxTokenPlugin): the repo-root token file first, then env tokens. The
// native build's own `EXPO_PUBLIC_MAPBOX_TOKEN` is accepted too so a single
// token configures both the native map and the WebView maps.
async function writeMapboxToken(targetDir) {
  const dest = path.join(targetDir, "mapbox-token.js");
  if (existsSync(rootTokenFile)) {
    await cp(rootTokenFile, dest);
    console.log("[web-bundle] copied repo-root mapbox-token.js into webroot.");
    return;
  }
  const token =
    process.env.MAPBOX_TOKEN ||
    process.env.CYCLEWAYS_MAPBOX_TOKEN ||
    process.env.EXPO_PUBLIC_MAPBOX_TOKEN ||
    "";
  if (token) {
    await writeFile(
      dest,
      `window.CYCLEWAYS_MAPBOX_TOKEN = ${JSON.stringify(token)};\n`,
    );
    console.log("[web-bundle] wrote mapbox-token.js from env token.");
    return;
  }
  console.warn(
    "[web-bundle] WARNING: no Mapbox token found (repo-root mapbox-token.js, " +
      "MAPBOX_TOKEN, CYCLEWAYS_MAPBOX_TOKEN, or EXPO_PUBLIC_MAPBOX_TOKEN). " +
      "WebView maps will not load. Copy mapbox-token.example.js to " +
      "mapbox-token.js at the repo root, or set one of those env vars.",
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
