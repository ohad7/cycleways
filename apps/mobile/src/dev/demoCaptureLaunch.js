export function parseDemoCaptureLaunch(href, { enabled = false } = {}) {
  if (!enabled || typeof href !== "string") return null;
  let url;
  try { url = new URL(href); } catch { return null; }
  if (url.protocol !== "cycleways:" || url.hostname !== "build") return null;
  const demo = url.searchParams.get("demo");
  const token = url.searchParams.get("token");
  const runId = url.searchParams.get("run");
  if (!demo || !token || !runId) throw new Error("demo capture link requires demo, token, and run");
  const server = new URL(demo);
  if (server.protocol !== "http:") throw new Error("demo capture server must use local HTTP");
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(server.hostname);
  if (!loopback) throw new Error("demo capture server must be loopback in v1");
  return { baseUrl: server.origin, token, runId };
}
