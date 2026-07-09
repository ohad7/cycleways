// Controllable dev-only location source shared by SIM and CAM. SIM plays the
// full journey at the selected speed. CAM rebuilds state quickly before a
// bookmark's pre-roll, then plays the visible transition at 1x and holds.

export function createJourneyPlaybackSource(fixes, options = {}) {
  const list = Array.isArray(fixes) ? fixes : [];
  const speed = Math.max(0.1, Number(options.speed) || 1);
  const warmupIntervalMs = Math.max(8, Number(options.warmupIntervalMs) || 20);
  const warmupEndIndex = Math.min(
    list.length - 1,
    Number.isFinite(Number(options.warmupEndIndex))
      ? Number(options.warmupEndIndex)
      : -1,
  );
  const startIndex = Math.max(
    warmupEndIndex + 1,
    Number.isFinite(Number(options.startIndex)) ? Number(options.startIndex) : 0,
  );
  const endIndex = Math.min(
    list.length - 1,
    Number.isFinite(Number(options.endIndex))
      ? Number(options.endIndex)
      : list.length - 1,
  );
  const schedule = options.schedule || ((callback, delay) => setTimeout(callback, delay));
  const cancelSchedule = options.cancelSchedule || ((handle) => clearTimeout(handle));
  let onFix = null;
  let timer = null;
  let warmupIndex = 0;
  let index = startIndex;
  let running = false;
  let paused = false;
  let completed = false;
  let stopped = false;

  const isWarming = () => warmupIndex <= warmupEndIndex;

  const clearTimer = () => {
    if (timer !== null) cancelSchedule(timer);
    timer = null;
  };

  const emitState = () => options.onStateChange?.({
    index: isWarming() ? warmupIndex : index,
    running,
    paused,
    completed,
    stopped,
    warming: isWarming(),
    endIndex,
  });

  const delayFor = (fromIndex, toIndex) => {
    const from = Number(list[fromIndex]?.timestamp);
    const to = Number(list[toIndex]?.timestamp);
    const logical = Number.isFinite(from) && Number.isFinite(to)
      ? Math.max(0, to - from)
      : 1000;
    return Math.max(16, logical / speed);
  };

  const finish = () => {
    clearTimer();
    running = false;
    completed = true;
    emitState();
    options.onComplete?.();
  };

  const emitOne = () => {
    if (!onFix || stopped || completed) return false;
    if (isWarming()) {
      onFix(list[warmupIndex]);
      warmupIndex += 1;
      emitState();
      return true;
    }
    if (index > endIndex || index >= list.length) {
      finish();
      return false;
    }
    onFix(list[index]);
    index += 1;
    emitState();
    if (index > endIndex || index >= list.length) finish();
    return true;
  };

  const scheduleNext = () => {
    clearTimer();
    if (!running || paused || stopped || completed) return;
    if (!isWarming() && (index > endIndex || index >= list.length)) {
      finish();
      return;
    }
    const warming = isWarming();
    const previousIndex = Math.max(startIndex, index - 1);
    const delay = warming
      ? (warmupIndex === 0 ? 0 : warmupIntervalMs)
      : index === startIndex
        ? 0
        : delayFor(previousIndex, index);
    timer = schedule(() => {
      timer = null;
      if (emitOne()) scheduleNext();
    }, delay);
  };

  const reset = () => {
    clearTimer();
    warmupIndex = 0;
    index = startIndex;
    running = false;
    paused = false;
    completed = false;
    stopped = false;
    emitState();
  };

  return {
    requestPermissions: async () => ({ granted: true, background: false }),
    startWatch: async ({ onFix: nextOnFix }) => {
      onFix = nextOnFix;
      stopped = false;
      completed = false;
      running = true;
      paused = false;
      emitState();
      scheduleNext();
      return {
        stop: () => {
          clearTimer();
          running = false;
          stopped = true;
          emitState();
        },
      };
    },
    pause() {
      paused = true;
      clearTimer();
      emitState();
    },
    resume() {
      if (stopped || completed) return;
      paused = false;
      running = true;
      emitState();
      scheduleNext();
    },
    step() {
      if (stopped || completed) return false;
      paused = true;
      clearTimer();
      const emitted = emitOne();
      emitState();
      return emitted;
    },
    restart: reset,
    getState: () => ({
      index: isWarming() ? warmupIndex : index,
      running,
      paused,
      completed,
      stopped,
      warming: isWarming(),
      endIndex,
    }),
  };
}
