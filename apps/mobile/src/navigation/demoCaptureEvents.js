export function createDemoCaptureEventRecorder({ runId, mediaTime = () => 0, monotonicTime = () => globalThis.performance?.now?.() ?? Date.now(), upload, batchSize = 20 } = {}) {
  if (!runId) throw new Error("capture event recorder requires runId");
  let sequence = 0;
  let pending = [];
  let flushing = null;
  const flush = async () => {
    if (flushing) {
      await flushing;
      if (pending.length > 0) return flush();
      return;
    }
    if (pending.length === 0 || !upload) return;
    const batch = pending;
    pending = [];
    flushing = Promise.resolve().then(() => upload(batch));
    try {
      await flushing;
    } catch (error) {
      pending = [...batch, ...pending];
      throw error;
    } finally {
      flushing = null;
    }
  };
  return {
    record(kind, payload = {}, options = {}) {
      if (options.warmup && ["speech-request", "speech-start", "speech-done", "speech-error"].includes(kind)) return null;
      const event = {
        schemaVersion: 1,
        sequence: sequence++,
        runId,
        kind,
        mediaTimeMs: Number(options.mediaTimeMs ?? mediaTime()),
        monotonicTimeMs: Number(monotonicTime()),
        dispatchLatenessMs: Number(options.dispatchLatenessMs) || 0,
        payload,
      };
      pending.push(event);
      if (pending.length >= batchSize && !flushing) void flush().catch(() => {});
      return event;
    },
    flush,
    pending: () => [...pending],
    nextSequence: () => sequence,
  };
}

export function summarizeNavigationCaptureState(state) {
  return {
    status: state?.status || null,
    offRoute: state?.offRoute === true,
    progressMeters: state?.progress?.progressMeters ?? null,
    remainingMeters: state?.progress?.remainingMeters ?? null,
    cueKind: state?.cueEvent?.kind ?? null,
    activeCueType: state?.activeCue?.cue?.type ?? null,
  };
}
