import { validateDemoBundle } from "@cycleways/core/navigation/demoBundle.js";

export function createDemoCaptureClient({ baseUrl, token, runId, fetchImpl = fetch, timeoutMs = 10_000 }) {
  if (!baseUrl || !token || !runId) throw new Error("demo capture client requires baseUrl, token, and runId");
  const request = async (path, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(options.headers || {}),
        },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `capture server returned ${response.status}`);
      return body;
    } catch (error) {
      if (error.name === "AbortError") throw new Error(`capture server timed out after ${timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    runId,
    async loadBundle() { return validateDemoBundle(await request("/v1/bundle")); },
    ready(client = {}) { return request("/v1/client/ready", { method: "POST", body: JSON.stringify({ runId, client }) }); },
    events(events) { return request("/v1/client/events", { method: "POST", body: JSON.stringify({ events }) }); },
    complete() { return request("/v1/client/complete", { method: "POST", body: JSON.stringify({ runId }) }); },
    control() { return request("/v1/control"); },
    status() { return request("/v1/status"); },
  };
}
