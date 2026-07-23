import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBearerToken, isAuthorized, listen, readJsonBody, sendJson, sendText } from "./httpUtils.mjs";
import { deriveDemoProjectStatus } from "./projectState.mjs";
import {
  createProjectWorkspace,
  DEMO_WORKSPACE_ROOT,
  listProjectRevisions,
  readProject,
  restoreProjectRevision,
  updateProject,
} from "./workspace.mjs";
import { spawnChecked } from "./process.mjs";
import { captionTextKey } from "./captions.mjs";
import { normalizeSourceClips, summarizeSourceClip } from "./sources.mjs";
import { createStudioJobManager, listStudioJobs, recoverInterruptedJobs } from "./studioJobs.mjs";

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

function assertShowcasesHaveUsableTelemetry(reviewState, showcases) {
  const blocked = [
    ...(reviewState.artifacts?.track?.warnings || []).filter((warning) => warning.code === "gps-unavailable"),
    ...(reviewState.artifacts?.rideValidation?.eligibility?.warnings || []).filter((warning) => warning.code === "route-mismatch"),
  ];
  for (const [index, showcase] of (showcases || []).entries()) {
    const overlap = blocked.find((range) =>
      Number(range.toMs) > Number(showcase.inMs) &&
      Number(range.fromMs) < Number(showcase.outMs)
    );
    if (overlap) {
      const reason = overlap.code === "route-mismatch" ? "GPS that does not match the selected route" : "GPS-unavailable time";
      throw new Error(`showcase ${index + 1} overlaps ${reason} ${Math.round(overlap.fromMs)}–${Math.round(overlap.toMs)} ms`);
    }
  }
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

async function listProjects() {
  const names = await readdir(DEMO_WORKSPACE_ROOT).catch(() => []);
  const projects = [];
  for (const name of names) {
    const path = join(DEMO_WORKSPACE_ROOT, name, "project.json");
    if (!existsSync(path)) continue;
    try {
      const loaded = await readProject(path);
      const facts = await stat(path);
      projects.push({
        id: loaded.project.id,
        path,
        revision: loaded.project.revision,
        state: deriveDemoProjectStatus(loaded.project),
        sourceCount: normalizeSourceClips(loaded.project.inputs).length,
        updatedAt: facts.mtime.toISOString(),
      });
    } catch {}
  }
  return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createReviewServer({ projectPath = null, selectedRun = null, token = createBearerToken(), host = "127.0.0.1", port = 0 } = {}) {
  let loaded = projectPath ? await readProject(projectPath) : null;
  if (loaded) await recoverInterruptedJobs(loaded.path);
  const jobs = createStudioJobManager();
  const loadState = async () => {
    const projects = await listProjects();
    if (!loaded) {
      return {
        project: null,
        projects,
        status: null,
        artifacts: {},
        selectedRun: null,
        media: { source: null, sources: [], attempts: {} },
        attemptMeta: {},
        jobs: [],
        revisions: [],
      };
    }
    loaded = await readProject(loaded.path);
    const artifacts = {};
    for (const [name, file] of Object.entries({
      track: "normalized-track.json",
      rawGps: "raw-gps.json",
      route: "route-snapshot.json",
      rideValidation: "ride-validation.json",
      navigation: "navigation-validation.json",
      report: "validation-report.json",
      mediaTimeline: "media-timeline.json",
    })) artifacts[name] = await jsonOrNull(join(loaded.directory, "artifacts", file));
    const attemptMedia = {};
    const attemptMeta = {};
    for (const [kind, attempts] of Object.entries(loaded.project.attempts || {})) {
      for (const attempt of attempts) {
        if (!attempt.artifact) continue;
        attemptMedia[attempt.id] = `/media/attempt/${encodeURIComponent(attempt.id)}?token=${encodeURIComponent(token)}`;
        const sync = await jsonOrNull(join(loaded.directory, "attempts", attempt.id, "sync.json"));
        const eventsDocument = kind === "capture" ? await jsonOrNull(join(loaded.directory, "attempts", attempt.id, "capture-events.json")) : null;
        const captureFacts = kind === "capture" ? await jsonOrNull(join(loaded.directory, "attempts", attempt.id, "capture-facts.json")) : null;
        const speech = (eventsDocument?.events || []).filter((event) => event.kind === "speech-start").map((event) => ({
          id: event.payload?.utteranceId || event.payload?.text || `speech-${event.sequence}`,
          key: captionTextKey(event.payload?.text || ""),
          text: event.payload?.text || "",
          mediaTimeMs: event.mediaTimeMs,
        }));
        const captureReady = (eventsDocument?.events || []).find((event) => event.kind === "capture-ready");
        const captureHold = (eventsDocument?.events || []).findLast((event) => event.kind === "capture-hold");
        const captureWindow = kind === "capture"
          ? attempt.captureWindow || captureFacts?.captureWindow || (
              Number.isFinite(Number(captureReady?.mediaTimeMs)) &&
              Number.isFinite(Number(captureHold?.mediaTimeMs))
                ? { inMs: Number(captureReady.mediaTimeMs), outMs: Number(captureHold.mediaTimeMs) }
                : null
            )
          : null;
        attemptMeta[attempt.id] = {
          kind,
          sync,
          speech,
          captureWindow,
          canTrim: kind === "capture" && Boolean(captureWindow) && !attempt.staleAtRevision && (
            loaded.project.stages.capture.attemptId === attempt.id ||
            loaded.project.accepted.capture === attempt.id
          ),
        };
      }
    }
    const clips = normalizeSourceClips(loaded.project.inputs);
    return {
      project: loaded.project,
      projects,
      status: deriveDemoProjectStatus(loaded.project),
      artifacts,
      selectedRun: selectedRun && attemptMedia[selectedRun] ? selectedRun : Object.keys(attemptMedia).at(-1) || null,
      media: {
        source: clips[0] ? `/media/source/${encodeURIComponent(clips[0].id)}?token=${encodeURIComponent(token)}` : null,
        sources: clips.map((clip) => ({
          ...summarizeSourceClip(clip),
          url: `/media/source/${encodeURIComponent(clip.id)}?token=${encodeURIComponent(token)}`,
        })),
        attempts: attemptMedia,
      },
      attemptMeta,
      jobs: await listStudioJobs(loaded.path),
      revisions: await listProjectRevisions(loaded.path),
    };
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    const publicAsset = request.method === "GET" && ["/review.js", "/review.css"].includes(url.pathname);
    if (!publicAsset && !isAuthorized(request, url, token)) return sendJson(response, 401, { error: "unauthorized" });
    try {
      if (request.method === "GET" && url.pathname === "/api/state") return sendJson(response, 200, await loadState());
      if (request.method === "GET" && url.pathname === "/api/projects") return sendJson(response, 200, { projects: await listProjects(), currentProjectId: loaded?.project.id || null });
      if (request.method === "POST" && url.pathname === "/api/projects") {
        const body = await readJsonBody(request, 64 * 1024);
        const paths = Array.isArray(body.sources) ? body.sources : [body.source].filter(Boolean);
        if (!body.id || !body.route || !paths.length) throw new Error("project name, route, and at least one video are required");
        for (const path of paths) {
          const facts = await stat(resolve(path));
          if (!facts.isFile()) throw new Error(`source is not a file: ${path}`);
        }
        const created = await createProjectWorkspace({
          id: body.id,
          sourcePath: resolve(paths[0]),
          routeValue: body.route,
        });
        let updated = await updateProject(created.path, {
          type: "privacy-acknowledged",
          shareExactEndpoints: body.shareExactEndpoints === true,
          reason: "project-created-in-studio",
          actor: "studio-web",
        });
        if (body.routeKind === "route-token") {
          updated = await updateProject(created.path, {
            type: "configure",
            field: "route.kind",
            value: "route-token",
            reason: "route-token-selected-in-studio",
            actor: "studio-web",
          });
        }
        if (paths.length > 1) {
          updated = await updateProject(created.path, {
            type: "replace-sources",
            sources: paths.map((path) => ({ path: resolve(path) })),
            reason: "multi-clip-project-created-in-studio",
            actor: "studio-web",
          });
        }
        loaded = await readProject(updated.path);
        return sendJson(response, 201, { ok: true, state: await loadState() });
      }
      if (request.method === "POST" && url.pathname === "/api/project/open") {
        const body = await readJsonBody(request, 16 * 1024);
        const path = join(DEMO_WORKSPACE_ROOT, String(body.id || ""), "project.json");
        if (!existsSync(path)) throw new Error(`unknown project "${body.id}"`);
        loaded = await readProject(path);
        await recoverInterruptedJobs(loaded.path);
        selectedRun = null;
        return sendJson(response, 200, { ok: true, state: await loadState() });
      }
      if (request.method === "GET" && url.pathname === "/api/history") {
        if (!loaded) throw new Error("open a project first");
        return sendJson(response, 200, { revisions: await listProjectRevisions(loaded.path) });
      }
      if (request.method === "POST" && url.pathname === "/api/restore") {
        if (!loaded) throw new Error("open a project first");
        const body = await readJsonBody(request, 16 * 1024);
        await restoreProjectRevision(loaded.path, Number(body.revision), {
          reason: body.reason || `restored-from-studio-r${body.revision}`,
          actor: "studio-web",
        });
        return sendJson(response, 200, { ok: true, state: await loadState() });
      }
      if (request.method === "POST" && url.pathname === "/api/sources") {
        if (!loaded) throw new Error("open a project first");
        const body = await readJsonBody(request, 64 * 1024);
        if (!Array.isArray(body.sources) || !body.sources.length) throw new Error("at least one source clip is required");
        const sources = [];
        for (const [index, item] of body.sources.entries()) {
          const path = resolve(typeof item === "string" ? item : item.path);
          const facts = await stat(path);
          if (!facts.isFile()) throw new Error(`source ${index + 1} is not a file`);
          sources.push({ ...(typeof item === "object" ? item : {}), path });
        }
        const preview = {
          invalidated: ["source", "track", "route", "navigation", "inputs", "capture", "voice", "captions", "render", "publish"],
          preserved: ["attempt history", "revision history", "published files"],
        };
        if (body.preview === true) return sendJson(response, 200, { ok: true, preview });
        await updateProject(loaded.path, {
          type: "replace-sources",
          sources,
          reason: body.reason || "source-timeline-edited-in-studio",
          actor: "studio-web",
        });
        return sendJson(response, 200, { ok: true, preview, state: await loadState() });
      }
      if (request.method === "POST" && url.pathname === "/api/jobs") {
        if (!loaded) throw new Error("open a project first");
        const body = await readJsonBody(request, 16 * 1024);
        const job = await jobs.start(loaded.path, body.kind, { retryFrom: body.retryFrom || null });
        return sendJson(response, 202, { ok: true, job });
      }
      if (request.method === "POST" && url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/cancel")) {
        if (!loaded) throw new Error("open a project first");
        const jobId = decodeURIComponent(url.pathname.slice("/api/jobs/".length, -"/cancel".length));
        return sendJson(response, 200, { ok: true, job: await jobs.cancel(loaded.path, jobId) });
      }
      if (request.method === "POST" && url.pathname === "/api/decision") {
        if (!loaded) throw new Error("open a project first");
        const body = await readJsonBody(request, 64 * 1024);
        let action;
        if (body.type === "select-showcases" || body.type === "select-showcase") {
          const showcases = body.type === "select-showcases" ? body.showcases : [{ inMs: body.inMs, outMs: body.outMs }];
          assertShowcasesHaveUsableTelemetry(await loadState(), showcases);
          action = {
            type: "select-showcases",
            showcases,
            reason: "showcases-selected-in-review",
            actor: "review-workspace",
          };
        } else if (body.type === "configure") {
          if (typeof body.field !== "string" || !body.reason) throw new Error("configuration decisions require field and reason");
          action = { type: "configure", field: body.field, value: body.value, reason: body.reason, actor: "review-workspace" };
        } else if (body.type === "accept-inputs") {
          action = { type: "accept", kind: "inputs", note: body.note || null, reason: body.note || "visual-input-review", actor: "review-workspace" };
        } else if (body.type === "trim-showcases") {
          const reviewState = await loadState();
          const meta = reviewState.attemptMeta?.[body.attemptId];
          if (meta?.kind !== "capture" || !meta.canTrim || !meta.captureWindow) {
            throw new Error("the selected capture cannot be trimmed");
          }
          assertShowcasesHaveUsableTelemetry(reviewState, body.showcases);
          action = {
            type: "trim-showcases",
            showcases: body.showcases,
            captureAttemptId: body.attemptId,
            captureWindow: meta.captureWindow,
            reason: "showcases-trimmed-after-capture",
            actor: "review-workspace",
          };
        } else if (["accept", "reject"].includes(body.type)) {
          action = { type: body.type, kind: attemptKind(body.attemptId), attemptId: body.attemptId, note: body.note || null, reason: body.note || `${body.type}-from-review`, actor: "review-workspace" };
        } else throw new Error("unsupported review decision");
        const updated = await updateProject(loaded.path, action);
        loaded.project = updated.project;
        return sendJson(response, 200, { ok: true, revision: updated.project.revision, invalidated: updated.invalidated, state: await loadState() });
      }
      if (request.method === "GET" && url.pathname.startsWith("/media/source/")) {
        if (!loaded) return sendJson(response, 404, { error: "project-not-selected" });
        const sourceId = decodeURIComponent(url.pathname.slice("/media/source/".length));
        const source = normalizeSourceClips(loaded.project.inputs).find((clip) => clip.id === sourceId);
        if (!source?.path) return sendJson(response, 404, { error: "source-not-selected" });
        return serveRange(request, response, source.path);
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
