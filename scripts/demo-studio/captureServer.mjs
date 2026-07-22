import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createBearerToken, isAuthorized, listen, readJsonBody, sendJson } from "./httpUtils.mjs";
import { writeJsonAtomic } from "./workspace.mjs";

const EVENT_KINDS = new Set([
  "capture-ready", "sync-flash-start", "sync-flash-end", "fix-dispatched",
  "navigation-state", "presentation", "camera-stage", "speech-request",
  "speech-start", "speech-done", "speech-error", "capture-hold",
  "capture-error",
]);

function validateEvent(event, runId) {
  if (event?.schemaVersion !== 1) throw new Error("capture event schemaVersion must be 1");
  if (event.runId !== runId) throw new Error("capture event runId does not match the active run");
  if (!Number.isInteger(event.sequence) || event.sequence < 0) throw new Error("capture event sequence must be a non-negative integer");
  if (!EVENT_KINDS.has(event.kind)) throw new Error(`unsupported capture event kind "${event.kind}"`);
  if (!Number.isFinite(Number(event.mediaTimeMs))) throw new Error("capture event mediaTimeMs must be finite");
  return event;
}

export async function createCaptureServer({ bundle, workspace, runId = `capture-${Date.now()}`, token = createBearerToken(), host = "127.0.0.1", port = 0, allowLan = false, maxBodyBytes = 1024 * 1024 } = {}) {
  if (!bundle) throw new Error("capture server requires a sanitized bundle");
  if (host !== "127.0.0.1" && host !== "::1" && !allowLan) throw new Error("LAN binding requires allowLan=true");
  const state = {
    schemaVersion: 1,
    runId,
    stage: "waiting-for-client",
    control: "idle",
    events: [],
    client: null,
    startedAt: null,
    completedAt: null,
    error: null,
  };
  const persistState = async () => {
    if (!workspace) return;
    const runDirectory = join(workspace, "attempts", runId);
    await mkdir(runDirectory, { recursive: true });
    await writeJsonAtomic(join(runDirectory, "capture-events.json"), { schemaVersion: 1, runId, events: state.events });
    await writeJsonAtomic(join(runDirectory, "server-state.json"), { ...state, events: undefined, eventCount: state.events.length });
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (!isAuthorized(request, url, token)) {
      sendJson(response, 401, { error: "unauthorized" }, { "www-authenticate": "Bearer" });
      return;
    }
    try {
      if (request.method === "GET" && url.pathname === "/v1/bundle") return sendJson(response, 200, bundle);
      if (request.method === "GET" && url.pathname === "/v1/control") return sendJson(response, 200, { runId, control: state.control });
      if (request.method === "GET" && url.pathname === "/v1/status") return sendJson(response, 200, { ...state, events: undefined, eventCount: state.events.length });
      if (request.method !== "POST") return sendJson(response, 404, { error: "not-found" });
      const body = await readJsonBody(request, maxBodyBytes);
      if (url.pathname === "/v1/client/ready") {
        if (body.runId && body.runId !== runId) return sendJson(response, 409, { error: "run-id-mismatch" });
        state.client = body.client || null;
        if (state.stage === "waiting-for-client") state.stage = "ready";
        return sendJson(response, 200, { ok: true, runId, stage: state.stage });
      }
      if (url.pathname === "/v1/client/events") {
        const incoming = Array.isArray(body.events) ? body.events : [body.event].filter(Boolean);
        for (const item of incoming) {
          const event = validateEvent(item, runId);
          const existing = state.events.find((candidate) => candidate.sequence === event.sequence);
          if (existing) {
            if (JSON.stringify(existing) !== JSON.stringify(event)) return sendJson(response, 409, { error: "event-sequence-conflict", sequence: event.sequence });
            continue;
          }
          const expected = state.events.length ? state.events.at(-1).sequence + 1 : 0;
          if (event.sequence !== expected) return sendJson(response, 409, { error: "event-sequence-gap", expected, actual: event.sequence });
          state.events.push(event);
          if (event.kind === "capture-ready") state.stage = "ready";
          if (event.kind === "capture-hold") state.stage = "hold";
          if (event.kind === "capture-error") {
            state.stage = "failed";
            state.error = event.payload || null;
          }
        }
        return sendJson(response, 200, { ok: true, acceptedThrough: state.events.at(-1)?.sequence ?? -1 });
      }
      if (url.pathname === "/v1/client/complete") {
        if (!["hold", "failed", "aborted"].includes(state.stage)) return sendJson(response, 409, { error: "capture-not-terminal", stage: state.stage });
        state.stage = state.stage === "hold" ? "completed" : state.stage;
        state.completedAt = new Date().toISOString();
        await persistState();
        return sendJson(response, 200, { ok: true, stage: state.stage });
      }
      if (url.pathname === "/v1/control/start") {
        if (state.control === "start") return sendJson(response, 200, { ok: true, idempotent: true });
        if (state.stage !== "ready") return sendJson(response, 409, { error: "client-not-ready", stage: state.stage });
        state.control = "start";
        state.stage = "playing";
        state.startedAt = new Date().toISOString();
        return sendJson(response, 200, { ok: true, runId });
      }
      if (url.pathname === "/v1/control/abort") {
        state.control = "abort";
        state.stage = "aborted";
        state.completedAt = new Date().toISOString();
        return sendJson(response, 200, { ok: true, runId });
      }
      return sendJson(response, 404, { error: "not-found" });
    } catch (error) {
      sendJson(response, error.status || 400, { error: error.message });
    }
  });
  const address = await listen(server, { host, port });
  const url = `http://${address.address.includes(":") ? `[${address.address}]` : address.address}:${address.port}`;
  return {
    server,
    state,
    token,
    runId,
    url,
    persist: persistState,
    close: async () => {
      await persistState();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

export async function serveProjectCommand(loaded, context) {
  const { readFile } = await import("node:fs/promises");
  const bundlePath = context.options.bundle || join(loaded.directory, "artifacts", "bundle.app.json");
  const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
  const host = context.options["allow-lan"] ? (context.options.host || "0.0.0.0") : "127.0.0.1";
  const service = await createCaptureServer({ bundle, workspace: loaded.directory, host, port: Number(context.options.port) || 0, allowLan: context.options["allow-lan"] });
  context.io.log(context.commandResult({
    result: `Capture server listening for ${service.runId}`,
    why: context.options["allow-lan"] ? "LAN mode exposes sanitized ride GPS to token holders" : "Bound to this Mac only",
    wrote: `${service.url}/v1/status`,
    next: `open cycleways://build?demo=${encodeURIComponent(service.url)}&token=${encodeURIComponent(service.token)}&run=${service.runId}`,
  }));
  await new Promise((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await service.close();
  return { ok: true, code: "SERVER_STOPPED" };
}

export { EVENT_KINDS as DEMO_CAPTURE_EVENT_KINDS };
