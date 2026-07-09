// Headless scenario runner (nav-scenario-harness). Drives the real navigation
// session over a scenario's fixes via replaySession, then maps every recorded
// state through the pure presentation + haptic planners into a "user-visible
// timeline": what the NavPanel showed and buzzed, per fix. This timeline is
// the contract the expectation evaluator (scenarioExpectations.js) checks and
// the JSON artifact agents read when a scenario fails.
import {
  cameraHeadingTargetForState,
  createCameraHeadingGovernor,
} from "./cameraHeading.js";
import { createCameraDirector } from "./cameraDirector.js";
import { createCueHapticPlanner } from "./cueHaptics.js";
import { getNavigationPresentation } from "./navigationPresentation.js";
import { createNavigationVoicePlanner } from "./navigationVoice.js";
import { replaySession } from "./replayRunner.js";

// Connector behavior per scenario. "straight-line" answers every rejoin/
// approach request with the direct segment (the suggestion lifecycle runs
// without the routing network); "fail" exercises the failure UX; "none"
// leaves requests pending (replaySession controlledConnector).
export function connectorRouterForMode(mode) {
  if (mode === "none") return null;
  if (mode === "fail") return () => ({ failure: "scenario-forced-failure" });
  if (mode === "show-leg") {
    return (request) => ({
      geometry: [request.from, request.to],
      edgeCosts: [
        {
          routeClass: "path_track",
          roadType: null,
          cyclewaysSegmentIds: [],
          distanceMeters: 100,
        },
      ],
    });
  }
  if (mode === "guide-turn") {
    return (request) => ({
      geometry: [
        request.from,
        { lat: request.from.lat, lng: request.to.lng },
        request.to,
      ],
      edgeCosts: [
        {
          routeClass: "road",
          roadType: "road",
          cyclewaysSegmentIds: [],
          distanceMeters: 100,
        },
      ],
    });
  }
  return (request) => ({ geometry: [request.from, request.to] });
}

export function buildUserTimeline(replayTimeline) {
  const haptics = createCueHapticPlanner();
  const voice = createNavigationVoicePlanner();
  // Same camera policy the app runs: target per state, governed adoption.
  const cameraGovernor = createCameraHeadingGovernor();
  const cameraDirector = createCameraDirector();
  return (Array.isArray(replayTimeline) ? replayTimeline : []).map(
    (state, index) => {
      const presentation = getNavigationPresentation(state);
      const hapticPlan = state.cueEvent
        ? haptics.plan(state.cueEvent, state.latestFix?.timestamp ?? 0)
        : { kind: null };
      const voicePlan = state.cueEvent
        ? voice.plan(state.cueEvent, state, state.latestFix?.timestamp ?? 0)
        : { utterance: null };
      const cameraShot = cameraDirector.update(
        state,
        state.latestFix?.timestamp ?? 0,
      );
      const cameraHeadingTargetDeg = cameraHeadingTargetForState(state, cameraShot);
      const cameraHeadingDeg = cameraGovernor.update(
        cameraHeadingTargetDeg,
        state.latestFix?.timestamp ?? 0,
      );
      return {
        index,
        timestamp: state.latestFix?.timestamp ?? null,
        status: state.status,
        offRoute: state.offRoute === true,
        wrongWay: state.progress?.wrongWay === true,
        hasAcquiredRoute: state.progress?.hasAcquiredRoute === true,
        justAcquired: state.justAcquired === true,
        progressMeters: state.progress?.progressMeters ?? null,
        remainingMeters: state.progress?.remainingMeters ?? null,
        activeCueType: state.activeCue?.cue?.type ?? null,
        cueEventKind: state.cueEvent?.kind ?? null,
        suggestionStatus: state.approach?.suggestionStatus ?? "idle",
        rejoinTargetProgressMeters:
          state.approach?.target?.mode === "rejoin"
            ? (state.approach.target.mainProgressMeters ?? null)
            : null,
        rejoinDistanceToRouteMeters:
          state.approach?.target?.mode === "rejoin"
            ? (state.approach.distanceToRouteMeters ?? null)
            : null,
        routeRequestId: state.routeRequest?.requestId ?? null,
        routeRequestTargetProgressMeters:
          state.routeRequest?.targetMode === "rejoin"
            ? (state.routeRequest.targetProgressMeters ?? null)
            : null,
        connectorResult: state.connectorResult?.result ?? null,
        haptic: hapticPlan.kind ?? null,
        voice: voicePlan.utterance,
        voiceText: voicePlan.utterance?.text ?? null,
        approachOwnershipTier: state.approach?.ownershipTier ?? null,
        cameraHeadingTargetDeg,
        cameraHeadingDeg,
        cameraStage: cameraShot.stage,
        cameraMode: cameraShot.mode,
        cameraPitch: cameraShot.pitch ?? null,
        cameraZoom: cameraShot.zoom ?? null,
        cameraFitKind: cameraShot.fitKind ?? null,
        cameraFocusKind: cameraShot.focusKind ?? null,
        cardMode: presentation.cardMode,
        chipText: presentation.chip?.text ?? null,
        presentation: {
          statusText: presentation.statusText,
          acquisitionText: presentation.acquisitionText,
          cueText: presentation.cueText,
          cueDistanceText: presentation.cueDistanceText,
          remainingText: presentation.remainingText,
          currentRoadText: presentation.currentRoadText,
          contextText: presentation.contextText,
          guidanceText: presentation.guidanceText,
          wrongWayText: presentation.wrongWay ? presentation.wrongWayText : "",
          showCue: presentation.showCue,
          showApproach: presentation.showApproach,
        },
      };
    },
  );
}

export function runScenario(resolved) {
  const mode = resolved.connector ?? "straight-line";
  const router = connectorRouterForMode(mode);
  const options = router
    ? { connectorRouter: router }
    : { controlledConnector: true };
  const replay = replaySession(resolved.navigationRoute, resolved.fixes, options);
  const timeline = buildUserTimeline(replay.timeline);
  return {
    timeline,
    last: timeline[timeline.length - 1] ?? null,
    routeRequests: replay.routeRequests,
    replay,
  };
}
