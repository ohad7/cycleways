import { generateTrack } from "@cycleways/core/navigation/trackGenerator.js";

export function deriveRidePlanJourneyFixes(plan, options = {}) {
  if (!plan?.effectiveRoute?.canNavigate || plan.approachTier !== "at") return [];
  return generateTrack(plan.effectiveRoute, {
    speedMps: 8,
    intervalMs: 1000,
    seed: 71,
    startTimestamp: Number(options.startTimestamp) || 0,
    stopAtMeters: options.mode === "cam" ? 120 : null,
  });
}

export function journeyRequiresRideIntro(resolved) {
  return resolved?.entryMode === "ride-intro";
}

export function shouldAcceptNativeLocationUpdate({ journeyActive = false } = {}) {
  return journeyActive !== true;
}

export function initialJourneyPlaybackState({ resolved, bookmark = null, mode = "sim" }) {
  const waitingForStart = journeyRequiresRideIntro(resolved);
  return {
    mode,
    journey: resolved?.name || "",
    bookmark: bookmark?.label || bookmark?.id || "full journey",
    bookmarkId: bookmark?.id || "",
    phase: bookmark?.phase || "post-start",
    startAction: bookmark?.startAction || "require-confirm",
    expectedStage: bookmark?.expectedStage || "",
    timestamp: resolved?.fixes?.[0]?.timestamp ?? null,
    lifecycle: waitingForStart ? "waiting-for-start" : "starting-session",
    waitingForStart,
    warming: false,
    running: false,
    paused: false,
    completed: false,
    stopped: false,
  };
}

export function journeyPlaybackPatch(playback = {}) {
  let lifecycle = "playing";
  if (playback.completed === true) lifecycle = "hold";
  else if (playback.paused === true) lifecycle = "paused";
  else if (playback.warming === true) lifecycle = "rebuilding";
  else if (playback.running !== true) lifecycle = "starting-session";
  return {
    ...playback,
    lifecycle,
    waitingForStart: false,
  };
}

export function journeyLifecycleLabel(playback = {}) {
  switch (playback.lifecycle) {
    case "waiting-for-start":
      return playback.phase === "pre-start"
        ? "BEFORE START · WAITING"
        : "INTRO · TAP THE REAL START BUTTON";
    case "starting-session":
      return "STARTING SESSION";
    case "rebuilding":
      return "REBUILDING SESSION STATE";
    case "paused":
      return "PAUSED";
    case "hold":
      return "BOOKMARK REACHED · FROZEN";
    default:
      return "PLAYING 1×";
  }
}
