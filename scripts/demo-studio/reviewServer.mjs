import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBearerToken, isAuthorized, listen, readJsonBody, sendJson, sendText } from "./httpUtils.mjs";
import { deriveDemoProjectStatus } from "./projectState.mjs";
import { readProject, updateProject } from "./workspace.mjs";
import { spawnChecked } from "./process.mjs";
import { captionTextKey } from "./captions.mjs";

const reviewRoot = fileURLToPath(new URL("review/", import.meta.url));
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

async function jsonOrNull(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}

function attemptKind(id) {
  if (id?.startsWith("capture-")) return "capture";
  if (id?.startsWith("voice-")) return "voice";
  if (id?.startsWith("render-")) return "render";
  throw new Error("attempt id must begin with capture-, voice-, or render-");
}

async function serveRange(request, response, path) {
  const facts = await stat(path);
  const range = request.headers.range;
  const type = extname(path).toLowerCase() === ".mov" ? "video/quicktime" : "video/mp4";
  if (!range) {
    response.writeHead(200, { "content-type": type, "content-length": facts.size, "accept-ranges": "bytes", "cache-control": "no-store" });
    createReadStream(path).pipe(response);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return sendJson(response, 416, { error: "invalid-range" });
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), facts.size - 1) : facts.size - 1;
  if (start > end || start >= facts.size) return sendJson(response, 416, { error: "range-outside-file" });
  response.writeHead(206, {
    "content-type": type,
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${facts.size}`,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  });
  createReadStream(path, { start, end }).pipe(response);
}

export async function createReviewServer({ projectPath, selectedRun = null, token = createBearerToken(), host = "127.0.0.1", port = 0 } = {}) {
  let loaded = await readProject(projectPath);
  const loadState = async () => {
    loaded = await readProject(loaded.path);
    const artifacts = {};
    for (const [name, file] of Object.entries({
      track: "normalized-track.json",
      rawGps: "raw-gps.json",
      route: "route-snapshot.json",
      rideValidation: "ride-validation.json",
      navigation: "navigation-validation.json",
      report: "validation-report.json",
    })) artifacts[name] = await jsonOrNull(join(loaded.directory, "artifacts", file));
    const attemptMedia = {};
    const attemptMeta = {};
    for (const [kind, attempts] of Object.entries(loaded.project.attempts || {})) {
      for (const attempt of attempts) {
        if (!attempt.artifact) continue;
        attemptMedia[attempt.id] = `/media/attempt/${encodeURIComponent(attempt.id)}?token=${encodeURIComponent(token)}`;
        const sync = await jsonOrNull(join(loaded.directory, "attempts", attempt.id, "sync.json"));
        const eventsDocument = kind === "capture" ? await jsonOrNull(join(loaded.directory, "attempts", attempt.id, "capture-events.json")) : null;
        const speech = (eventsDocument?.events || []).filter((event) => event.kind === "speech-start").map((event) => ({
          id: event.payload?.utteranceId || event.payload?.text || `speech-${event.sequence}`,
          key: captionTextKey(event.payload?.text || ""),
          text: event.payload?.text || "",
          mediaTimeMs: event.mediaTimeMs,
        }));
        attemptMeta[attempt.id] = { kind, sync, speech };
      }
    }
    return {
      project: loaded.project,
      status: deriveDemoProjectStatus(loaded.project),
      artifacts,
      selectedRun: selectedRun && attemptMedia[selectedRun] ? selectedRun : Object.keys(attemptMedia).at(-1) || null,
      media: { source: `/media/source?token=${encodeURIComponent(token)}`, attempts: attemptMedia },
      attemptMeta,
    };
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    const publicAsset = request.method === "GET" && ["/review.js", "/review.css"].includes(url.pathname);
    if (!publicAsset && !isAuthorized(request, url, token)) return sendJson(response, 401, { error: "unauthorized" });
    try {
      if (request.method === "GET" && url.pathname === "/api/state") return sendJson(response, 200, await loadState());
      if (request.method === "POST" && url.pathname === "/api/decision") {
        const body = await readJsonBody(request, 64 * 1024);
        let action;
        if (body.type === "configure") {
          if (typeof body.field !== "string" || !body.reason) throw new Error("configuration decisions require field and reason");
          action = { type: "configure", field: body.field, value: body.value, reason: body.reason, actor: "review-workspace" };
        } else if (body.type === "accept-inputs") {
          action = { type: "accept", kind: "inputs", note: body.note || null, reason: body.note || "visual-input-review", actor: "review-workspace" };
        } else if (["accept", "reject"].includes(body.type)) {
          action = { type: body.type, kind: attemptKind(body.attemptId), attemptId: body.attemptId, note: body.note || null, reason: body.note || `${body.type}-from-review`, actor: "review-workspace" };
        } else throw new Error("unsupported review decision");
        const updated = await updateProject(loaded.path, action);
        loaded.project = updated.project;
        return sendJson(response, 200, { ok: true, revision: updated.project.revision, invalidated: updated.invalidated, state: await loadState() });
      }
      if (request.method === "GET" && url.pathname === "/media/source") {
        const path = loaded.project.inputs.source.path;
        if (!path) return sendJson(response, 404, { error: "source-not-selected" });
        return serveRange(request, response, path);
      }
      if (request.method === "GET" && url.pathname.startsWith("/media/attempt/")) {
        const attemptId = decodeURIComponent(url.pathname.slice("/media/attempt/".length));
        const attempt = Object.values(loaded.project.attempts || {}).flat().find((candidate) => candidate.id === attemptId);
        if (!attempt?.artifact) return sendJson(response, 404, { error: "attempt-media-not-found" });
        return serveRange(request, response, attempt.artifact);
      }
      if (request.method === "GET" && ["/", "/index.html", "/review.js", "/review.css"].includes(url.pathname)) {
        const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        const path = resolve(reviewRoot, file);
        if (!path.startsWith(resolve(reviewRoot))) return sendJson(response, 404, { error: "not-found" });
        return sendText(response, 200, await readFile(path, "utf8"), contentTypes[extname(path)] || "text/plain");
      }
      return sendJson(response, 404, { error: "not-found" });
    } catch (error) {
      sendJson(response, error.status || 400, { error: error.message });
    }
  });
  const address = await listen(server, { host, port });
  const baseUrl = `http://${address.address}:${address.port}`;
  return {
    server,
    token,
    url: `${baseUrl}/?token=${encodeURIComponent(token)}`,
    close: () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
  };
}

export async function reviewProject(loaded, context) {
  const service = await createReviewServer({ projectPath: loaded.path, selectedRun: context.options.run || null, port: Number(context.options.port) || 0 });
  context.io.log(context.commandResult({
    result: `Review workspace ready for ${loaded.project.id}`,
    why: "The browser and CLI use the same project revision state",
    wrote: service.url,
    next: "Review the first unresolved decision; press Ctrl-C when finished",
  }));
  if (!context.options["non-interactive"] && process.platform === "darwin") {
    await spawnChecked("open", [service.url]).catch((error) => context.io.warn?.(`Could not open browser: ${error.message}`));
  }
  await new Promise((resolveStop) => {
    process.once("SIGINT", resolveStop);
    process.once("SIGTERM", resolveStop);
  });
  await service.close();
  return { ok: true, code: "REVIEW_CLOSED" };
}
