#!/usr/bin/env node
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
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
const dataDir = resolve(repoRoot, "data");
const publicDataDir = resolve(repoRoot, "public-data");
const buildPublicDataDir = resolve(buildDir, "public-data");
const osmBuildDir = resolve(buildDir, "osm");
const osmRawWaysPath = resolve(osmBuildDir, "osm-raw-ways.geojson");
const osmIntersectionsPath = resolve(osmBuildDir, "osm-intersections.geojson");
const osmBaseGraphPath = resolve(osmBuildDir, "osm-base-graph.json");
const osmElevatedBaseGraphPath = resolve(osmBuildDir, "osm-base-graph-elevated.json");
const reportPath = resolve(buildDir, "report.json");
const buildManifestPath = resolve(buildPublicDataDir, "map-manifest.json");
const osmGraphEdgesPath = resolve(osmBuildDir, "osm-base-edges.geojson");
const osmMatchSummaryPath = resolve(osmBuildDir, "cw-osm-match-summary.json");
const osmMatchPreviewPath = resolve(osmBuildDir, "cw-osm-match-preview.geojson");
const osmMatchesPath = resolve(osmBuildDir, "cw-osm-matches.json");
const cwBaseOverlayPath = resolve(dataDir, "cw-base-overlay.json");
const manualBaseEdgesPath = resolve(dataDir, "manual-base-edges.geojson");
const promotedManifestPath = resolve(publicDataDir, "map-manifest.json");
const port = Number(process.env.EDITOR_PORT || 8899);
const devReloadEnabled = process.env.EDITOR_CLIENT_RELOAD === "1";
let requestCounter = 0;
let buildCounter = 0;
let osmGraphCounter = 0;
let promoteCounter = 0;
let atomicWriteCounter = 0;
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
    version: report?.outputs?.runtime?.version,
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
    baseRouting: {
      nodes: validation.baseRouting?.graphNodes,
      edges: validation.baseRouting?.graphEdges,
      cyclewaysEdges: validation.baseRouting?.cyclewaysEdges,
      unresolvedSegments: validation.baseRouting?.unresolvedSegments,
      warnings: (validation.baseRouting?.warnings || []).length,
      blockers: (validation.baseRouting?.blockers || []).length,
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
  let source = null;
  let reconnectTimer = null;

  function connect() {
    source = new EventSource("/api/dev/events");
    source.addEventListener("reload", () => {
      window.location.reload();
    });
    source.addEventListener("error", () => {
      source.close();
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1000);
    });
  }

  connect();
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

function emptyCwBaseOverlay() {
  return {
    schemaVersion: 1,
    description: "CycleWays segment mappings onto the OSM/manual base graph.",
    updatedAt: null,
    segments: {},
  };
}

function emptyManualBaseEdges() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function normalizeCwBaseOverlay(overlay) {
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) {
    throw new Error("Overlay must be an object");
  }
  const segments = overlay.segments || {};
  if (!segments || typeof segments !== "object" || Array.isArray(segments)) {
    throw new Error("Overlay segments must be an object keyed by segment id");
  }

  for (const [key, mapping] of Object.entries(segments)) {
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      throw new Error(`Overlay mapping ${key} must be an object`);
    }
    if (!Number.isInteger(mapping.segmentId)) {
      throw new Error(`Overlay mapping ${key} is missing integer segmentId`);
    }
    if (String(mapping.segmentId) !== String(key)) {
      throw new Error(`Overlay mapping key ${key} does not match segmentId ${mapping.segmentId}`);
    }
    if (!["accepted_auto_match", "manual_base_edge_needed", "needs_edit"].includes(mapping.status)) {
      throw new Error(`Overlay mapping ${key} has unsupported status ${mapping.status}`);
    }
    if (mapping.segmentName !== undefined && typeof mapping.segmentName !== "string") {
      throw new Error(`Overlay mapping ${key} has invalid segmentName`);
    }
    if (!Array.isArray(mapping.edgeRefs)) {
      throw new Error(`Overlay mapping ${key} edgeRefs must be an array`);
    }
    for (const [index, edgeRef] of mapping.edgeRefs.entries()) {
      if (!edgeRef || typeof edgeRef !== "object" || Array.isArray(edgeRef)) {
        throw new Error(`Overlay mapping ${key} edgeRef ${index} must be an object`);
      }
      if (typeof edgeRef.edgeId !== "string" || edgeRef.edgeId.trim() === "") {
        throw new Error(`Overlay mapping ${key} edgeRef ${index} is missing edgeId`);
      }
      for (const fractionKey of ["fromFraction", "toFraction"]) {
        const value = edgeRef[fractionKey];
        if (typeof value !== "number" || value < 0 || value > 1) {
          throw new Error(`Overlay mapping ${key} edgeRef ${index} has invalid ${fractionKey}`);
        }
      }
      if (edgeRef.sequenceIndex !== undefined && !Number.isInteger(edgeRef.sequenceIndex)) {
        throw new Error(`Overlay mapping ${key} edgeRef ${index} has invalid sequenceIndex`);
      }
      if (edgeRef.direction !== undefined && !["forward", "reverse", "unknown"].includes(edgeRef.direction)) {
        throw new Error(`Overlay mapping ${key} edgeRef ${index} has invalid direction`);
      }
    }
  }

  return {
    schemaVersion: 1,
    description:
      typeof overlay.description === "string"
        ? overlay.description
        : "CycleWays segment mappings onto the OSM/manual base graph.",
    updatedAt: new Date().toISOString(),
    segments,
  };
}

async function readCwBaseOverlay() {
  try {
    return JSON.parse(await readFile(cwBaseOverlayPath, "utf-8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return emptyCwBaseOverlay();
    }
    throw error;
  }
}

function normalizeManualBaseEdges(geojson) {
  if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
    throw new Error("Manual base edges must be a GeoJSON FeatureCollection");
  }

  const ids = new Set();
  for (const [index, feature] of geojson.features.entries()) {
    if (!feature || feature.type !== "Feature") {
      throw new Error(`Manual base edge ${index} is not a GeoJSON Feature`);
    }
    const geometry = feature.geometry || {};
    if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
      throw new Error(`Manual base edge ${index} must be a LineString with at least two coordinates`);
    }
    for (const coord of geometry.coordinates) {
      if (
        !Array.isArray(coord) ||
        coord.length < 2 ||
        typeof coord[0] !== "number" ||
        typeof coord[1] !== "number" ||
        coord[0] < -180 ||
        coord[0] > 180 ||
        coord[1] < -90 ||
        coord[1] > 90
      ) {
        throw new Error(`Manual base edge ${index} has invalid coordinates`);
      }
    }

    const properties = feature.properties || (feature.properties = {});
    const manualEdgeId = properties.manualEdgeId || properties.id || feature.id;
    if (typeof manualEdgeId !== "string" || manualEdgeId.trim() === "") {
      throw new Error(`Manual base edge ${index} is missing manualEdgeId`);
    }
    if (ids.has(manualEdgeId)) {
      throw new Error(`Duplicate manual base edge id ${manualEdgeId}`);
    }
    ids.add(manualEdgeId);
    properties.manualEdgeId = manualEdgeId;
    properties.id = properties.id || manualEdgeId;
    properties.source = "manual";

    if (
      properties.linkedSegmentId !== undefined &&
      properties.linkedSegmentId !== null &&
      !Number.isInteger(properties.linkedSegmentId)
    ) {
      throw new Error(`Manual base edge ${manualEdgeId} has invalid linkedSegmentId`);
    }
    if (properties.linkedSegmentName !== undefined && typeof properties.linkedSegmentName !== "string") {
      throw new Error(`Manual base edge ${manualEdgeId} has invalid linkedSegmentName`);
    }
  }

  return {
    type: "FeatureCollection",
    features: geojson.features,
  };
}

async function readManualBaseEdges() {
  try {
    return JSON.parse(await readFile(manualBaseEdgesPath, "utf-8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return emptyManualBaseEdges();
    }
    throw error;
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

async function statOrNull(pathname) {
  try {
    return await stat(pathname);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isStaleAgainst(targetStat, inputStat) {
  return Boolean(inputStat && (!targetStat || targetStat.mtimeMs + 1000 < inputStat.mtimeMs));
}

async function fileDigest(pathname) {
  const digest = createHash("sha256");
  const contents = await readFile(pathname);
  digest.update(contents);
  return digest.digest("hex");
}

async function elevatedGraphMatchesBaseGraph() {
  const elevatedGraph = JSON.parse(await readFile(osmElevatedBaseGraphPath, "utf-8"));
  const sourceDigest = elevatedGraph?.metadata?.elevation?.sourceGraphDigest;
  if (typeof sourceDigest !== "string") {
    return false;
  }
  return sourceDigest === await fileDigest(osmBaseGraphPath);
}

async function runBuildDependencyStep(buildId, label, command, args) {
  const startedAt = Date.now();
  log("info", `build#${buildId} ${label} started`, {
    command: `${command} ${args.join(" ")}`,
  });

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const stdoutLogger = createLineLogger("info", `build#${buildId} ${label} stdout`, (text) => {
      stdout += text;
    });
    const stderrLogger = createLineLogger("info", `build#${buildId} ${label} stderr`, (text) => {
      stderr += text;
    });
    const heartbeat = setInterval(() => {
      log("info", `build#${buildId} ${label} still running`, {
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
      log("error", `build#${buildId} ${label} failed to start`, error.message);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearInterval(heartbeat);
      stdoutLogger.flush();
      stderrLogger.flush();
      const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (code !== 0) {
        log("error", `build#${buildId} ${label} failed`, {
          exitCode: code,
          durationSeconds,
        });
        rejectPromise(new Error(stderr || stdout || `${label} failed with exit code ${code}`));
        return;
      }
      log("info", `build#${buildId} ${label} finished`, {
        durationSeconds,
      });
      resolvePromise({ stdout, stderr, durationSeconds });
    });
  });
}

async function ensureCurrentBaseRoutingArtifacts(buildId, payload) {
  const graphInputs = [
    ["raw OSM ways", osmRawWaysPath],
    ["OSM intersections", osmIntersectionsPath],
    ["manual base edges", manualBaseEdgesPath],
  ];
  const inputStats = await Promise.all(
    graphInputs.map(async ([label, pathname]) => ({
      label,
      pathname,
      stat: await statOrNull(pathname),
    })),
  );
  let graphStat = await statOrNull(osmBaseGraphPath);
  const staleGraphInputs = inputStats.filter((input) => isStaleAgainst(graphStat, input.stat));
  if (!graphStat || staleGraphInputs.length > 0) {
    log("info", `build#${buildId} refreshing base graph before Build`, {
      reason: !graphStat
        ? "missing base graph"
        : `stale relative to ${staleGraphInputs.map((input) => input.label).join(", ")}`,
    });
    await runBuildDependencyStep(buildId, "base graph refresh", "npm", ["run", "osm:graph"]);
    graphStat = await statOrNull(osmBaseGraphPath);
  }
  if (!graphStat) {
    throw new Error("Base graph refresh did not produce build/osm/osm-base-graph.json.");
  }

  let elevatedStat = await statOrNull(osmElevatedBaseGraphPath);
  let elevatedDigestMatches = false;
  if (elevatedStat && !isStaleAgainst(elevatedStat, graphStat)) {
    elevatedDigestMatches = await elevatedGraphMatchesBaseGraph().catch(() => false);
  }
  if (!elevatedStat || isStaleAgainst(elevatedStat, graphStat) || !elevatedDigestMatches) {
    const elevationArgs = ["processing/build_osm_base_graph_elevation.py"];
    if (payload.elevationUrl) {
      elevationArgs.push("--elevation-url", String(payload.elevationUrl));
    }
    log("info", `build#${buildId} refreshing elevated base graph before Build`, {
      reason: !elevatedStat
        ? "missing elevated base graph"
        : isStaleAgainst(elevatedStat, graphStat)
          ? "stale relative to base graph"
          : "source digest does not match base graph",
    });
    try {
      await runBuildDependencyStep(buildId, "base graph elevation refresh", "python3", elevationArgs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Base graph elevation refresh failed before Build. Make sure the local elevation service is running, then try Build again.\n\n${message}`,
      );
    }
    elevatedStat = await statOrNull(osmElevatedBaseGraphPath);
  }
  if (!elevatedStat) {
    throw new Error("Base graph elevation refresh did not produce build/osm/osm-base-graph-elevated.json.");
  }
}

async function handleBuild(payload) {
  payload = payload || {};
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

  await ensureCurrentBaseRoutingArtifacts(buildId, payload);

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

async function handleOsmGraphRecalculate() {
  const graphId = ++osmGraphCounter;
  const startedAt = Date.now();
  const args = ["run", "osm:graph"];

  log("info", `osm-graph#${graphId} started`, {
    command: `npm ${args.join(" ")}`,
  });

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("npm", args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const stdoutLogger = createLineLogger("info", `osm-graph#${graphId} stdout`, (text) => {
      stdout += text;
    });
    const stderrLogger = createLineLogger("info", `osm-graph#${graphId} stderr`, (text) => {
      stderr += text;
    });
    const heartbeat = setInterval(() => {
      log("info", `osm-graph#${graphId} still running`, {
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
      log("error", `osm-graph#${graphId} failed to start`, error.message);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearInterval(heartbeat);
      stdoutLogger.flush();
      stderrLogger.flush();
      const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (code !== 0) {
        log("error", `osm-graph#${graphId} failed`, {
          exitCode: code,
          durationSeconds,
        });
        rejectPromise(new Error(stderr || stdout || `OSM graph recalculation failed with exit code ${code}`));
        return;
      }
      log("info", `osm-graph#${graphId} finished`, {
        durationSeconds,
      });
      resolvePromise({ graphId, stdout, stderr, durationSeconds });
    });
  });
}

async function handleOsmSegmentRecalculate(payload) {
  const graphId = ++osmGraphCounter;
  const startedAt = Date.now();
  const feature = payload?.feature;
  validateSourceGeojson({ type: "FeatureCollection", features: [feature] });
  const segmentId = feature.properties.id;
  const tmpPrefix = resolve(osmBuildDir, `.selected-segment-${segmentId}-${Date.now()}-${graphId}`);
  const segmentPath = `${tmpPrefix}.geojson`;
  const outPath = `${tmpPrefix}.json`;
  const args = [
    "processing/match_cycleways_to_osm_graph.py",
    "--graph-edges",
    "build/osm/osm-base-edges.geojson",
    "--single-segment-geojson",
    repoRelative(segmentPath),
    "--single-out-json",
    repoRelative(outPath),
  ];

  await mkdir(osmBuildDir, { recursive: true });
  await writeJsonAtomic(segmentPath, feature);

  log("info", `osm-segment#${graphId} started`, {
    segmentId,
    command: `python3 ${args.join(" ")}`,
  });

  try {
    const result = await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn("python3", args, {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      const stdoutLogger = createLineLogger("info", `osm-segment#${graphId} stdout`, (text) => {
        stdout += text;
      });
      const stderrLogger = createLineLogger("info", `osm-segment#${graphId} stderr`, (text) => {
        stderr += text;
      });
      const heartbeat = setInterval(() => {
        log("info", `osm-segment#${graphId} still running`, {
          segmentId,
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
        log("error", `osm-segment#${graphId} failed to start`, error.message);
        rejectPromise(error);
      });
      child.on("close", (code) => {
        clearInterval(heartbeat);
        stdoutLogger.flush();
        stderrLogger.flush();
        const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        if (code !== 0) {
          log("error", `osm-segment#${graphId} failed`, {
            segmentId,
            exitCode: code,
            durationSeconds,
          });
          rejectPromise(new Error(stderr || stdout || `Segment recalculation failed with exit code ${code}`));
          return;
        }
        log("info", `osm-segment#${graphId} finished`, {
          segmentId,
          durationSeconds,
        });
        resolvePromise({ graphId, segmentId, stdout, stderr, durationSeconds });
      });
    });
    const match = JSON.parse(await readFile(outPath, "utf-8"));
    return { ...result, match };
  } finally {
    await unlink(segmentPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

function recomputeMatchSummaryTotals(summary) {
  const segments = Array.isArray(summary.segments) ? summary.segments : [];
  const confidenceCounts = {};
  let totalDistanceM = 0;
  let matchedDistanceM = 0;
  let gapCount = 0;

  for (const segment of segments) {
    const confidence = segment.confidence || "none";
    confidenceCounts[confidence] = (confidenceCounts[confidence] || 0) + 1;
    const distanceMeters = Number(segment.distanceMeters) || 0;
    const coverageRatio = Number(segment.coverageRatio) || 0;
    totalDistanceM += distanceMeters;
    matchedDistanceM += distanceMeters * coverageRatio;
    gapCount += Number(segment.gapCount) || 0;
  }

  return {
    ...summary,
    sourceSegments: segments.length,
    coverageRatio: totalDistanceM ? Number((matchedDistanceM / totalDistanceM).toFixed(4)) : 0,
    totalKm: Number((totalDistanceM / 1000).toFixed(1)),
    matchedKm: Number((matchedDistanceM / 1000).toFixed(1)),
    unmatchedKm: Number(((totalDistanceM - matchedDistanceM) / 1000).toFixed(1)),
    confidenceCounts,
    gapCount,
  };
}

async function persistOsmSegmentMatch(payload) {
  const segmentId = Number(payload?.segmentId);
  const summary = payload?.summary;
  const preview = payload?.preview || { type: "FeatureCollection", features: [] };
  if (!Number.isInteger(segmentId)) {
    throw new Error("segmentId is required");
  }
  if (!summary || Number(summary.segmentId) !== segmentId) {
    throw new Error("summary.segmentId must match segmentId");
  }
  if (!preview || preview.type !== "FeatureCollection" || !Array.isArray(preview.features)) {
    throw new Error("preview must be a GeoJSON FeatureCollection");
  }

  await mkdir(osmBuildDir, { recursive: true });
  const existingSummary = JSON.parse(await readFile(osmMatchSummaryPath, "utf-8"));
  const nextSegments = [
    ...(existingSummary.segments || []).filter((segment) => Number(segment.segmentId) !== segmentId),
    summary,
  ].sort((a, b) => Number(a.segmentId ?? 0) - Number(b.segmentId ?? 0));
  const nextSummary = recomputeMatchSummaryTotals({
    ...existingSummary,
    generatedAt: new Date().toISOString(),
    segments: nextSegments,
  });

  let existingPreview = { type: "FeatureCollection", features: [] };
  try {
    existingPreview = JSON.parse(await readFile(osmMatchPreviewPath, "utf-8"));
  } catch {
    existingPreview = { type: "FeatureCollection", features: [] };
  }
  const nextPreview = {
    type: "FeatureCollection",
    features: [
      ...(existingPreview.features || []).filter(
        (feature) => Number(feature.properties?.segmentId) !== segmentId,
      ),
      ...preview.features,
    ],
  };

  let existingMatches = { generatedAt: nextSummary.generatedAt, segments: [] };
  try {
    existingMatches = JSON.parse(await readFile(osmMatchesPath, "utf-8"));
  } catch {
    existingMatches = { generatedAt: nextSummary.generatedAt, segments: [] };
  }
  const nextMatches = {
    ...existingMatches,
    generatedAt: nextSummary.generatedAt,
    segments: [
      ...(existingMatches.segments || []).filter((segment) => Number(segment.segmentId) !== segmentId),
      summary,
    ].sort((a, b) => Number(a.segmentId ?? 0) - Number(b.segmentId ?? 0)),
  };

  await writeJsonAtomic(osmMatchSummaryPath, nextSummary);
  await writeJsonAtomic(osmMatchPreviewPath, nextPreview);
  await writeJsonAtomic(osmMatchesPath, nextMatches);

  return {
    summary: nextSummary,
    preview: nextPreview,
    matches: nextMatches,
  };
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
  if ((validation.invalidQuality || []).length > 0) {
    blockers.push("invalid quality records");
  }
  if ((validation.activeMissingMiddle || []).length > 0) {
    blockers.push("active segments missing middle points");
  }
  if ((validation.activeSplitNumberedNames || []).length > 0) {
    blockers.push("active split children with numbered names");
  }
  if ((validation.routeCompatibilityWarnings || []).length > 0) {
    blockers.push(`${validation.routeCompatibilityWarnings.length} route compatibility warnings`);
  }
  const baseRouting = validation.baseRouting || {};
  if ((baseRouting.blockers || []).length > 0) {
    blockers.push(`${baseRouting.blockers.length} base routing blockers`);
  }
  if ((baseRouting.warnings || []).length > 0) {
    blockers.push(`${baseRouting.warnings.length} base routing warnings`);
  }
  if ((baseRouting.unresolvedSegments || 0) > 0) {
    blockers.push(`${baseRouting.unresolvedSegments} unresolved base routing segments`);
  }
  const displayFallbacks = validation.cyclewaysDisplayGeometry?.sourceFallbackSegments || 0;
  if (displayFallbacks > 0) {
    blockers.push(`${displayFallbacks} public CycleWays display geometry fallbacks`);
  }

  return blockers;
}

async function copyFileAtomic(source, target) {
  await mkdir(dirname(target), { recursive: true });
  const tmpPath = uniqueAtomicTmpPath(target);
  try {
    await copyFile(source, tmpPath);
    await rename(tmpPath, target);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
}

async function copyDirectoryAtomic(source, target) {
  await mkdir(dirname(target), { recursive: true });
  const tmpPath = uniqueAtomicTmpPath(target);
  try {
    await rm(tmpPath, { recursive: true, force: true });
    await cp(source, tmpPath, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
    await rename(tmpPath, target);
  } catch (error) {
    await rm(tmpPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function uniqueAtomicTmpPath(target) {
  atomicWriteCounter += 1;
  return `${target}.${process.pid}.${Date.now()}.${atomicWriteCounter}.tmp`;
}

async function writeJsonAtomic(target, value) {
  await mkdir(dirname(target), { recursive: true });
  const tmpPath = uniqueAtomicTmpPath(target);
  try {
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    await rename(tmpPath, target);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
}

async function writeJsonAtomicIfChanged(target, value) {
  const nextContent = `${JSON.stringify(value, null, 2)}\n`;
  let currentContent = null;
  try {
    currentContent = await readFile(target, "utf-8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (currentContent === nextContent) {
    return false;
  }

  await mkdir(dirname(target), { recursive: true });
  const tmpPath = uniqueAtomicTmpPath(target);
  try {
    await writeFile(tmpPath, nextContent, "utf-8");
    await rename(tmpPath, target);
    return true;
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
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

async function cleanupOldPublicArtifacts(promoteId, dryRun) {
  const candidates = [
    ...(await existingVersionedFiles(repoRoot, /^bike_roads\.[0-9a-f]{12}\.geojson$/)),
    ...(await existingVersionedFiles(repoRoot, /^segments\.[0-9a-f]{12}\.json$/)),
    ...(await existingVersionedFiles(repoRoot, /^base-routing-network\.[0-9a-f]{12}\.json$/)),
    ...(await existingVersionedFiles(repoRoot, /^base-routing-shards\.[0-9a-f]{12}$/)),
    ...(await existingVersionedFiles(repoRoot, /^base-routing-shards$/)),
    ...(await existingVersionedFiles(repoRoot, /^bike_roads_v18\.geojson$/)),
    ...(await existingVersionedFiles(repoRoot, /^segments\.json$/)),
    ...(await existingVersionedFiles(repoRoot, /^base-routing-network\.json$/)),
    ...(await existingVersionedFiles(repoRoot, /^map-manifest\.json$/)),
    ...(await existingVersionedFiles(resolve(repoRoot, "exports"), /^map\.[0-9a-f]{12}\.kml$/)),
    ...(await existingVersionedFiles(resolve(repoRoot, "exports"), /^map\.kml$/)),
    ...(await existingVersionedFiles(publicDataDir, /^bike_roads\.[0-9a-f]{12}\.geojson$/)),
    ...(await existingVersionedFiles(publicDataDir, /^segments\.[0-9a-f]{12}\.json$/)),
    ...(await existingVersionedFiles(publicDataDir, /^base-routing-network\.[0-9a-f]{12}\.json$/)),
    ...(await existingVersionedFiles(publicDataDir, /^base-routing-network\.json$/)),
    ...(await existingVersionedFiles(resolve(publicDataDir, "exports"), /^map\.[0-9a-f]{12}\.kml$/)),
  ];

  for (const filePath of candidates) {
    log("info", `promote#${promoteId} removing old public artifact`, {
      path: repoRelative(filePath),
      dryRun,
    });
    if (!dryRun) {
      await rm(filePath, { recursive: true, force: true });
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

  for (const routingInput of [
    osmBaseGraphPath,
    osmElevatedBaseGraphPath,
    cwBaseOverlayPath,
    manualBaseEdgesPath,
  ]) {
    const routingInputStat = await stat(routingInput);
    if (reportStat.mtimeMs + 1000 < routingInputStat.mtimeMs) {
      throw new Error(
        `Build is stale. ${repoRelative(routingInput)} changed after Build. Rebuild before promoting.`,
      );
    }
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
  if (!manifest.baseRoutingShards) {
    throw new Error("Promote requires a base routing shard manifest in the build manifest.");
  }

  log("info", `promote#${promoteId} checks passed`, {
    version: manifest.version,
    warnings: (report.validation?.routeCompatibilityWarnings || []).length,
  });

  const targets = [
    {
      label: "public manifest",
      source: buildManifestPath,
      target: promotedManifestPath,
    },
    {
      label: "public geojson",
      source: resolveManifestPath(buildPublicDataDir, manifest.bikeRoads),
      target: resolveManifestPath(publicDataDir, manifest.bikeRoads),
    },
    {
      label: "public segments",
      source: resolveManifestPath(buildPublicDataDir, manifest.segments),
      target: resolveManifestPath(publicDataDir, manifest.segments),
    },
    {
      label: "public kml",
      source: resolveManifestPath(buildPublicDataDir, manifest.kml),
      target: resolveManifestPath(publicDataDir, manifest.kml),
    },
    {
      kind: "directory",
      label: "base routing shards",
      source: dirname(resolveManifestPath(buildPublicDataDir, manifest.baseRoutingShards)),
      target: dirname(resolveManifestPath(publicDataDir, manifest.baseRoutingShards)),
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
      if (target.kind === "directory") {
        await copyDirectoryAtomic(target.source, target.target);
      } else {
        await copyFileAtomic(target.source, target.target);
      }
    }
  }
  removed = await cleanupOldPublicArtifacts(promoteId, Boolean(payload.dryRun));

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

    if (request.method === "POST" && url.pathname === "/api/osm/recalculate") {
      logApi(requestId, "POST /api/osm/recalculate started");
      const result = await handleOsmGraphRecalculate();
      let graphSummary = null;
      let matchSummary = null;
      try {
        graphSummary = JSON.parse(await readFile(resolve(osmBuildDir, "osm-base-graph-summary.json"), "utf-8"));
      } catch {
        graphSummary = null;
      }
      try {
        matchSummary = JSON.parse(await readFile(osmMatchSummaryPath, "utf-8"));
      } catch {
        matchSummary = null;
      }
      logApi(requestId, "POST /api/osm/recalculate finished", {
        durationMs: Date.now() - startedAt,
        graphId: result.graphId,
        graphEdges: graphSummary?.edges,
        sourceSegments: matchSummary?.sourceSegments,
      });
      sendJson(response, 200, { ok: true, ...result, graphSummary, matchSummary });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/osm/recalculate-segment") {
      logApi(requestId, "POST /api/osm/recalculate-segment started");
      const payload = await readRequestJson(request);
      let result;
      try {
        result = await handleOsmSegmentRecalculate(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("warn", `api#${requestId} POST /api/osm/recalculate-segment failed`, message);
        sendJson(response, 400, { ok: false, error: message });
        return;
      }
      logApi(requestId, "POST /api/osm/recalculate-segment finished", {
        durationMs: Date.now() - startedAt,
        segmentId: result.segmentId,
        coverageRatio: result.match?.summary?.coverageRatio,
        confidence: result.match?.summary?.confidence,
      });
      sendJson(response, 200, { ok: true, ...result });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/osm/persist-segment-match") {
      logApi(requestId, "POST /api/osm/persist-segment-match started");
      const payload = await readRequestJson(request);
      let result;
      try {
        result = await persistOsmSegmentMatch(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("warn", `api#${requestId} POST /api/osm/persist-segment-match failed`, message);
        sendJson(response, 400, { ok: false, error: message });
        return;
      }
      logApi(requestId, "POST /api/osm/persist-segment-match saved", {
        durationMs: Date.now() - startedAt,
        segmentId: payload.segmentId,
      });
      sendJson(response, 200, { ok: true, ...result });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/osm/graph-edges") {
      logApi(requestId, "GET /api/osm/graph-edges started");
      const graphEdges = JSON.parse(await readFile(osmGraphEdgesPath, "utf-8"));
      const [graphStat, manualStat] = await Promise.all([
        stat(osmGraphEdgesPath),
        stat(manualBaseEdgesPath).catch(() => null),
      ]);
      graphEdges.metadata = {
        ...(graphEdges.metadata || {}),
        graphEdgesModifiedAt: graphStat.mtime.toISOString(),
        manualBaseEdgesModifiedAt: manualStat?.mtime?.toISOString() || null,
        graphStaleBecauseManualBaseEdgesChanged: Boolean(manualStat && manualStat.mtimeMs > graphStat.mtimeMs),
      };
      logApi(requestId, "GET /api/osm/graph-edges loaded", {
        features: graphEdges.features?.length || 0,
        stale: graphEdges.metadata.graphStaleBecauseManualBaseEdgesChanged,
      });
      sendJson(response, 200, graphEdges);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/osm/match-summary") {
      logApi(requestId, "GET /api/osm/match-summary started");
      const summary = JSON.parse(await readFile(osmMatchSummaryPath, "utf-8"));
      logApi(requestId, "GET /api/osm/match-summary loaded", {
        sourceSegments: summary.sourceSegments,
        coverageRatio: summary.coverageRatio,
        gapCount: summary.gapCount,
      });
      sendJson(response, 200, summary);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/osm/match-preview") {
      logApi(requestId, "GET /api/osm/match-preview started");
      const preview = JSON.parse(await readFile(osmMatchPreviewPath, "utf-8"));
      logApi(requestId, "GET /api/osm/match-preview loaded", {
        features: preview.features?.length || 0,
      });
      sendJson(response, 200, preview);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/cw-base-overlay") {
      logApi(requestId, "GET /api/cw-base-overlay started");
      const overlay = await readCwBaseOverlay();
      logApi(requestId, "GET /api/cw-base-overlay loaded", {
        mappings: Object.keys(overlay.segments || {}).length,
      });
      sendJson(response, 200, overlay);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/manual-base-edges") {
      logApi(requestId, "GET /api/manual-base-edges started");
      const manualBaseEdges = await readManualBaseEdges();
      logApi(requestId, "GET /api/manual-base-edges loaded", {
        features: manualBaseEdges.features?.length || 0,
      });
      sendJson(response, 200, manualBaseEdges);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/cw-base-overlay") {
      logApi(requestId, "POST /api/cw-base-overlay started");
      let overlay;
      try {
        overlay = normalizeCwBaseOverlay(await readRequestJson(request));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("warn", `api#${requestId} POST /api/cw-base-overlay validation failed`, message);
        sendJson(response, 400, { ok: false, error: message });
        return;
      }
      await writeJsonAtomic(cwBaseOverlayPath, overlay);
      logApi(requestId, "POST /api/cw-base-overlay saved", {
        path: repoRelative(cwBaseOverlayPath),
        mappings: Object.keys(overlay.segments || {}).length,
      });
      sendJson(response, 200, { ok: true, path: cwBaseOverlayPath, overlay });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/manual-base-edges") {
      logApi(requestId, "POST /api/manual-base-edges started");
      let manualBaseEdges;
      try {
        manualBaseEdges = normalizeManualBaseEdges(await readRequestJson(request));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("warn", `api#${requestId} POST /api/manual-base-edges validation failed`, message);
        sendJson(response, 400, { ok: false, error: message });
        return;
      }
      await writeJsonAtomic(manualBaseEdgesPath, manualBaseEdges);
      logApi(requestId, "POST /api/manual-base-edges saved", {
        path: repoRelative(manualBaseEdgesPath),
        features: manualBaseEdges.features?.length || 0,
      });
      sendJson(response, 200, { ok: true, path: manualBaseEdgesPath, manualBaseEdges });
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
      const changed = await writeJsonAtomicIfChanged(sourcePath, source);
      logApi(requestId, "POST /api/source saved", {
        path: repoRelative(sourcePath),
        changed,
        durationMs: Date.now() - startedAt,
      });
      sendJson(response, 200, { ok: true, path: sourcePath, changed });
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
