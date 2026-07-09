// Stage-aware navigation camera (nav-ui-redesign). Decides per fix WHAT the
// camera should do: a follow shot (pitch/zoom/center bias) or a declarative fit
// shot (approach/rejoin/whole-route). The heading governor (cameraHeading.js)
// keeps deciding orientation; BuildScreen resolves focus/fit points.

const MIN_STAGE_DWELL_MS = 2000; // stage changes settle; off-route/arrived skip it
const ARRIVED_REMAINING_M = 15;
const ARRIVAL_CUE_MAX_M = 150;
const RIDE_FOLLOW_PITCH = 55;
const APPROACH_TOO_FAR_ZOOM = 11.5;

function clamp(min, max, value) {
  return Math.min(max, Math.max(min, value));
}

// Zoom that frames a span of roughly `spanMeters` on a phone screen.
export function zoomForSpanMeters(spanMeters) {
  const span = Math.max(50, Number(spanMeters) || 0);
  return clamp(12, 17.5, 17.5 - Math.log2(span / 100));
}

function stageFor(state) {
  const progress = state?.progress || null;
  if (state?.offRoute === true) return "off-route";
  if (state?.cueEvent?.acquisition === "join-route") return "join-route";
  if (
    progress?.hasAcquiredRoute === true &&
    Number.isFinite(progress?.remainingMeters) &&
    progress.remainingMeters <= ARRIVED_REMAINING_M
  ) {
    return "arrived";
  }
  if (state?.status === "approaching") {
    const approach = state?.approach || {};
    const tier = approach.ownershipTier || "unknown";
    const cueType = approach.approachActiveCue?.cue?.type ?? null;
    if (tier === "guide" && (cueType === "turn" || cueType === "bend")) {
      return "approach-guide-pre-turn";
    }
    if (tier === "guide") return "approach-guide";
    if (tier === "show-leg") return "approach-show-leg";
    if (tier === "too-far") return "approach-too-far";
    return "approach-start";
  }
  const cueType = state?.activeCue?.cue?.type ?? null;
  if (
    cueType === "arrive" &&
    (state.activeCue.distanceToCueMeters ?? Infinity) <= ARRIVAL_CUE_MAX_M
  ) {
    return "arrival";
  }
  if (cueType === "turn" || cueType === "bend") return "pre-turn";
  return "ride";
}

function shotFor(stage, state) {
  const progress = state?.progress || null;
  const approachProgress = state?.approach?.approachProgress || null;
  switch (stage) {
    case "approach-too-far":
      return {
        stage,
        mode: "follow",
        pitch: RIDE_FOLLOW_PITCH,
        zoom: APPROACH_TOO_FAR_ZOOM,
        centerBias: 0,
        snapOnEnter: true,
      };
    case "approach-show-leg":
      return { stage, mode: "fit", pitch: 20, fitKind: "approach-leg" };
    case "approach-guide": {
      const speed = Number.isFinite(approachProgress?.smoothedSpeedMps)
        ? approachProgress.smoothedSpeedMps
        : Number.isFinite(progress?.smoothedSpeedMps)
          ? progress.smoothedSpeedMps
          : 3;
      const t = clamp(0, 1, (speed - 2) / 6);
      return {
        stage,
        mode: "follow",
        pitch: RIDE_FOLLOW_PITCH,
        zoom: 16.8 + (15.8 - 16.8) * t,
        centerBias: 0,
        focusKind: "approach-leg",
      };
    }
    case "approach-guide-pre-turn":
      return {
        stage,
        mode: "follow",
        pitch: 35,
        zoom: 17.2,
        centerBias: 0.5,
        focusKind: "approach-cue",
      };
    case "approach-start":
      return { stage, mode: "fit", pitch: 20, fitKind: "approach-start" };
    case "join-route":
      return {
        stage,
        mode: "follow",
        pitch: 40,
        zoom: 16.8,
        centerBias: 0.35,
        focusKind: "route-start",
      };
    case "off-route":
      return { stage, mode: "fit", pitch: 20, fitKind: "rejoin" };
    case "pre-turn":
      return {
        stage,
        mode: "follow",
        pitch: 35,
        zoom: 17.2,
        centerBias: 0.5,
        focusKind: "cue",
      };
    case "arrival":
      return {
        stage,
        mode: "follow",
        pitch: 35,
        zoom: 17.2,
        centerBias: 0.4,
        focusKind: "cue",
      };
    case "arrived":
      return { stage, mode: "fit", pitch: 0, fitKind: "route" };
    default: {
      // ride: zoom breathes with speed — see farther when fast.
      const speed = Number.isFinite(progress?.smoothedSpeedMps)
        ? progress.smoothedSpeedMps
        : 3;
      const t = clamp(0, 1, (speed - 2) / 6);
      return {
        stage: "ride",
        mode: "follow",
        pitch: RIDE_FOLLOW_PITCH,
        zoom: 16.8 + (15.8 - 16.8) * t,
        centerBias: 0,
      };
    }
  }
}

export function createCameraDirector() {
  let stage = null;
  let candidateStage = null;
  let candidateSinceMs = null;

  return {
    update(state, nowMs) {
      const wanted = stageFor(state);
      if (stage === null) {
        stage = wanted;
        candidateStage = null;
        candidateSinceMs = null;
      } else if (wanted !== stage) {
        const immediate =
          wanted === "off-route" ||
          wanted === "arrived" ||
          wanted === "join-route" ||
          wanted.startsWith("approach-");
        if (immediate) {
          stage = wanted;
          candidateStage = null;
          candidateSinceMs = null;
        } else {
          if (candidateStage !== wanted) {
            candidateStage = wanted;
            candidateSinceMs = nowMs;
          }
          if (nowMs - candidateSinceMs >= MIN_STAGE_DWELL_MS) {
            stage = wanted;
            candidateStage = null;
            candidateSinceMs = null;
          }
        }
      } else {
        candidateStage = null;
        candidateSinceMs = null;
      }
      return shotFor(stage, state);
    },
    reset() {
      stage = null;
      candidateStage = null;
      candidateSinceMs = null;
    },
  };
}
