// Pure navigation-session controller. Native code supplies location fixes and
// performs best-effort connector route requests. The main route remains the
// acquisition authority; every successfully routed pre-route connector inside
// the product boundary becomes a temporary narrated approach leg.
// Acquiring the main route is the only handoff into `navigating`.

import { getDistance } from "../utils/distance.js";
import { computeBearing } from "../utils/geometry.js";
import { classifyConnector, DEFAULT_CONNECTOR_THRESHOLDS } from "../routing/connectorConfidence.js";
import { computeConnectorFeatures } from "../routing/connectorFeatures.js";
import { buildApproachLeg } from "./approachLeg.js";
import {
  JOIN_SKIP_PROMPT_M,
  approachTargetChoices,
  selectConnectorTarget,
} from "./connectorTargeting.js";
import { buildRouteCues, selectActiveCue } from "./navigationCues.js";
import { buildNavigationGeometry } from "./navigationRoute.js";
import { createRouteProgressTracker } from "./routeProgress.js";

export const NAV_ACTIONS = {
  START: "START",
  PERMISSION_GRANTED: "PERMISSION_GRANTED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  LOCATION: "LOCATION",
  CONNECTOR_READY: "CONNECTOR_READY",
  CONNECTOR_FAILED: "CONNECTOR_FAILED",
  PAUSE: "PAUSE",
  RESUME: "RESUME",
  RECENTER: "RECENTER",
  USER_PANNED: "USER_PANNED",
  BACKGROUND_UNAVAILABLE: "BACKGROUND_UNAVAILABLE",
  STOP: "STOP",
  ERROR: "ERROR",
};

export const ARRIVAL_LATCH_M = 15;
export const ARRIVAL_CONFIRM_FIXES = 2;

const ACTIVE = new Set(["navigating", "off-route", "approaching"]);
const SUPPORTED_APPROACH_TIERS = new Set(["unknown", "guide", "too-far"]);
const REQUEST_MIN_MOVE_M = 200;
const REJOIN_REQUEST_MIN_MOVE_M = 50;

function emptyApproach() {
  return {
    target: null,
    choices: null,
    suggestionGeometry: null,
    suggestionStatus: "idle",
    suggestionDistanceMeters: null,
    distanceToRouteMeters: null,
    ownershipTier: "unknown",
    ownershipResolving: false,
    ownershipRefreshing: false,
    handoffSuggested: true,
    handoffProminence: "secondary",
    classificationReasons: [],
    connectorFeatures: null,
    approachProgress: null,
    approachActiveCue: null,
    approachLegGeometry: null,
  };
}

function fixPoint(fix) {
  return { lat: Number(fix.lat), lng: Number(fix.lng) };
}

export function createNavigationSession(navigationRoute, options = {}) {
  const mainTracker = createRouteProgressTracker(navigationRoute, options);
  const mainCues = buildRouteCues(navigationRoute);
  const connectorThresholds = {
    ...DEFAULT_CONNECTOR_THRESHOLDS,
    ...(options.connectorThresholds || {}),
  };
  const restored = options.snapshot && options.snapshot.version === 1
    ? options.snapshot
    : null;

  let mainCueKey = restored?.mainCueKey ?? null;
  let wasOffRoute = restored?.wasOffRoute === true;
  let wasWrongWay = restored?.wasWrongWay === true;
  let rejoinAnnounced = restored?.rejoinAnnounced === true;
  let arrivalDetectedAt = Number.isFinite(Number(restored?.arrivalDetectedAt))
    ? Number(restored.arrivalDetectedAt)
    : null;
  let arrivalFixCount = Number.isFinite(Number(restored?.arrivalFixCount))
    ? Number(restored.arrivalFixCount)
    : 0;
  let lastConfirmedProgressMeters = Number.isFinite(
    Number(restored?.lastConfirmedProgressMeters),
  )
    ? Number(restored.lastConfirmedProgressMeters)
    : 0;
  let lastRequestPos = restored?.lastRequestPos ?? null;
  let connectorRequestAttempt = Number.isFinite(
    Number(restored?.connectorRequestAttempt),
  )
    ? Number(restored.connectorRequestAttempt)
    : 0;
  let requestSeq = Number.isFinite(Number(restored?.requestSeq))
    ? Number(restored.requestSeq)
    : 0;
  let cameraTransitionSeq = Number.isFinite(Number(restored?.cameraTransitionSeq))
    ? Number(restored.cameraTransitionSeq)
    : 0;
  let prePauseStatus = restored?.prePauseStatus || "navigating";
  const refollowIdleMs = Number.isFinite(Number(options.refollowIdleMs))
    ? Math.max(0, Number(options.refollowIdleMs))
    : 12_000;
  let lastUserPanAt = Number.isFinite(Number(restored?.lastUserPanAt))
    ? Number(restored.lastUserPanAt)
    : null;
  let approachTracker = null;
  let approachCues = [];
  let approachCueKey = null;

  let state = {
    status: "idle",
    route: navigationRoute,
    progress: null,
    activeCue: null,
    cueEvent: null,
    offRoute: false,
    endReason: null,
    arrival: null,
    cameraIntent: "follow",
    backgroundLocation: false,
    foregroundOnly: false,
    latestFix: null,
    approach: emptyApproach(),
    routeRequest: null,
    connectorResult: null,
    error: null,
    justAcquired: false,
    cameraTransition: null,
    rideStartTimestamp: null,
    ...(restored?.state || {}),
    route: navigationRoute,
    cueEvent: null,
    cameraTransition: null,
    arrival: arrivalDetectedAt === null ? null : { detectedAt: arrivalDetectedAt },
  };

  // Snapshots from the former visual-only connector tier must not strand an
  // upgraded session in a state that production can no longer create. Clear
  // unsupported ownership so the next fix requests a newly guided connector.
  if (!SUPPORTED_APPROACH_TIERS.has(state.approach?.ownershipTier)) {
    state = {
      ...state,
      approach: {
        ...state.approach,
        suggestionGeometry: null,
        suggestionStatus: "idle",
        suggestionDistanceMeters: null,
        ownershipTier: "unknown",
        ownershipResolving: false,
        ownershipRefreshing: false,
        classificationReasons: [],
        connectorFeatures: null,
        approachProgress: null,
        approachActiveCue: null,
        approachLegGeometry: null,
      },
      routeRequest: null,
    };
    lastRequestPos = null;
    connectorRequestAttempt = 0;
  }

  if (state.approach?.ownershipTier === "guide") {
    state = {
      ...state,
      approach: {
        ...state.approach,
        suggestionStatus: "idle",
        approachProgress: null,
        approachActiveCue: null,
        approachLegGeometry: null,
      },
      routeRequest: null,
    };
  }

  if (restored?.tracker) {
    mainTracker.restore(restored.tracker);
  }

  function set(patch) {
    state = { ...state, ...patch };
    return state;
  }

  // Single best-effort request gate: fire the first request freely, then only
  // again once the rider has moved a meaningful distance since the last one.
  function shouldRequest(fix, minMoveMeters = REQUEST_MIN_MOVE_M) {
    if (lastRequestPos === null) return true;
    return getDistance(lastRequestPos, fix) >= minMoveMeters;
  }

  function suggestionRequest(fix, target, purpose = "initial") {
    requestSeq += 1;
    connectorRequestAttempt += 1;
    lastRequestPos = fixPoint(fix);
    return {
      requestId: requestSeq,
      from: fixPoint(fix),
      to: target.point,
      targetMode: target.mode || null,
      targetProgressMeters: Number.isFinite(Number(target.mainProgressMeters))
        ? Number(target.mainProgressMeters)
        : null,
      attempt: connectorRequestAttempt,
      isRetry: connectorRequestAttempt > 1,
      purpose,
    };
  }

  function canRequestSuggestion(
    fix,
    {
      allowReadyRefresh = false,
      minMoveMeters = REQUEST_MIN_MOVE_M,
    } = {},
  ) {
    const status = state.approach.suggestionStatus;
    if (status === "requesting") return false;
    if (status === "ready" && !allowReadyRefresh) return false;
    return shouldRequest(fix, minMoveMeters);
  }

  function failedSuggestionPatch() {
    const keepGeometry =
      Array.isArray(state.approach.suggestionGeometry) &&
      state.approach.suggestionGeometry.length >= 2;
    return {
      ...state.approach,
      suggestionStatus: "failed",
      suggestionGeometry: keepGeometry ? state.approach.suggestionGeometry : null,
      suggestionDistanceMeters: keepGeometry
        ? state.approach.suggestionDistanceMeters
        : null,
      ownershipResolving: false,
      ownershipRefreshing: false,
    };
  }

  function handoffProminence(tier) {
    if (tier === "guide") return "hidden";
    if (tier === "too-far") return "primary";
    return "secondary";
  }

  function resetApproachRuntime() {
    approachTracker = null;
    approachCues = [];
    approachCueKey = null;
  }

  function cueFor(activeCue) {
    const key = activeCue
      ? `main:${activeCue.cue.type}:${activeCue.cue.distanceMeters}:${activeCue.phase}`
      : null;
    const event =
      key && key !== mainCueKey
        ? {
            kind: "cue",
            cueType: activeCue.cue.type,
            phase: activeCue.phase,
            cue: activeCue.cue,
          }
        : null;
    mainCueKey = key;
    return event;
  }

  function approachCueFor(activeCue) {
    const key = activeCue
      ? `approach:${activeCue.cue.type}:${activeCue.cue.distanceMeters}:${activeCue.phase}`
      : null;
    const event =
      key && key !== approachCueKey
        ? {
            kind: "cue",
            cueType: activeCue.cue.type,
            phase: activeCue.phase,
            cue: activeCue.cue,
            leg: "approach",
          }
        : null;
    approachCueKey = key;
    return event;
  }

  function connectorResultFromAction(action) {
    return action.connectorResult || {
      failure: null,
      geometry: action.geometry,
      distanceMeters: action.distanceMeters,
      edgeCosts: action.edgeCosts,
      snappedEndpoints: action.snappedEndpoints,
    };
  }

  function tooFarApproachPatch(reason = "beyond-too-far-radius") {
    resetApproachRuntime();
    return {
      suggestionGeometry: null,
      suggestionStatus: "idle",
      suggestionDistanceMeters: null,
      ownershipTier: "too-far",
      ownershipResolving: false,
      ownershipRefreshing: false,
      handoffSuggested: true,
      handoffProminence: handoffProminence("too-far"),
      classificationReasons: [reason],
      connectorFeatures: null,
      approachProgress: null,
      approachActiveCue: null,
      approachLegGeometry: null,
    };
  }

  function requestStartConnectorPatch(fix, target, choices, distanceToRouteMeters) {
    const hasAcceptedOwnership =
      state.approach.ownershipTier !== "unknown";
    const purpose = hasAcceptedOwnership
      ? "refresh"
      : state.approach.suggestionStatus === "failed"
        ? "retry"
        : "initial";
    return {
      status: "approaching",
      activeCue: null,
      offRoute: false,
      cueEvent: null,
      justAcquired: false,
      approach: {
        ...state.approach,
        choices,
        target,
        distanceToRouteMeters,
        suggestionStatus: "requesting",
        ownershipTier: hasAcceptedOwnership
          ? state.approach.ownershipTier
          : "unknown",
        ownershipResolving: !hasAcceptedOwnership,
        ownershipRefreshing: hasAcceptedOwnership,
        handoffSuggested: true,
        handoffProminence: hasAcceptedOwnership
          ? state.approach.handoffProminence
          : handoffProminence("unknown"),
        classificationReasons: hasAcceptedOwnership
          ? state.approach.classificationReasons
          : [],
      },
      routeRequest: suggestionRequest(fix, target, purpose),
      connectorResult: null,
    };
  }

  function dispatch(action) {
    if (state.cueEvent && action.type !== NAV_ACTIONS.LOCATION) {
      state = { ...state, cueEvent: null };
    }

    switch (action.type) {
      case NAV_ACTIONS.START:
        if (!navigationRoute?.canNavigate) {
          return set({
            status: "error",
            error: navigationRoute?.unavailableReason || "route-not-navigable",
          });
        }
        arrivalDetectedAt = null;
        arrivalFixCount = 0;
        return set({
          status: "requesting-permission",
          error: null,
          endReason: null,
          arrival: null,
        });

      case NAV_ACTIONS.PERMISSION_GRANTED:
        mainTracker.reset();
        resetApproachRuntime();
        mainCueKey = null;
        wasOffRoute = false;
        wasWrongWay = false;
        rejoinAnnounced = false;
        arrivalDetectedAt = null;
        arrivalFixCount = 0;
        lastUserPanAt = null;
        lastConfirmedProgressMeters = 0;
        lastRequestPos = null;
        connectorRequestAttempt = 0;
        return set({
          status: "navigating",
          backgroundLocation: action.background === true,
          foregroundOnly: action.background !== true,
          approach: emptyApproach(),
          routeRequest: null,
          connectorResult: null,
          cameraTransition: null,
          error: null,
          justAcquired: false,
          rideStartTimestamp: null,
          endReason: null,
          arrival: null,
        });

      case NAV_ACTIONS.LOCATION: {
        if (!ACTIVE.has(state.status)) return state;
        const latestFix = { ...action.fix };
        const fixTimestamp = Number(action.fix?.timestamp);
        const expiredTransition =
          state.cameraTransition &&
          Number.isFinite(fixTimestamp) &&
          Number.isFinite(Number(state.cameraTransition.expiresAt)) &&
          fixTimestamp >= Number(state.cameraTransition.expiresAt);
        state = {
          ...state,
          latestFix,
          cameraTransition: expiredTransition ? null : state.cameraTransition,
        };
        if (state.cameraIntent === "free" && Number.isFinite(fixTimestamp)) {
          // A pan recorded with no fix clock yet (Date.now fallback) or ahead
          // of the fix clock (journey playback's synthetic timestamps) would
          // wedge the camera free forever; adopt the fix clock and measure
          // idle from here.
          if (!Number.isFinite(lastUserPanAt) || lastUserPanAt > fixTimestamp) {
            lastUserPanAt = fixTimestamp;
          } else if (fixTimestamp - lastUserPanAt >= refollowIdleMs) {
            lastUserPanAt = null;
            state = { ...state, cameraIntent: "follow" };
          }
        }
        if (state.rideStartTimestamp === null) {
          state = { ...state, rideStartTimestamp: action.fix.timestamp };
        }
        const mainProgress = mainTracker.update(action.fix);

        // Not yet on the route: stay in `approaching` with a live distance to
        // the chosen target. A successful connector is app-guided; routing
        // failure or the product distance boundary falls back to too-far.
        if (!mainProgress.hasAcquiredRoute) {
          const choices = approachTargetChoices(navigationRoute, action.fix);
          let target = state.approach.target;
          if (!target && choices) {
            target =
              choices.skipMeters > 0 && choices.skipMeters < JOIN_SKIP_PROMPT_M
                ? { ...choices.nearest, mode: "nearest" }
                : { ...choices.start, mode: "start" };
          }
          const distanceToRouteMeters = target
            ? getDistance(action.fix, target.point)
            : null;
          if (
            Number.isFinite(distanceToRouteMeters) &&
            distanceToRouteMeters > connectorThresholds.tooFarRadiusMeters
          ) {
            return set({
              status: "approaching",
              progress: mainProgress,
              activeCue: null,
              offRoute: false,
              cueEvent: null,
              justAcquired: false,
              approach: {
                ...state.approach,
                choices,
                target,
                distanceToRouteMeters,
                ...tooFarApproachPatch("beyond-too-far-radius"),
              },
              routeRequest: null,
              connectorResult: null,
            });
          }

          if (
            target &&
            state.approach.ownershipTier === "guide" &&
            approachTracker
          ) {
            const approachProgress = approachTracker.update(action.fix);
            const approachActiveCue = selectActiveCue(
              approachCues,
              approachProgress.progressMeters,
            );
            return set({
              status: "approaching",
              progress: mainProgress,
              activeCue: null,
              offRoute: false,
              cueEvent: approachCueFor(approachActiveCue),
              justAcquired: false,
              approach: {
                ...state.approach,
                choices,
                target,
                distanceToRouteMeters,
                approachProgress,
                approachActiveCue,
              },
              routeRequest: null,
            });
          }

          if (
            target &&
            canRequestSuggestion(action.fix, {
              allowReadyRefresh: state.approach.ownershipTier !== "guide",
            })
          ) {
            return set({
              progress: mainProgress,
              ...requestStartConnectorPatch(
                action.fix,
                target,
                choices,
                distanceToRouteMeters,
              ),
            });
          }

          return set({
            status: "approaching",
            progress: mainProgress,
            activeCue: null,
            offRoute: false,
            cueEvent: null,
            justAcquired: false,
            approach: {
              ...state.approach,
              choices,
              target,
              distanceToRouteMeters,
            },
            routeRequest: state.approach.suggestionStatus === "requesting"
              ? state.routeRequest
              : null,
          });
        }

        const offRoute = mainProgress.offRoute;

        const remainingNow = Number(mainProgress.remainingMeters);
        const arrivalFix =
          Number.isFinite(remainingNow) && remainingNow <= ARRIVAL_LATCH_M;
        if (arrivalFix) {
          if (arrivalDetectedAt === null) {
            arrivalDetectedAt = action.fix.timestamp;
            arrivalFixCount = 0;
          }
          arrivalFixCount += 1;
          if (arrivalFixCount >= ARRIVAL_CONFIRM_FIXES) {
            requestSeq += 1;
            resetApproachRuntime();
            lastRequestPos = null;
            connectorRequestAttempt = 0;
            return set({
              status: "ended",
              endReason: "arrived",
              progress: mainProgress,
              activeCue: null,
              cueEvent: null,
              offRoute: false,
              arrival: { detectedAt: arrivalDetectedAt },
              approach: emptyApproach(),
              routeRequest: null,
              connectorResult: null,
              cameraTransition: null,
              justAcquired: false,
            });
          }
        } else {
          arrivalDetectedAt = null;
          arrivalFixCount = 0;
        }

        // Acquired but off-route: offer a best-effort rejoin suggestion. The
        // status stays `off-route` until the main route is physically acquired.
        if (offRoute && arrivalDetectedAt === null) {
          const firstOffRoute = !wasOffRoute;
          wasOffRoute = true;
          wasWrongWay = false;
          if (firstOffRoute) rejoinAnnounced = false;
          const rejoin = selectConnectorTarget(navigationRoute, action.fix, {
            mode: "rejoin",
            lastConfirmedProgressMeters,
          });
          const nextTarget = rejoin ? { ...rejoin, mode: "rejoin" } : null;
          if (
            nextTarget &&
            canRequestSuggestion(action.fix, {
              allowReadyRefresh: true,
              minMoveMeters: REJOIN_REQUEST_MIN_MOVE_M,
            })
          ) {
            return set({
              status: "off-route",
              progress: mainProgress,
              activeCue: null,
              offRoute: true,
              cueEvent: firstOffRoute ? { kind: "off-route" } : null,
              justAcquired: false,
              approach: {
                ...state.approach,
                target: nextTarget,
                distanceToRouteMeters: getDistance(action.fix, nextTarget.point),
                suggestionStatus: "requesting",
                ownershipResolving: false,
                ownershipRefreshing:
                  Array.isArray(state.approach.suggestionGeometry) &&
                  state.approach.suggestionGeometry.length >= 2,
                // Keep the prior suggestion visible until the new one is ready.
              },
              routeRequest: suggestionRequest(
                action.fix,
                nextTarget,
                state.approach.suggestionStatus === "ready" ? "refresh" : "initial",
              ),
              connectorResult: null,
            });
          }
          const target =
            state.approach.suggestionStatus === "requesting"
              ? state.approach.target || nextTarget
              : state.approach.target || nextTarget;
          const distanceToRouteMeters = target
            ? getDistance(action.fix, target.point)
            : state.approach.distanceToRouteMeters;
          return set({
            status: "off-route",
            progress: mainProgress,
            activeCue: null,
            offRoute: true,
            cueEvent: firstOffRoute ? { kind: "off-route" } : null,
            justAcquired: false,
            approach: { ...state.approach, target, distanceToRouteMeters },
          });
        }

        // Acquired and on-route: the only handoff into `navigating`. Clear any
        // approach connector and resume main-route guidance.
        const recoveredFromOffRoute = wasOffRoute;
        lastConfirmedProgressMeters = mainProgress.progressMeters;
        const acquiredApproach =
          state.approach.target || state.approach.suggestionStatus !== "idle";
        const joinedFromOwnedApproach = state.approach.ownershipTier === "guide";
        const enteredEffectiveRoute = Boolean(
          acquiredApproach ||
            (navigationRoute?.requiresStartAcquisition === true &&
              state.progress?.hasAcquiredRoute !== true),
        );
        if (acquiredApproach) lastRequestPos = null;
        if (acquiredApproach) connectorRequestAttempt = 0;
        if (acquiredApproach) resetApproachRuntime();
        const activeCue = selectActiveCue(mainCues, mainProgress.progressMeters);
        const acquisitionEvent = recoveredFromOffRoute
          ? { kind: "acquired", acquisition: "reacquired" }
          : joinedFromOwnedApproach
          ? { kind: "acquired", acquisition: "join-route" }
          : enteredEffectiveRoute
          ? { kind: "acquired", acquisition: "initial" }
          : null;
        const wrongWayNow = mainProgress.wrongWay === true;
        const wrongWayStarted = wrongWayNow && !wasWrongWay;
        const cueEvent = acquisitionEvent ||
          (wrongWayStarted ? { kind: "wrong-way" } : cueFor(activeCue));
        // If acquisition owns this fix, leave a simultaneous wrong-way rise
        // pending so the next fix can still announce it.
        wasWrongWay = acquisitionEvent && wrongWayStarted ? false : wrongWayNow;
        let cameraTransition = null;
        if (joinedFromOwnedApproach || recoveredFromOffRoute) {
          cameraTransitionSeq += 1;
          const durationMs = 1200;
          const startedAt = Number.isFinite(Number(action.fix?.timestamp))
            ? Number(action.fix.timestamp)
            : 0;
          cameraTransition = {
            id: `camera-transition-${cameraTransitionSeq}`,
            kind: joinedFromOwnedApproach ? "join" : "reacquire",
            durationMs,
            startedAt,
            expiresAt: startedAt + durationMs,
            sourceGeometry: Array.isArray(state.approach.suggestionGeometry)
              ? state.approach.suggestionGeometry
              : null,
            sourceTier: state.approach.ownershipTier || null,
            sourceBearing: Number.isFinite(
              state.approach.approachProgress?.bearingToNextDeg,
            )
              ? state.approach.approachProgress.bearingToNextDeg
              : null,
            targetGeometry: navigationRoute?.geometry || null,
            targetProgressMeters: mainProgress.progressMeters,
          };
        }
        wasOffRoute = false;
        rejoinAnnounced = false;
        return set({
          status: "navigating",
          progress: mainProgress,
          activeCue,
          offRoute: false,
          cueEvent,
          justAcquired: enteredEffectiveRoute || recoveredFromOffRoute,
          approach: acquiredApproach ? emptyApproach() : state.approach,
          routeRequest: null,
          connectorResult: null,
          cameraTransition,
          arrival: arrivalDetectedAt === null ? null : { detectedAt: arrivalDetectedAt },
        });
      }

      case NAV_ACTIONS.CONNECTOR_READY: {
        if (
          state.status === "paused" ||
          state.approach.suggestionStatus !== "requesting" ||
          action.requestId !== state.routeRequest?.requestId
        ) {
          return state;
        }
        const connectorResult = connectorResultFromAction(action);
        const geometry = buildNavigationGeometry(connectorResult.geometry);
        if (geometry.length < 2) {
          if (state.routeRequest?.targetMode !== "rejoin") {
            return set({
              approach: {
                ...state.approach,
                ...tooFarApproachPatch("invalid-geometry"),
              },
              routeRequest: null,
              connectorResult: {
                requestId: action.requestId,
                result: "failed",
                reason: "invalid-geometry",
                attempt: state.routeRequest?.attempt ?? null,
                isRetry: state.routeRequest?.isRetry === true,
                targetMode: state.routeRequest?.targetMode ?? null,
                durationMs: Number.isFinite(Number(action.durationMs))
                  ? Number(action.durationMs)
                  : null,
              },
            });
          }
          return set({
            approach: failedSuggestionPatch(),
            routeRequest: null,
            connectorResult: {
              requestId: action.requestId,
              result: "failed",
              reason: "invalid-geometry",
              attempt: state.routeRequest?.attempt ?? null,
              isRetry: state.routeRequest?.isRetry === true,
              targetMode: state.routeRequest?.targetMode ?? null,
              durationMs: Number.isFinite(Number(action.durationMs))
                ? Number(action.durationMs)
                : null,
            },
          });
        }
        const distanceMeters = Number(connectorResult.distanceMeters);
        if (state.routeRequest?.targetMode !== "rejoin") {
          const features = computeConnectorFeatures(connectorResult, {
            origin: state.routeRequest.from,
            routeStart: state.routeRequest.to,
          });
          let classification = classifyConnector(features, connectorThresholds);
          let approachLeg = null;
          if (classification.tier === "guide") {
            approachLeg = buildApproachLeg(connectorResult, {
              id: `${navigationRoute?.id || "route"}:approach:${action.requestId}`,
              target: state.approach.target?.point || state.routeRequest.to,
            });
            if (!approachLeg) {
              classification = {
                tier: "too-far",
                handoffSuggested: true,
                reasons: ["invalid-geometry"],
              };
            }
          }

          let approachProgress = null;
          let approachActiveCue = null;
          if (classification.tier === "guide" && approachLeg) {
            approachTracker = createRouteProgressTracker(approachLeg.route, options);
            // The connector endpoint is the main-route seam, not the rider's
            // destination. Acquisition emits the single join-route message.
            approachCues = buildRouteCues(approachLeg.route, {
              includeArrival: false,
            });
            approachCueKey = null;
            if (state.latestFix) {
              approachProgress = approachTracker.update(state.latestFix);
              approachActiveCue = selectActiveCue(
                approachCues,
                approachProgress.progressMeters,
              );
            }
          } else {
            resetApproachRuntime();
          }

          const tier = classification.tier;
          const showConnectorLeg = tier === "guide";
          const legGeometry = approachLeg?.geometry || geometry;
          return set({
            approach: {
              ...state.approach,
              suggestionStatus: showConnectorLeg ? "ready" : "idle",
              suggestionGeometry: showConnectorLeg ? legGeometry : null,
              suggestionDistanceMeters:
                Number.isFinite(distanceMeters) && distanceMeters > 0
                  ? distanceMeters
                  : null,
              ownershipTier: tier,
              ownershipResolving: false,
              ownershipRefreshing: false,
              handoffSuggested: classification.handoffSuggested,
              handoffProminence: handoffProminence(tier),
              classificationReasons: classification.reasons,
              connectorFeatures: features,
              approachProgress,
              approachActiveCue,
              approachLegGeometry: tier === "guide" ? legGeometry : null,
            },
            routeRequest: null,
            connectorResult: {
              requestId: action.requestId,
              result: "ready",
              reason: null,
              attempt: state.routeRequest?.attempt ?? null,
              isRetry: state.routeRequest?.isRetry === true,
              targetMode: state.routeRequest?.targetMode ?? null,
              durationMs: Number.isFinite(Number(action.durationMs))
                ? Number(action.durationMs)
                : null,
              distanceMeters:
                Number.isFinite(distanceMeters) && distanceMeters > 0
                  ? distanceMeters
                  : null,
              ownershipTier: tier,
              classificationReasons: classification.reasons,
            },
          });
        }
        let rejoinCueEvent = null;
        if (
          state.status === "off-route" &&
          state.routeRequest?.targetMode === "rejoin" &&
          !rejoinAnnounced
        ) {
          rejoinAnnounced = true;
          rejoinCueEvent = {
            kind: "rejoin-ready",
            distanceMeters:
              Number.isFinite(distanceMeters) && distanceMeters > 0
                ? distanceMeters
                : null,
            bearingDeg:
              state.latestFix && state.routeRequest?.to
                ? computeBearing(state.latestFix, state.routeRequest.to)
                : null,
          };
        }
        return set({
          approach: {
            ...state.approach,
            suggestionStatus: "ready",
            ownershipResolving: false,
            ownershipRefreshing: false,
            suggestionGeometry: geometry,
            suggestionDistanceMeters:
              Number.isFinite(distanceMeters) && distanceMeters > 0
                ? distanceMeters
                : null,
          },
          routeRequest: null,
          cueEvent: rejoinCueEvent,
          connectorResult: {
            requestId: action.requestId,
            result: "ready",
            reason: null,
            attempt: state.routeRequest?.attempt ?? null,
            isRetry: state.routeRequest?.isRetry === true,
            targetMode: state.routeRequest?.targetMode ?? null,
            durationMs: Number.isFinite(Number(action.durationMs))
              ? Number(action.durationMs)
              : null,
            distanceMeters:
              Number.isFinite(distanceMeters) && distanceMeters > 0
                ? distanceMeters
                : null,
          },
        });
      }

      case NAV_ACTIONS.CONNECTOR_FAILED:
        if (
          state.status === "paused" ||
          state.approach.suggestionStatus !== "requesting" ||
          action.requestId !== state.routeRequest?.requestId
        ) {
          return state;
        }
        if (state.routeRequest?.targetMode !== "rejoin") {
          const retainedTier = state.approach.ownershipTier;
          const retainAccepted =
            retainedTier !== "unknown" &&
            (retainedTier === "too-far" ||
              (Array.isArray(state.approach.suggestionGeometry) &&
                state.approach.suggestionGeometry.length >= 2));
          if (retainAccepted) {
            return set({
              approach: {
                ...state.approach,
                suggestionStatus:
                  retainedTier === "too-far" ? "idle" : "ready",
                ownershipResolving: false,
                ownershipRefreshing: false,
              },
              routeRequest: null,
              connectorResult: {
                requestId: action.requestId,
                result: "failed",
                reason: action.reason || "unknown",
                attempt: state.routeRequest?.attempt ?? null,
                isRetry: state.routeRequest?.isRetry === true,
                targetMode: state.routeRequest?.targetMode ?? null,
                durationMs: Number.isFinite(Number(action.durationMs))
                  ? Number(action.durationMs)
                  : null,
              },
            });
          }
          return set({
            approach: {
              ...state.approach,
              ...tooFarApproachPatch(action.reason || "connector-failed"),
            },
            routeRequest: null,
            connectorResult: {
              requestId: action.requestId,
              result: "failed",
              reason: action.reason || "unknown",
              attempt: state.routeRequest?.attempt ?? null,
              isRetry: state.routeRequest?.isRetry === true,
              targetMode: state.routeRequest?.targetMode ?? null,
              durationMs: Number.isFinite(Number(action.durationMs))
                ? Number(action.durationMs)
                : null,
            },
          });
        }
        return set({
          approach: failedSuggestionPatch(),
          routeRequest: null,
          connectorResult: {
            requestId: action.requestId,
            result: "failed",
            reason: action.reason || "unknown",
            attempt: state.routeRequest?.attempt ?? null,
            isRetry: state.routeRequest?.isRetry === true,
            targetMode: state.routeRequest?.targetMode ?? null,
            durationMs: Number.isFinite(Number(action.durationMs))
              ? Number(action.durationMs)
              : null,
          },
        });

      case NAV_ACTIONS.PERMISSION_DENIED:
        return set({
          status: "error",
          error: "location-permission-denied",
          justAcquired: false,
        });

      case NAV_ACTIONS.PAUSE:
        if (!ACTIVE.has(state.status)) return state;
        prePauseStatus = state.status;
        return set({ status: "paused" });

      case NAV_ACTIONS.RESUME:
        return state.status === "paused" ? set({ status: prePauseStatus }) : state;

      case NAV_ACTIONS.RECENTER:
        lastUserPanAt = null;
        return set({ cameraIntent: "follow" });

      case NAV_ACTIONS.USER_PANNED: {
        const timestamp = Number(action.timestamp);
        lastUserPanAt = Number.isFinite(timestamp)
          ? timestamp
          : Number.isFinite(Number(state.latestFix?.timestamp))
            ? Number(state.latestFix.timestamp)
            : null;
        return set({ cameraIntent: "free" });
      }

      case NAV_ACTIONS.BACKGROUND_UNAVAILABLE:
        return set({ backgroundLocation: false, foregroundOnly: true });

      case NAV_ACTIONS.STOP:
        requestSeq += 1;
        resetApproachRuntime();
        lastRequestPos = null;
        connectorRequestAttempt = 0;
        arrivalDetectedAt = null;
        arrivalFixCount = 0;
        return set({
          status: "ended",
          endReason: "user",
          arrival: null,
          approach: emptyApproach(),
          routeRequest: null,
          connectorResult: null,
          cameraTransition: null,
          justAcquired: false,
        });

      case NAV_ACTIONS.ERROR:
        requestSeq += 1;
        resetApproachRuntime();
        lastRequestPos = null;
        connectorRequestAttempt = 0;
        return set({
          status: "error",
          approach: emptyApproach(),
          routeRequest: null,
          connectorResult: null,
          cameraTransition: null,
          error: action.message || "navigation-error",
          justAcquired: false,
        });

      default:
        return state;
    }
  }

  return {
    getState: () => state,
    snapshot: () => ({
      version: 1,
      state: { ...state, cueEvent: null, route: null, cameraTransition: null },
      tracker: mainTracker.snapshot(),
      mainCueKey,
      wasOffRoute,
      wasWrongWay,
      rejoinAnnounced,
      lastConfirmedProgressMeters,
      lastRequestPos,
      connectorRequestAttempt,
      requestSeq,
      cameraTransitionSeq,
      prePauseStatus,
      lastUserPanAt,
      arrivalDetectedAt,
      arrivalFixCount,
    }),
    dispatch,
  };
}
