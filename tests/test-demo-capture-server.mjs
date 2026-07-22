import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCaptureServer } from "../scripts/demo-studio/captureServer.mjs";

const workspace = await mkdtemp(join(tmpdir(), "demo-capture-server-"));
await mkdir(join(workspace, "attempts"));
const service = await createCaptureServer({ bundle: { safe: true }, workspace, runId: "capture-001", token: "test-token" });
const request = (path, options = {}) => fetch(`${service.url}${path}`, { ...options, headers: { authorization: "Bearer test-token", "content-type": "application/json", ...(options.headers || {}) } });
assert.equal((await fetch(`${service.url}/v1/bundle`)).status, 401);
assert.deepEqual(await (await request("/v1/bundle")).json(), { safe: true });
assert.equal((await request("/v1/control/start", { method: "POST", body: "{}" })).status, 409);
assert.equal((await request("/v1/client/ready", { method: "POST", body: JSON.stringify({ runId: "capture-001" }) })).status, 200);
assert.equal((await request("/v1/control/start", { method: "POST", body: "{}" })).status, 200);
const event = { schemaVersion: 1, sequence: 0, runId: "capture-001", kind: "capture-hold", mediaTimeMs: 1000, monotonicTimeMs: 10, dispatchLatenessMs: 0, payload: {} };
assert.equal((await request("/v1/client/events", { method: "POST", body: JSON.stringify({ events: [event] }) })).status, 200);
assert.equal((await request("/v1/client/events", { method: "POST", body: JSON.stringify({ events: [event] }) })).status, 200, "identical retry is idempotent");
assert.equal((await request("/v1/client/complete", { method: "POST", body: "{}" })).status, 200);
assert.equal((await request("/v1/status")).status, 200);
await service.close();

console.log("demo capture server tests passed");
