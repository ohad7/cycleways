import { shortestAngleLerp } from "./navigationSmoothing.js";

export function createHeadlessCameraFrameSampler() {
  let frame = null;
  let lastTimestamp = null;
  let transitionStartedAt = null;

  return {
    update(intent, heading, timestamp) {
      const now = Number(timestamp) || 0;
      const stageChanged = frame?.stage !== intent?.stage;
      const durationMs = Math.max(0, Number(intent?.transition?.durationMs) || 0);
      if (!frame) {
        frame = {
          stage: intent?.stage ?? null,
          pitch: intent?.pitch ?? null,
          heading: Number.isFinite(heading) ? heading : null,
          transitionState: "settled",
        };
        lastTimestamp = now;
        transitionStartedAt = now;
        return { ...frame };
      }
      if (stageChanged) transitionStartedAt = now;
      const dtMs = Math.max(0, now - (lastTimestamp ?? now));
      lastTimestamp = now;
      const alpha = durationMs > 0 ? Math.min(1, dtMs / durationMs) : 1;
      const targetPitch = Number(intent?.pitch);
      const pitch = Number.isFinite(targetPitch) && Number.isFinite(frame.pitch)
        ? frame.pitch + (targetPitch - frame.pitch) * alpha
        : targetPitch;
      const nextHeading = Number.isFinite(heading) && Number.isFinite(frame.heading)
        ? shortestAngleLerp(frame.heading, heading, alpha)
        : Number.isFinite(heading)
          ? heading
          : frame.heading;
      const elapsed = now - transitionStartedAt;
      frame = {
        stage: intent?.stage ?? null,
        pitch,
        heading: nextHeading,
        transitionState:
          durationMs > 0 && elapsed < durationMs ? "running" : "settled",
      };
      return { ...frame };
    },
    reset() {
      frame = null;
      lastTimestamp = null;
      transitionStartedAt = null;
    },
  };
}

