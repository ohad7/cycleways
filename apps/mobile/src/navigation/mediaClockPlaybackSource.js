export function createMediaClockPlaybackSource(fixes, options = {}) {
  const list = Array.isArray(fixes) ? [...fixes] : [];
  const visibleInMs = Number(options.visibleInMs) || 0;
  const visibleOutMs = Number.isFinite(Number(options.visibleOutMs)) ? Number(options.visibleOutMs) : Infinity;
  const now = options.now || (() => globalThis.performance?.now?.() ?? Date.now());
  const schedule = options.schedule || ((callback, delay) => setTimeout(callback, delay));
  const cancelSchedule = options.cancelSchedule || clearTimeout;
  let onFix = null;
  let timer = null;
  let epoch = null;
  let index = 0;
  let phase = "idle";
  let stopped = false;
  const lateness = [];

  const setPhase = (next) => {
    phase = next;
    options.onStateChange?.({ phase, index, mediaTimeMs: epoch === null ? null : now() - epoch });
  };
  const clear = () => { if (timer !== null) cancelSchedule(timer); timer = null; };
  const dispatch = (fix, warmup = false) => {
    const actualMediaTimeMs = epoch === null ? fix.timestamp : now() - epoch;
    const dispatchLatenessMs = warmup ? 0 : Math.max(0, actualMediaTimeMs - fix.timestamp);
    if (!warmup) lateness.push(dispatchLatenessMs);
    onFix?.(fix, { warmup, effectsSuppressed: warmup, dispatchLatenessMs, mediaTimeMs: fix.timestamp });
    options.onDispatch?.({ fix, warmup, effectsSuppressed: warmup, dispatchLatenessMs, mediaTimeMs: fix.timestamp });
  };
  const hold = () => { clear(); setPhase("hold"); options.onComplete?.(); };
  const holdAtVisibleEnd = () => {
    const remainingMs = epoch === null ? 0 : epoch + visibleOutMs - now();
    if (Number.isFinite(remainingMs) && remainingMs > 0) {
      timer = schedule(hold, remainingMs);
      return;
    }
    hold();
  };
  const tick = () => {
    timer = null;
    if (stopped || phase !== "playing") return;
    const mediaNow = now() - epoch;
    while (index < list.length && list[index].timestamp <= mediaNow && list[index].timestamp <= visibleOutMs) {
      dispatch(list[index], false);
      index += 1;
    }
    if (index >= list.length || list[index].timestamp > visibleOutMs) return holdAtVisibleEnd();
    timer = schedule(tick, Math.max(0, epoch + list[index].timestamp - now()));
  };

  const source = {
    requestPermissions: async () => ({ granted: true, background: false }),
    startWatch: async ({ onFix: handler }) => {
      onFix = handler;
      if (options.autoArm === true && phase === "idle") {
        queueMicrotask(() => {
          if (phase === "idle" && !stopped) {
            try { source.arm(); } catch (error) { options.onError?.(error); }
          }
        });
      }
      return { stop: () => { stopped = true; clear(); setPhase("stopped"); } };
    },
    arm() {
      if (!onFix) throw new Error("startWatch must be installed before arm");
      if (phase !== "idle") throw new Error(`cannot arm from ${phase}`);
      setPhase("warming");
      // Rebuild the whole navigation state up to the edit point. Warm-up fixes
      // suppress speech and other visible effects, so the first recorded frame
      // still represents the same session as an uninterrupted ride.
      while (index < list.length && list[index].timestamp < visibleInMs) {
        dispatch(list[index], true);
        index += 1;
      }
      setPhase("armed");
    },
    beginVisiblePlayback() {
      if (phase !== "armed") throw new Error(`cannot begin playback from ${phase}`);
      epoch = now() - visibleInMs;
      setPhase("playing");
      tick();
    },
    abort() { stopped = true; clear(); setPhase("aborted"); },
    pause() { clear(); if (phase === "playing") setPhase("paused"); },
    resume() {
      if (phase !== "paused") return;
      epoch = now() - (list[Math.max(0, index - 1)]?.timestamp ?? visibleInMs);
      setPhase("playing");
      tick();
    },
    restart() {
      clear();
      epoch = null;
      index = 0;
      stopped = false;
      lateness.splice(0);
      setPhase("idle");
    },
    getState() { return { phase, index, running: phase === "playing", paused: phase === "paused", completed: phase === "hold", stopped }; },
    getDiagnostics() {
      return {
        phase,
        index,
        epoch,
        mediaTimeMs: epoch === null ? null : now() - epoch,
        dispatchedVisible: lateness.length,
        maxLatenessMs: lateness.length ? Math.max(...lateness) : 0,
        averageLatenessMs: lateness.length ? lateness.reduce((sum, value) => sum + value, 0) / lateness.length : 0,
      };
    },
  };
  return source;
}
