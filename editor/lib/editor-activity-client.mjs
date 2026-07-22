export const EDITOR_ACTIVITY_STORAGE_KEY = "cycleways.editor.localActivityTiming";

export function createEditorActivityTracker({
  endpoint = "/api/editor-activity",
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage,
  flushDelayMs = 1500,
} = {}) {
  let enabled = true;
  try { enabled = storage?.getItem(EDITOR_ACTIVITY_STORAGE_KEY) !== "false"; } catch {}
  const sessionId = globalThis.crypto?.randomUUID?.() || `session-${Date.now()}`;
  let queue = [];
  let timer = null;

  function scheduleFlush() {
    if (timer || queue.length === 0 || !enabled) return;
    timer = globalThis.setTimeout(() => {
      timer = null;
      flush().catch(() => {});
    }, flushDelayMs);
  }

  function record(event) {
    if (!enabled) return;
    queue.push({ ...event, sessionId });
    if (queue.length >= 50) flush().catch(() => {});
    else scheduleFlush();
  }

  async function flush() {
    if (!enabled || queue.length === 0 || !fetchImpl) return;
    if (timer) {
      globalThis.clearTimeout(timer);
      timer = null;
    }
    const events = queue;
    queue = [];
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
        keepalive: true,
      });
      if (!response.ok) throw new Error(`activity endpoint returned ${response.status}`);
    } catch (error) {
      queue = [...events.slice(-200), ...queue];
      throw error;
    }
  }

  return {
    get enabled() { return enabled; },
    setEnabled(nextEnabled) {
      enabled = Boolean(nextEnabled);
      try { storage?.setItem(EDITOR_ACTIVITY_STORAGE_KEY, String(enabled)); } catch {}
      if (enabled) scheduleFlush();
      else queue = [];
    },
    action(name, context = {}) {
      record({ type: "action", name, context });
    },
    timing(name, durationMs, context = {}) {
      record({ type: "timing", name, durationMs, context });
    },
    flush,
  };
}
