#!/usr/bin/env node
import { createServer } from "node:http";
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream, watch } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, extname, isAbsolute, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..");
const editorRoot = resolve(repoRoot, "editor");
const iconsRoot = resolve(repoRoot, "icons");
const sourcePath = resolve(repoRoot, "data/map-source.geojson");
const tokenPath = resolve(repoRoot, "mapbox-token.js");
const buildDir = resolve(repoRoot, "build");
const reportPath = resolve(buildDir, "report.json");
const buildManifestPath = resolve(buildDir, "map-manifest.json");
const buildGeojsonPath = resolve(buildDir, "bike_roads.geojson");
const buildSegmentsPath = resolve(buildDir, "segments.json");
const buildKmlPath = resolve(buildDir, "map.kml");
const promotedGeojsonPath = resolve(repoRoot, "bike_roads_v18.geojson");
const promotedSegmentsPath = resolve(repoRoot, "segments.json");
const promotedKmlPath = resolve(repoRoot, "exports/map.kml");
const promotedManifestPath = resolve(repoRoot, "map-manifest.json");
const port = Number(process.env.EDITOR_PORT || 8899);
const devReloadEnabled = process.env.EDITOR_DEV_RELOAD === "1";
let requestCounter = 0;
let buildCounter = 0;
let promoteCounter = 0;
const devReloadClients = new Set();

const qualityKeys = ["overall", "safety", "comfort", "scenery"];

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
]);

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(text);
}

function sendJavaScript(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(text);
}

function sendHtml(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(text);
}

function formatLogDetail(detail) {
  if (detail === undefined || detail === null) {
    return "";
  }
  if (typeof detail === "string") {
    return ` ${detail}`;
  }
  try {
    return ` ${JSON.stringify(detail)}`;
  } catch {
    return ` ${String(detail)}`;
  }
}

function log(level, message, detail) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}${formatLogDetail(detail)}`;
  if (level === "error" || level === "warn") {
    console.error(line);
    return;
  }
  console.log(line);
}

function logApi(requestId, message, detail) {
  log("info", `api#${requestId} ${message}`, detail);
}

function repoRelative(path) {
  return relative(repoRoot, path) || ".";
}

function summarizeSource(source) {
  const features = Array.isArray(source?.features) ? source.features : [];
  let active = 0;
  let deprecated = 0;
  let dataMarkers = 0;
  let qualityRecords = 0;

  for (const feature of features) {
    const properties = feature?.properties || {};
    const status = properties.status || "active";
    if (status === "deprecated" || properties.deprecated) {
      deprecated += 1;
    } else if (feature?.geometry?.type === "LineString") {
      active += 1;
    }
    dataMarkers += Array.isArray(properties.data) ? properties.data.length : 0;
    if (properties.quality !== undefined) {
      qualityRecords += 1;
    }
  }

  return {
    records: features.length,
    active,
    deprecated,
    dataMarkers,
    qualityRecords,
  };
}

function summarizeReport(report) {
  const validation = report?.validation || {};
  const elevation = report?.elevation || {};
  const topology = validation.topology || {};
  return {
    version: report?.outputs?.versioned?.version,
    features: validation.featureCount,
    segmentRecords: validation.segmentsCount,
    newSegments: (validation.newSegments || []).length,
    routeWarnings: (validation.routeCompatibilityWarnings || []).length,
    activeSplitNumberedNames: (validation.activeSplitNumberedNames || []).length,
    elevation: {
      skip: elevation.skipElevation,
      lookups: elevation.lookups,
      cacheHits: elevation.cacheHits,
      skipped: elevation.skipped,
      failures: elevation.failures,
    },
    topology: {
      components: topology.connectedComponents,
      orphanEndpoints: topology.orphanEndpointCount,
    },
  };
}

function sendDevReloadEvent(response, event, payload) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function handleDevReloadEvents(request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  response.write(": connected\n\n");
  devReloadClients.add(response);
  request.on("close", () => {
    devReloadClients.delete(response);
  });
}

function broadcastDevReload(reason) {
  if (devReloadClients.size === 0) return;
  log("info", "dev reload broadcast", { reason, clients: devReloadClients.size });
  for (const client of devReloadClients) {
    try {
      sendDevReloadEvent(client, "reload", { reason });
    } catch {
      devReloadClients.delete(client);
    }
  }
}

function injectDevReloadClient(html) {
  const script = `
<script>
(() => {
  let connected = false;
  let reloadTimer = null;
  const source = new EventSource("/api/dev/events");
  source.addEventListener("open", () => {
    connected = true;
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
  });
  source.addEventListener("reload", () => {
    window.location.reload();
  });
  source.addEventListener("error", () => {
    if (!connected || reloadTimer) return;
    reloadTimer = setTimeout(() => {
      window.location.reload();
    }, 900);
  });
})();
</script>`;
  if (html.includes("</body>")) {
    return html.replace("</body>", `${script}\n  </body>`);
  }
  return `${html}\n${script}\n`;
}

function startDevReloadWatcher() {
  if (!devReloadEnabled) return;

  let reloadTimer = null;
  const clientFilePattern = /\.(css|html|js)$/;
  const ignoredFiles = new Set(["server.mjs", "dev-server.mjs"]);
  try {
    const watcher = watch(editorRoot, { persistent: false }, (_eventType, filename) => {
      if (!filename) return;
      const fileName = String(filename);
      if (ignoredFiles.has(fileName) || !clientFilePattern.test(fileName)) return;
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => broadcastDevReload(fileName), 120);
    });
    watcher.unref?.();
    log("info", "dev reload watcher enabled", {
      editorRoot: repoRelative(editorRoot),
    });
  } catch (error) {
    log("warn", "dev reload watcher could not start", error instanceof Error ? error.message : String(error));
  }
}

function createLineLogger(level, prefix, append) {
  let pending = "";
  return {
    write(chunk) {
      const text = chunk.toString();
      append(text);
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          log(level, `${prefix} ${line}`);
        }
      }
    },
    flush() {
      if (pending.trim()) {
        log(level, `${prefix} ${pending}`);
      }
      pending = "";
    },
  };
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel && !rel.startsWith("..") && !rel.startsWith("/");
}

function resolveManifestPath(root, manifestPath) {
  if (typeof manifestPath !== "string" || manifestPath.trim() === "" || isAbsolute(manifestPath)) {
    throw new Error(`Invalid manifest path: ${manifestPath}`);
  }
  const resolved = resolve(root, manifestPath);
  if (!isInside(root, resolved)) {
    throw new Error(`Manifest path escapes repository root: ${manifestPath}`);
  }
  return resolved;
}

async function readRequestJson(request, limitBytes = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) {
      throw new Error("Request body is too large");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function validateSourceGeojson(source) {
  if (!source || source.type !== "FeatureCollection" || !Array.isArray(source.features)) {
    throw new Error("Source must be a GeoJSON FeatureCollection");
  }

  const ids = new Set();
  const names = new Set();

  for (const [index, feature] of source.features.entries()) {
    if (!feature || feature.type !== "Feature") {
      throw new Error(`Feature ${index} is not a GeoJSON Feature`);
    }
    if (!feature.properties || typeof feature.properties !== "object") {
      throw new Error(`Feature ${index} is missing properties`);
    }

    const { id, name } = feature.properties;
    if (id !== undefined && id !== null) {
      if (!Number.isInteger(id)) {
        throw new Error(`Feature ${index} has a non-integer id`);
      }
      if (ids.has(id)) {
        throw new Error(`Duplicate segment id ${id}`);
      }
      ids.add(id);
    }
    if (name) {
      if (names.has(name)) {
        throw new Error(`Duplicate segment name ${name}`);
      }
      names.add(name);
    }

    const status = feature.properties.status || "active";
    const activeLine =
      feature.geometry?.type === "LineString" &&
      !feature.properties.deprecated &&
      !["deprecated", "draft", "legacy"].includes(status);
    validateQuality(feature.properties.quality, name || index, activeLine);

    if (feature.properties.data !== undefined) {
      if (!Array.isArray(feature.properties.data)) {
        throw new Error(`Feature ${name || index} has non-array data markers`);
      }
      for (const [markerIndex, marker] of feature.properties.data.entries()) {
        if (!marker || typeof marker !== "object" || Array.isArray(marker)) {
          throw new Error(`Feature ${name || index} data marker ${markerIndex} is invalid`);
        }
        if (typeof marker.type !== "string" || marker.type.trim() === "") {
          throw new Error(`Feature ${name || index} data marker ${markerIndex} is missing a type`);
        }
        if (marker.information !== undefined && typeof marker.information !== "string") {
          throw new Error(`Feature ${name || index} data marker ${markerIndex} has invalid information`);
        }
        const location = marker.location;
        if (
          !Array.isArray(location) ||
          location.length < 2 ||
          typeof location[0] !== "number" ||
          typeof location[1] !== "number" ||
          location[0] < -90 ||
          location[0] > 90 ||
          location[1] < -180 ||
          location[1] > 180
        ) {
          throw new Error(`Feature ${name || index} data marker ${markerIndex} has invalid location`);
        }
      }
    }

    if (feature.properties.routeAnchors !== undefined) {
      if (!Array.isArray(feature.properties.routeAnchors)) {
        throw new Error(`Feature ${name || index} has non-array routeAnchors`);
      }
      for (const [anchorIndex, anchor] of feature.properties.routeAnchors.entries()) {
        if (
          !Array.isArray(anchor) ||
          anchor.length < 2 ||
          typeof anchor[0] !== "number" ||
          typeof anchor[1] !== "number" ||
          anchor[0] < -180 ||
          anchor[0] > 180 ||
          anchor[1] < -90 ||
          anchor[1] > 90
        ) {
          throw new Error(`Feature ${name || index} route anchor ${anchorIndex} must be [lng, lat]`);
        }
      }
    }

    if (feature.geometry === null) {
      continue;
    }
    if (feature.geometry?.type !== "LineString") {
      throw new Error(`Feature ${name || index} must be LineString or null geometry`);
    }
    const coords = feature.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      throw new Error(`Feature ${name || index} must have at least two coordinates`);
    }
    for (const coord of coords) {
      if (
        !Array.isArray(coord) ||
        coord.length < 2 ||
        typeof coord[0] !== "number" ||
        typeof coord[1] !== "number"
      ) {
        throw new Error(`Feature ${name || index} has invalid coordinates`);
      }
    }
  }
}

function validateQuality(quality, featureLabel, required) {
  if (quality === undefined || quality === null) {
    if (required) {
      throw new Error(`Feature ${featureLabel} is missing quality`);
    }
    return;
  }

  if (typeof quality !== "object" || Array.isArray(quality)) {
    throw new Error(`Feature ${featureLabel} quality must be an object`);
  }

  for (const key of Object.keys(quality)) {
    if (!qualityKeys.includes(key)) {
      throw new Error(`Feature ${featureLabel} quality has unsupported field ${key}`);
    }
  }

  for (const key of qualityKeys) {
    const value = quality[key];
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new Error(`Feature ${featureLabel} quality.${key} must be an integer from 1 to 5`);
    }
  }
}

async function serveStatic(request, response, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/" || pathname === "/editor") {
    pathname = "/editor/";
  }
  if (pathname === "/editor/") {
    pathname = "/editor/index.html";
  }

  const filePath = resolve(repoRoot, `.${pathname}`);
  const allowedEditorFile = isInside(editorRoot, filePath) || filePath === resolve(editorRoot, "index.html");
  const allowedIconFile = isInside(iconsRoot, filePath);
  const allowedTokenFile = filePath === tokenPath;
  if (!allowedEditorFile && !allowedIconFile && !allowedTokenFile) {
    sendText(response, 404, "Not found");
    return;
  }

  if (allowedTokenFile) {
    await serveTokenFile(response);
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }
    if (devReloadEnabled && filePath === resolve(editorRoot, "index.html")) {
      const html = await readFile(filePath, "utf-8");
      sendHtml(response, 200, injectDevReloadClient(html));
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(extname(filePath)) || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not found");
  }
}

async function serveTokenFile(response) {
  try {
    const fileStat = await stat(tokenPath);
    if (fileStat.isFile()) {
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      createReadStream(tokenPath).pipe(response);
      return;
    }
  } catch {
    // Fall through to an environment/localStorage-friendly stub.
  }

  const token = process.env.MAPBOX_TOKEN || process.env.CYCLEWAYS_MAPBOX_TOKEN || "";
  if (token) {
    sendJavaScript(
      response,
      200,
      `window.CYCLEWAYS_MAPBOX_TOKEN = ${JSON.stringify(token)};\n`,
    );
    return;
  }

  sendJavaScript(
    response,
    200,
    [
      "window.CYCLEWAYS_MAPBOX_TOKEN = window.CYCLEWAYS_MAPBOX_TOKEN || '';",
      "console.warn('Mapbox token file not found. Copy mapbox-token.example.js to mapbox-token.js or set localStorage cycleways.mapboxToken.');",
      "",
    ].join("\n"),
  );
}

async function handleBuild(payload) {
  const buildId = ++buildCounter;
  const startedAt = Date.now();
  const args = [
    "processing/build_map.py",
    "--input-geojson",
    "data/map-source.geojson",
    "--out-dir",
    "build",
    "--verbose",
  ];

  if (payload.skipElevation) {
    args.push("--skip-elevation");
  }

  if (payload.elevationUrl) {
    args.push("--elevation-url", String(payload.elevationUrl));
  }

  log("info", `build#${buildId} started`, {
    mode: payload.skipElevation ? "preview-skip-elevation" : "full-elevation",
    command: `python3 ${args.join(" ")}`,
  });

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("python3", args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const stdoutLogger = createLineLogger("info", `build#${buildId} stdout`, (text) => {
      stdout += text;
    });
    const stderrLogger = createLineLogger("info", `build#${buildId} stderr`, (text) => {
      stderr += text;
    });
    const heartbeat = setInterval(() => {
      log("info", `build#${buildId} still running`, {
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
        stdoutBytes: stdout.length,
        stderrBytes: stderr.length,
      });
    }, 10000);
    heartbeat.unref();

    child.stdout.on("data", (chunk) => {
      stdoutLogger.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrLogger.write(chunk);
    });
    child.on("error", (error) => {
      clearInterval(heartbeat);
      stdoutLogger.flush();
      stderrLogger.flush();
      log("error", `build#${buildId} failed to start`, error.message);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearInterval(heartbeat);
      stdoutLogger.flush();
      stderrLogger.flush();
      const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (code !== 0) {
        log("error", `build#${buildId} failed`, {
          exitCode: code,
          durationSeconds,
        });
        rejectPromise(new Error(stderr || stdout || `Build failed with exit code ${code}`));
        return;
      }
      log("info", `build#${buildId} finished`, {
        durationSeconds,
      });
      resolvePromise({ buildId, stdout, stderr, durationSeconds });
    });
  });
}

function validationBlockers(report) {
  const validation = report?.validation || {};
  const elevation = report?.elevation || {};
  const blockers = [];

  if (!elevation.skipElevation && (elevation.failures || 0) > 0) {
    blockers.push(`${elevation.failures} elevation lookup failures`);
  }

  if ((validation.duplicateFeatureNames || []).length > 0) {
    blockers.push("duplicate feature names");
  }
  if (Object.keys(validation.duplicateIds || {}).length > 0) {
    blockers.push("duplicate segment IDs");
  }
  if ((validation.invalidDataMarkers || []).length > 0) {
    blockers.push("invalid data markers");
  }
  if ((validation.activeMissingMiddle || []).length > 0) {
    blockers.push("active segments missing middle points");
  }
  if ((validation.activeSplitNumberedNames || []).length > 0) {
    blockers.push("active split children with numbered names");
  }

  return blockers;
}

async function copyFileAtomic(source, target) {
  await mkdir(dirname(target), { recursive: true });
  const tmpPath = `${target}.tmp`;
  await copyFile(source, tmpPath);
  await rename(tmpPath, target);
}

async function existingVersionedFiles(directory, pattern) {
  try {
    const names = await readdir(directory);
    return names
      .filter((name) => pattern.test(name))
      .map((name) => resolve(directory, name));
  } catch {
    return [];
  }
}

async function cleanupOldVersionedArtifacts(manifest, promoteId, dryRun) {
  const keep = new Set([
    resolveManifestPath(repoRoot, manifest.bikeRoads),
    resolveManifestPath(repoRoot, manifest.segments),
    resolveManifestPath(repoRoot, manifest.kml),
  ]);
  const candidates = [
    ...(await existingVersionedFiles(repoRoot, /^bike_roads\.[0-9a-f]{12}\.geojson$/)),
    ...(await existingVersionedFiles(repoRoot, /^segments\.[0-9a-f]{12}\.json$/)),
    ...(await existingVersionedFiles(resolve(repoRoot, "exports"), /^map\.[0-9a-f]{12}\.kml$/)),
  ].filter((path) => !keep.has(path));

  for (const filePath of candidates) {
    log("info", `promote#${promoteId} removing old versioned artifact`, {
      path: repoRelative(filePath),
      dryRun,
    });
    if (!dryRun) {
      await unlink(filePath);
    }
  }

  return candidates;
}

async function handlePromote(payload = {}) {
  const promoteId = ++promoteCounter;
  log("info", `promote#${promoteId} started`, {
    dryRun: Boolean(payload.dryRun),
    allowSkippedElevation: Boolean(payload.allowSkippedElevation),
  });

  const report = JSON.parse(await readFile(reportPath, "utf-8"));
  const manifest = JSON.parse(await readFile(buildManifestPath, "utf-8"));
  const sourceStat = await stat(sourcePath);
  const reportStat = await stat(reportPath);

  if (reportStat.mtimeMs + 1000 < sourceStat.mtimeMs) {
    throw new Error("Build is stale. Run Build after saving the source, then promote.");
  }

  if (report.elevation?.skipElevation && !payload.allowSkippedElevation) {
    throw new Error("Promote requires a full build. Uncheck skip elevation, run Build, then promote.");
  }

  if (!report.elevation?.skipElevation && (report.elevation?.failures || 0) > 0) {
    throw new Error(
      `Promote blocked by ${report.elevation.failures} elevation lookup failures. Run a successful full build first.`,
    );
  }

  const blockers = validationBlockers(report);
  if (blockers.length > 0) {
    throw new Error(`Promote blocked by validation: ${blockers.join(", ")}`);
  }

  log("info", `promote#${promoteId} checks passed`, {
    version: manifest.version,
    warnings: (report.validation?.routeCompatibilityWarnings || []).length,
  });

  const targets = [
    {
      label: "manifest",
      source: buildManifestPath,
      target: promotedManifestPath,
    },
    {
      label: "versioned geojson",
      source: resolveManifestPath(buildDir, manifest.bikeRoads),
      target: resolveManifestPath(repoRoot, manifest.bikeRoads),
    },
    {
      label: "versioned segments",
      source: resolveManifestPath(buildDir, manifest.segments),
      target: resolveManifestPath(repoRoot, manifest.segments),
    },
    {
      label: "versioned kml",
      source: resolveManifestPath(buildDir, manifest.kml.replace(/^exports\//, "")),
      target: resolveManifestPath(repoRoot, manifest.kml),
    },
    {
      label: "site geojson",
      source: buildGeojsonPath,
      target: promotedGeojsonPath,
    },
    {
      label: "site segments",
      source: buildSegmentsPath,
      target: promotedSegmentsPath,
    },
    {
      label: "kml export",
      source: buildKmlPath,
      target: promotedKmlPath,
    },
  ];

  for (const target of targets) {
    await stat(target.source);
  }

  log("info", `promote#${promoteId} artifacts verified`, {
    targets: targets.map((target) => ({
      label: target.label,
      source: repoRelative(target.source),
      target: repoRelative(target.target),
    })),
  });

  let removed = [];
  if (!payload.dryRun) {
    for (const target of targets) {
      log("info", `promote#${promoteId} copying ${target.label}`, {
        source: repoRelative(target.source),
        target: repoRelative(target.target),
      });
      await copyFileAtomic(target.source, target.target);
    }
  }
  removed = await cleanupOldVersionedArtifacts(manifest, promoteId, Boolean(payload.dryRun));

  log("info", `promote#${promoteId} finished`, {
    dryRun: Boolean(payload.dryRun),
    version: manifest.version,
    removed: removed.length,
  });

  return {
    dryRun: Boolean(payload.dryRun),
    version: manifest.version,
    manifest: promotedManifestPath,
    promoted: targets.map((target) => ({
      label: target.label,
      source: target.source,
      target: target.target,
    })),
    removed: removed.map((filePath) => repoRelative(filePath)),
    warnings: report.validation?.routeCompatibilityWarnings || [],
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const requestId = ++requestCounter;
  const startedAt = Date.now();

  try {
    if (request.method === "GET" && url.pathname === "/api/dev/events" && devReloadEnabled) {
      handleDevReloadEvents(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/source") {
      logApi(requestId, "GET /api/source started");
      const source = JSON.parse(await readFile(sourcePath, "utf-8"));
      logApi(requestId, "GET /api/source loaded", summarizeSource(source));
      sendJson(response, 200, source);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/source") {
      logApi(requestId, "POST /api/source started");
      const source = await readRequestJson(request);
      try {
        validateSourceGeojson(source);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("warn", `api#${requestId} POST /api/source validation failed`, message);
        sendJson(response, 400, { ok: false, error: message });
        return;
      }
      logApi(requestId, "POST /api/source validated", summarizeSource(source));
      const tmpPath = `${sourcePath}.tmp`;
      await writeFile(tmpPath, `${JSON.stringify(source, null, 2)}\n`, "utf-8");
      await rename(tmpPath, sourcePath);
      logApi(requestId, "POST /api/source saved", {
        path: repoRelative(sourcePath),
        durationMs: Date.now() - startedAt,
      });
      sendJson(response, 200, { ok: true, path: sourcePath });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/build") {
      logApi(requestId, "POST /api/build started");
      const payload = await readRequestJson(request);
      const result = await handleBuild(payload);
      let report = null;
      try {
        report = JSON.parse(await readFile(reportPath, "utf-8"));
      } catch {
        report = null;
      }
      if (report) {
        logApi(requestId, "POST /api/build report", summarizeReport(report));
      }
      logApi(requestId, "POST /api/build finished", {
        durationMs: Date.now() - startedAt,
        buildId: result.buildId,
      });
      sendJson(response, 200, { ok: true, ...result, report });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/promote") {
      logApi(requestId, "POST /api/promote started");
      const payload = await readRequestJson(request);
      const result = await handlePromote(payload);
      logApi(requestId, "POST /api/promote finished", {
        durationMs: Date.now() - startedAt,
        version: result.version,
        dryRun: result.dryRun,
      });
      sendJson(response, 200, { ok: true, ...result });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/report") {
      logApi(requestId, "GET /api/report started");
      const report = JSON.parse(await readFile(reportPath, "utf-8"));
      logApi(requestId, "GET /api/report loaded", summarizeReport(report));
      sendJson(response, 200, report);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(request, response, url);
      return;
    }

    sendText(response, 405, "Method not allowed");
  } catch (error) {
    log("error", `api#${requestId} ${request.method} ${url.pathname} failed`, {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Map editor running at http://127.0.0.1:${port}/editor/`);
  startDevReloadWatcher();
});
