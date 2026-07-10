// Stateful semantic navigation-camera director. It chooses WHY and WHAT to
// frame; the mobile adapter owns exact Mapbox projection and interpolation.
import { cameraIntentForStage } from "./cameraViewportIntent.js";

const MIN_STAGE_DWELL_MS = 2000;
const ARRIVED_REMAINING_M = 15;
const ARRIVAL_CUE_MAX_M = 150;
const MANEUVER_ENTER_MAX_M = 140;

function clamp(min, max, value) {
  return Math.min(max, Math.max(min, value));
}

// Kept for callers outside navigation-camera policy that need a simple
// overhead span estimate. Runtime navigation zoom is corridor-derived.
export function zoomForSpanMeters(spanMeters) {
  const span = Math.max(50, Number(spanMeters) || 0);
  return clamp(12, 17.5, 17.5 - Math.log2(span / 100));
}

function maneuverIsNear(activeCue) {
  const cueType = activeCue?.cue?.type ?? null;
  const distance = Number(activeCue?.distanceToCueMeters);
  return (
    (cueType === "turn" || cueType === "bend") &&
    Number.isFinite(distance) &&
    distance >= -25 &&
    distance <= MANEUVER_ENTER_MAX_M
  );
}

export function navigationCameraStage(state) {
  const progress = state?.progress || null;
  if (state?.offRoute === true) return "off-route";
  if (state?.cameraTransition?.kind === "join") return "join-route";
  if (state?.cameraTransition?.kind === "reacquire") return "reacquire-route";
  if (state?.cueEvent?.acquisition === "join-route") return "join-route";
  if (
    progress?.hasAcquiredRoute === true &&
    Number.isFinite(progress?.remainingMeters) &&
    progress.remainingMeters <= ARRIVED_REMAINING_M
  ) {
    return "arrived-local";
  }
  if (state?.status === "approaching") {
    const approach = state?.approach || {};
    const tier = approach.ownershipTier || "unknown";
    if (tier === "guide" && maneuverIsNear(approach.approachActiveCue)) {
      return "approach-guide-pre-turn";
    }
    if (tier === "guide") return "approach-guide";
    if (tier === "too-far") return "approach-too-far";
    return "approach-resolving";
  }
  const cueType = state?.activeCue?.cue?.type ?? null;
  if (
    cueType === "arrive" &&
    (state.activeCue.distanceToCueMeters ?? Infinity) <= ARRIVAL_CUE_MAX_M
  ) {
    return "arrival";
  }
  if (maneuverIsNear(state?.activeCue)) return "pre-turn";
  return "ride";
}

function retainedResolvingIntent(lastAccepted) {
  if (!lastAccepted) return null;
  return {
    ...lastAccepted,
    stage: "approach-resolving",
    retainedStage: lastAccepted.stage,
    holdFrame: true,
    transition: { kind: "hold", durationMs: 0 },
  };
}

export function createCameraDirector() {
  let stage = null;
  let candidateStage = null;
  let candidateSinceMs = null;
  let lastAcceptedIntent = null;
  let activeTransitionId = null;
  let activeTransitionSinceMs = null;

  return {
    update(state, nowMs) {
      let wanted = navigationCameraStage(state);
      const transition = state?.cameraTransition || null;
      let completedTransition = false;
      if (
        transition?.id &&
        (wanted === "join-route" || wanted === "reacquire-route")
      ) {
        if (activeTransitionId !== transition.id) {
          activeTransitionId = transition.id;
          activeTransitionSinceMs = nowMs;
        }
        const durationMs = Number(transition.durationMs) || 1200;
        if (nowMs - activeTransitionSinceMs >= durationMs) {
          wanted = "ride";
          completedTransition = true;
        }
      } else {
        activeTransitionId = null;
        activeTransitionSinceMs = null;
      }
      if (wanted === "approach-resolving") {
        return (
          retainedResolvingIntent(lastAcceptedIntent) ||
          cameraIntentForStage("approach-resolving", state)
        );
      }

      if (stage === null || stage === "approach-resolving") {
        stage = wanted;
        candidateStage = null;
        candidateSinceMs = null;
      } else if (wanted !== stage) {
        const immediate =
          wanted === "off-route" ||
          wanted === "arrived-local" ||
          wanted === "join-route" ||
          wanted === "reacquire-route" ||
          completedTransition ||
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

      const next = cameraIntentForStage(stage, state);
      lastAcceptedIntent = next;
      return next;
    },

    reset() {
      stage = null;
      candidateStage = null;
      candidateSinceMs = null;
      lastAcceptedIntent = null;
      activeTransitionId = null;
      activeTransitionSinceMs = null;
    },
  };
}
