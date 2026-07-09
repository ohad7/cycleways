import assert from "node:assert/strict";
import { navigationRouteFromRouteState } from "@cycleways/core/navigation/navigationRoute.js";
import {
  NAV_ACTIONS,
  createNavigationSession,
} from "@cycleways/core/navigation/navigationSession.js";

function straightRoute() {
  return navigationRouteFromRouteState(
    {
      points: [
        { id: "start", lat: 33.1, lng: 35.6 },
        { id: "end", lat: 33.1, lng: 35.61 },
      ],
      selectedSegments: [],
      geometry: [
        { lat: 33.1, lng: 35.6 },
        { lat: 33.1, lng: 35.605 },
        { lat: 33.1, lng: 35.61 },
      ],
      distance: 931.5,
    },
    { param: "session-token" },
  );
}

// --- Lifecycle: idle -> permission -> navigating -> ended -----------------
{
  const route = straightRoute();
  const session = createNavigationSession(route);

  assert.equal(session.getState().status, "idle", "starts idle");
  assert.equal(session.getState().route, route, "holds the navigation route");
  assert.equal(session.getState().cameraIntent, "follow", "default camera follows");

  const requesting = session.dispatch({ type: NAV_ACTIONS.START });
  assert.equal(requesting.status, "requesting-permission", "START asks permission");

  const navigating = session.dispatch({
    type: NAV_ACTIONS.PERMISSION_GRANTED,
    background: true,
  });
  assert.equal(navigating.status, "navigating", "granted permission -> navigating");
  assert.equal(navigating.backgroundLocation, true, "background permission recorded");
  assert.equal(navigating.foregroundOnly, false);

  const ended = session.dispatch({ type: NAV_ACTIONS.STOP });
  assert.equal(ended.status, "ended", "STOP ends the session");
  assert.equal(ended.route, route, "route is preserved across stop (planner intact)");
}

// --- Foreground-only permission -------------------------------------------
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  const nav = session.dispatch({
    type: NAV_ACTIONS.PERMISSION_GRANTED,
    background: false,
  });
  assert.equal(nav.status, "navigating", "foreground-only still navigates");
  assert.equal(nav.foregroundOnly, true, "flagged foreground-only");
  assert.equal(nav.backgroundLocation, false);
}

// --- Permission denied is an error state ----------------------------------
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  const denied = session.dispatch({ type: NAV_ACTIONS.PERMISSION_DENIED });
  assert.equal(denied.status, "error", "denied permission -> error");
  assert.ok(denied.error, "error message present");
}

// --- A non-navigable route cannot start -----------------------------------
{
  const broken = navigationRouteFromRouteState(
    { points: [], geometry: [], distance: 0 },
    { param: "" },
  );
  assert.equal(broken.canNavigate, false);
  const session = createNavigationSession(broken);
  const started = session.dispatch({ type: NAV_ACTIONS.START });
  assert.equal(started.status, "error", "non-navigable route -> error, not navigating");
}

// --- Pause / resume and camera intent -------------------------------------
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: true });

  assert.equal(session.dispatch({ type: NAV_ACTIONS.PAUSE }).status, "paused");
  assert.equal(session.dispatch({ type: NAV_ACTIONS.RESUME }).status, "navigating");

  assert.equal(
    session.dispatch({ type: NAV_ACTIONS.USER_PANNED }).cameraIntent,
    "free",
    "user pan frees the camera",
  );
  assert.equal(
    session.dispatch({ type: NAV_ACTIONS.RECENTER }).cameraIntent,
    "follow",
    "recenter re-follows",
  );
}

function navigatingSession() {
  const session = createNavigationSession(straightRoute(), {
    confirmMs: 4000,
    recoverMs: 3000,
  });
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: true });
  return session;
}

const fix = (lng, timestamp, extra = {}) => ({
  lat: 33.1,
  lng,
  accuracy: 5,
  speed: 3,
  timestamp,
  ...extra,
});

// --- LOCATION drives progress; ignored when not active --------------------
{
  const session = navigatingSession();
  const s = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.6, 1000) });
  assert.equal(s.status, "navigating");
  assert.ok(s.progress && s.progress.progressMeters < 2, "progress computed from the fix");
  assert.equal(s.activeCue, null, "no active cue far from the end");

  // Ignored when idle.
  const idle = createNavigationSession(straightRoute());
  const after = idle.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.605, 1000) });
  assert.equal(after.status, "idle", "LOCATION ignored while idle");
  assert.equal(after.progress, null, "no progress while idle");

  // Ignored while paused.
  session.dispatch({ type: NAV_ACTIONS.PAUSE });
  const paused = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.605, 2000) });
  assert.equal(paused.status, "paused", "LOCATION ignored while paused");
}

// --- Active cue + cue-event dedupe ----------------------------------------
{
  const session = navigatingSession();
  // Approaching the end (arrive cue) within preview range.
  const preview = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.609, 1000) });
  assert.equal(preview.activeCue.cue.type, "arrive", "arrive cue is active");
  assert.equal(preview.activeCue.phase, "preview");
  assert.ok(preview.cueEvent, "cue event emitted on first preview");
  assert.equal(preview.cueEvent.kind, "cue");

  // Same cue + phase on the next fix -> no duplicate event.
  const same = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.6091, 2000) });
  assert.ok(same.activeCue, "cue still active");
  assert.equal(same.cueEvent, null, "no duplicate cue event for the same cue/phase");

  // Crossing into the final window re-emits.
  const final = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.6098, 3000) });
  assert.equal(final.activeCue.phase, "final", "phase advanced to final");
  assert.ok(final.cueEvent, "phase change re-emits a cue event");
}

// --- Off-route status + single off-route event ----------------------------
{
  const session = navigatingSession();
  const off = (timestamp) => fix(35.605, timestamp, { lat: 33.101 }); // ~111 m north

  // Acquire the route first with an on-route fix, then drift off.
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.605, 500) });

  const candidate = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: off(1000) });
  assert.equal(candidate.status, "navigating", "single far fix is not yet off-route");

  const confirmed = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: off(6000) });
  assert.equal(confirmed.status, "off-route", "sustained far fix -> off-route status");
  assert.equal(confirmed.offRoute, true);
  assert.ok(confirmed.cueEvent && confirmed.cueEvent.kind === "off-route", "off-route event on entry");

  const stillOff = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: off(7000) });
  assert.equal(stillOff.cueEvent, null, "off-route event not repeated while still off");

  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.605, 8000) });
  const recovered = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.6051, 12000) });
  assert.equal(recovered.status, "navigating", "sustained on-route fixes recover");
  assert.equal(recovered.cueEvent?.kind, "acquired", "recovery emits acquired event");
  assert.equal(recovered.cueEvent?.acquisition, "reacquired");
  assert.equal(recovered.cameraTransition?.kind, "reacquire");

  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: off(13000) });
  const secondOff = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: off(18000) });
  assert.equal(secondOff.status, "off-route", "can enter off-route again after recovery");
  assert.equal(secondOff.cueEvent?.kind, "off-route", "second off-route transition emits");
}

// --- approaching status ---
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  const far = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.105, lng: 35.6, accuracy: 8, speed: 4, timestamp: 1000 },
  });
  assert.equal(far.status, "approaching", "far fix -> approaching");
  assert.equal(far.activeCue, null, "no cues while approaching");
  assert.equal(far.cueEvent, null, "no cue events while approaching");
  assert.equal(
    far.approach.suggestionStatus,
    "requesting",
    "pre-route approach requests a connector suggestion",
  );
  assert.equal(far.approach.suggestionGeometry, null);
  assert.equal(far.routeRequest?.targetMode, "start", "approach request targets the start");
  const near = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.6, accuracy: 8, speed: 4, timestamp: 4000 },
  });
  assert.equal(near.status, "navigating", "reaching the route -> navigating");
  assert.equal(near.justAcquired, true, "approach handoff is explicit for one render");
  assert.equal(near.cueEvent?.kind, "acquired");
  assert.equal(near.cueEvent?.acquisition, "initial");
}

function approachRequestedSession(fixOverride = {}) {
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  const requested = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: {
      lat: 33.101,
      lng: 35.6,
      accuracy: 5,
      speed: 3,
      timestamp: 1000,
      ...fixOverride,
    },
  });
  assert.equal(requested.status, "approaching");
  assert.equal(requested.routeRequest?.targetMode, "start");
  return { session, requested };
}

function connectorResult(points, distanceMeters = null, routeClass = "road") {
  return {
    failure: null,
    geometry: points,
    distanceMeters,
    edgeCosts: [
      {
        routeClass,
        roadType: routeClass === "road" ? "road" : null,
        cyclewaysSegmentIds: [],
        distanceMeters: distanceMeters ?? 100,
      },
    ],
  };
}

// --- pre-route too-far short-circuits connector ownership ------------------
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  const far = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.3, lng: 35.6, accuracy: 5, speed: 3, timestamp: 1000 },
  });
  assert.equal(far.status, "approaching");
  assert.equal(far.approach.ownershipTier, "too-far");
  assert.equal(far.approach.handoffProminence, "primary");
  assert.equal(far.routeRequest, null);
}

// --- guide tier: connector leg is narrated until seam acquisition ----------
{
  const { session, requested } = approachRequestedSession();
  const request = requested.routeRequest;
  const ready = session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_READY,
    requestId: request.requestId,
    connectorResult: connectorResult(
      [
        request.from,
        { lat: 33.101, lng: 35.6005 },
        { lat: 33.1, lng: 35.6005 },
        request.to,
      ],
      205,
    ),
  });
  assert.equal(ready.approach.ownershipTier, "guide");
  assert.equal(ready.approach.handoffProminence, "hidden");
  assert.equal(ready.approach.suggestionStatus, "ready");
  assert.ok(ready.approach.approachLegGeometry.length >= 2);
  assert.ok(ready.approach.connectorFeatures.snapOk);

  const cue = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.101, lng: 35.6, accuracy: 5, speed: 3, timestamp: 2000 },
  });
  assert.equal(cue.status, "approaching");
  assert.equal(cue.approach.approachActiveCue?.cue.type, "turn");
  assert.equal(cue.cueEvent?.kind, "cue");
  assert.equal(cue.cueEvent?.leg, "approach");

  const joined = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.6, accuracy: 5, speed: 3, timestamp: 3000 },
  });
  assert.equal(joined.status, "navigating");
  assert.equal(joined.cueEvent?.kind, "acquired");
  assert.equal(joined.cueEvent?.acquisition, "join-route");
  assert.equal(joined.approach.target, null);
  assert.equal(joined.cameraTransition?.kind, "join");
  assert.ok(joined.cameraTransition.sourceGeometry.length >= 2);
  const afterJoin = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.6002, accuracy: 5, speed: 3, timestamp: 5000 },
  });
  assert.equal(afterJoin.cameraTransition, null, "join snapshot expires after its window");
}

// --- show-leg tier: connector is visual-only -------------------------------
{
  const { session, requested } = approachRequestedSession();
  const request = requested.routeRequest;
  const ready = session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_READY,
    requestId: request.requestId,
    connectorResult: connectorResult([request.from, request.to], 500, "path_track"),
  });
  assert.equal(ready.approach.ownershipTier, "show-leg");
  assert.equal(ready.approach.handoffProminence, "secondary");
  assert.equal(ready.approach.suggestionStatus, "ready");
  assert.equal(ready.approach.approachActiveCue, null);
  assert.ok(ready.approach.classificationReasons.includes("class-too-low"));
  const later = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1008, lng: 35.6, accuracy: 5, speed: 3, timestamp: 2000 },
  });
  assert.equal(later.cueEvent, null, "show-leg approach does not narrate connector cues");
  assert.equal(later.routeRequest, null, "small movement does not refresh show-leg");
  const refreshed = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.103, lng: 35.6, accuracy: 5, speed: 3, timestamp: 4000 },
  });
  assert.equal(refreshed.approach.suggestionStatus, "requesting");
  assert.ok(refreshed.routeRequest.requestId > request.requestId);
  assert.equal(refreshed.routeRequest.purpose, "refresh");
  assert.equal(
    refreshed.approach.ownershipTier,
    "show-leg",
    "accepted ownership remains authoritative while refreshing",
  );
  assert.equal(refreshed.approach.ownershipRefreshing, true);
  assert.ok(refreshed.approach.suggestionGeometry.length >= 2);
  const retainedAfterFailure = session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_FAILED,
    requestId: refreshed.routeRequest.requestId,
    reason: "transient",
  });
  assert.equal(retainedAfterFailure.approach.ownershipTier, "show-leg");
  assert.equal(retainedAfterFailure.approach.suggestionStatus, "ready");
  assert.equal(retainedAfterFailure.approach.ownershipRefreshing, false);
  assert.ok(retainedAfterFailure.approach.suggestionGeometry.length >= 2);
}

// --- start connector failure becomes too-far / handoff-primary -------------
{
  const { session, requested } = approachRequestedSession();
  const failed = session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_FAILED,
    requestId: requested.routeRequest.requestId,
    reason: "no-path",
  });
  assert.equal(failed.status, "approaching");
  assert.equal(failed.approach.ownershipTier, "too-far");
  assert.equal(failed.approach.handoffProminence, "primary");
  assert.equal(failed.approach.suggestionGeometry, null);
}

function offRouteRequestedSession() {
  const session = navigatingSession();
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.605, 500) });
  const off = (timestamp) => fix(35.605, timestamp, { lat: 33.101 });
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: off(1000) });
  const requested = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: off(6000) });
  return { session, requested };
}

// --- rejoin slot: suggestion is orthogonal to recovery --------------------
{
  const { session: s } = offRouteRequestedSession();
  let st = s.getState();
  assert.equal(st.status, "off-route");
  assert.equal(st.approach.target.mode, "rejoin");
  assert.equal(st.approach.suggestionStatus, "requesting");
  assert.ok(st.routeRequest && st.routeRequest.to);
  assert.ok(Number.isFinite(st.approach.distanceToRouteMeters));

  s.dispatch({
    type: NAV_ACTIONS.CONNECTOR_READY,
    requestId: st.routeRequest.requestId,
    geometry: [
      { lat: 33.101, lng: 35.605 },
      { lat: 33.1, lng: 35.605 },
    ],
    distanceMeters: 800,
    snappedEndpoints: [],
  });
  st = s.getState();
  assert.equal(st.status, "off-route", "READY never changes status");
  assert.equal(st.approach.suggestionStatus, "ready");
  assert.ok(st.approach.suggestionGeometry.length >= 2);
  assert.equal(st.approach.suggestionDistanceMeters, 800);
  assert.equal(st.routeRequest, null, "completed connector request is cleared");

  s.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.605, 8000) });
  st = s.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.6051, 12000) });
  assert.equal(st.status, "navigating", "physical recovery is the only handoff");
}

// --- a long / over-cap suggestion is allowed (no distance-cap rejection) ---
{
  const { session, requested } = offRouteRequestedSession();
  const ready = session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_READY,
    requestId: requested.routeRequest.requestId,
    geometry: [{ lat: 33.105, lng: 35.6 }, { lat: 33.1, lng: 35.6 }],
    distanceMeters: 9000,
  });
  assert.equal(ready.status, "off-route");
  assert.equal(
    ready.approach.suggestionStatus,
    "ready",
    "a long suggestion across a barrier is not cap-rejected",
  );
}

// --- an invalid (single-point) suggestion geometry fails -------------------
{
  const { session, requested } = offRouteRequestedSession();
  const ready = session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_READY,
    requestId: requested.routeRequest.requestId,
    geometry: [{ lat: 33.105, lng: 35.6 }],
    distanceMeters: 100,
  });
  assert.equal(ready.status, "off-route");
  assert.equal(ready.approach.suggestionStatus, "failed");
  assert.equal(ready.approach.suggestionGeometry, null);
  assert.equal(ready.routeRequest, null);
}

// --- CONNECTOR_FAILED keeps status off-route; direct line survives ---------
{
  const { session, requested } = offRouteRequestedSession();
  const before = requested.approach.distanceToRouteMeters;
  const failed = session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_FAILED,
    requestId: requested.routeRequest.requestId,
    reason: "transient",
  });
  assert.equal(failed.status, "off-route");
  assert.equal(failed.approach.suggestionStatus, "failed");
  assert.equal(failed.approach.suggestionGeometry, null);
  assert.equal(failed.routeRequest, null);
  assert.equal(
    failed.approach.distanceToRouteMeters,
    before,
    "the direct-line distance survives a failed suggestion",
  );
}

// --- stale and paused suggestion results are ignored -----------------------
{
  const { session, requested } = offRouteRequestedSession();
  const requestId = requested.routeRequest.requestId;
  const stale = session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_READY,
    requestId: requestId + 5,
    geometry: [{ lat: 33.105, lng: 35.6 }, { lat: 33.1, lng: 35.6 }],
    distanceMeters: 500,
  });
  assert.equal(stale.approach.suggestionStatus, "requesting", "stale result ignored");

  assert.equal(session.dispatch({ type: NAV_ACTIONS.PAUSE }).status, "paused");
  const whilePaused = session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_READY,
    requestId,
    geometry: [{ lat: 33.105, lng: 35.6 }, { lat: 33.1, lng: 35.6 }],
    distanceMeters: 500,
  });
  assert.equal(whilePaused.approach.suggestionStatus, "requesting", "result ignored while paused");
  assert.equal(
    session.dispatch({ type: NAV_ACTIONS.RESUME }).status,
    "off-route",
    "RESUME restores the pre-pause status",
  );
  assert.ok(session.getState().approach.target, "approach slot persists across pause");
}

// --- CONNECTOR_FAILED retries only after meaningful movement ---------------
{
  const { session, requested } = offRouteRequestedSession();
  session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_FAILED,
    requestId: requested.routeRequest.requestId,
    reason: "transient",
  });
  let st = session.getState();
  assert.equal(st.approach.suggestionStatus, "failed");
  assert.equal(st.approach.suggestionGeometry, null);
  const belowGate = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { ...requested.latestFix, lat: 33.1012, timestamp: 7000 },
  });
  assert.equal(belowGate.approach.suggestionStatus, "failed");
  assert.equal(belowGate.routeRequest, null);
  const refetch = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { ...requested.latestFix, lat: 33.102, timestamp: 9000 },
  });
  assert.equal(refetch.approach.suggestionStatus, "requesting");
  assert.ok(refetch.routeRequest.requestId > requested.routeRequest.requestId);
}

// --- STOP clears the approach slot and route request -----------------------
{
  const { session } = offRouteRequestedSession();
  const ended = session.dispatch({ type: NAV_ACTIONS.STOP });
  assert.equal(ended.status, "ended");
  assert.equal(ended.approach.target, null);
  assert.equal(ended.routeRequest, null);
}

// --- acquired then off-route: rejoin suggestion, no on-connector -----------
{
  const session = createNavigationSession(straightRoute(), {
    confirmMs: 4000,
    recoverMs: 3000,
  });
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  // Acquire the route.
  session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.605, accuracy: 5, speed: 3, timestamp: 500 },
  });
  const off = (timestamp) => ({ lat: 33.101, lng: 35.605, accuracy: 5, speed: 3, timestamp });
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: off(1000) });
  const confirmed = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: off(6000) });
  assert.equal(confirmed.status, "off-route");
  assert.ok(confirmed.cueEvent && confirmed.cueEvent.kind === "off-route", "off-route event on entry");
  assert.equal(confirmed.approach.target.mode, "rejoin", "off-route drives a rejoin suggestion");
  assert.equal(confirmed.approach.suggestionStatus, "requesting");
  assert.ok(confirmed.routeRequest && confirmed.routeRequest.to);
  const firstRequest = confirmed.routeRequest;
  const ready = session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_READY,
    requestId: firstRequest.requestId,
    geometry: [firstRequest.from, firstRequest.to],
    distanceMeters: 350,
  });
  assert.equal(ready.approach.suggestionStatus, "ready");
  assert.ok(ready.approach.suggestionGeometry.length >= 2);
  assert.equal(ready.routeRequest, null);
  const stillOff = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: off(7000) });
  assert.equal(stillOff.status, "off-route");
  assert.equal(stillOff.cueEvent, null, "off-route event not repeated while still off");
  assert.equal(stillOff.routeRequest, null);
  const movedOff = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.103, lng: 35.605, accuracy: 5, speed: 3, timestamp: 11000 },
  });
  assert.equal(movedOff.status, "off-route");
  assert.equal(movedOff.approach.suggestionStatus, "requesting");
  assert.ok(movedOff.routeRequest.requestId > firstRequest.requestId);
  assert.ok(
    movedOff.approach.suggestionGeometry.length >= 2,
    "old rejoin suggestion stays visible while refreshing",
  );
}

// --- no state is ever "on-connector" ---------------------------------------
{
  const fixes = [
    { lat: 33.105, lng: 35.6, accuracy: 8, speed: 4, timestamp: 1000 },
    { lat: 33.1025, lng: 35.6, accuracy: 5, speed: 4, timestamp: 4000 },
    { lat: 33.1, lng: 35.6, accuracy: 5, speed: 4, timestamp: 7000 },
    { lat: 33.1, lng: 35.605, accuracy: 5, speed: 4, timestamp: 10000 },
  ];
  const s = createNavigationSession(straightRoute());
  s.dispatch({ type: NAV_ACTIONS.START });
  s.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED });
  for (const fix of fixes) {
    const st = s.dispatch({ type: NAV_ACTIONS.LOCATION, fix });
    assert.notEqual(st.status, "on-connector", "no on-connector status anywhere");
  }
  assert.equal(s.getState().status, "navigating", "physically reaching the route navigates");
}

// --- rideStartTimestamp: first fix of the session -------------------------
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  let state = session.dispatch({
    type: NAV_ACTIONS.PERMISSION_GRANTED,
    background: false,
  });
  assert.equal(state.rideStartTimestamp, null, "null before the first fix");
  state = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.6, accuracy: 5, speed: 4, timestamp: 7000 },
  });
  assert.equal(state.rideStartTimestamp, 7000, "set from the first fix");
  state = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.6005, accuracy: 5, speed: 4, timestamp: 9000 },
  });
  assert.equal(state.rideStartTimestamp, 7000, "unchanged by later fixes");

  session.dispatch({ type: NAV_ACTIONS.STOP });
  session.dispatch({ type: NAV_ACTIONS.START });
  state = session.dispatch({
    type: NAV_ACTIONS.PERMISSION_GRANTED,
    background: false,
  });
  assert.equal(state.rideStartTimestamp, null, "reset before the next ride");
  state = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.6, accuracy: 5, speed: 4, timestamp: 12000 },
  });
  assert.equal(state.rideStartTimestamp, 12000, "second ride gets its own start");
}

// --- snapshot / restore preserves cue and off-route transition memory -----
{
  const route = straightRoute();
  const uninterrupted = createNavigationSession(route, {
    confirmMs: 4000,
    recoverMs: 3000,
  });
  uninterrupted.dispatch({ type: NAV_ACTIONS.START });
  uninterrupted.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: true });
  const previewFix = fix(35.609, 1000);
  const samePreviewFix = fix(35.6091, 2000);
  const finalFix = fix(35.6098, 3000);
  uninterrupted.dispatch({ type: NAV_ACTIONS.LOCATION, fix: previewFix });
  const snapshot = uninterrupted.snapshot();

  const restored = createNavigationSession(route, {
    confirmMs: 4000,
    recoverMs: 3000,
    snapshot,
  });
  const samePreview = restored.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: samePreviewFix,
  });
  assert.equal(
    samePreview.cueEvent,
    null,
    "restored session does not repeat already-emitted preview cue",
  );
  const restoredFinal = restored.dispatch({ type: NAV_ACTIONS.LOCATION, fix: finalFix });
  assert.equal(restoredFinal.cueEvent?.phase, "final", "phase change still emits");
  assert.equal(restoredFinal.rideStartTimestamp, 1000, "ride start survives restore");

  const offRoute = createNavigationSession(route, { confirmMs: 4000, recoverMs: 3000 });
  offRoute.dispatch({ type: NAV_ACTIONS.START });
  offRoute.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: true });
  offRoute.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.605, 500) });
  const offFix = { lat: 33.101, lng: 35.605, accuracy: 5, speed: 3, timestamp: 1000 };
  offRoute.dispatch({ type: NAV_ACTIONS.LOCATION, fix: offFix });
  const confirmedOffFix = { ...offFix, timestamp: 6000 };
  const firstOff = offRoute.dispatch({ type: NAV_ACTIONS.LOCATION, fix: confirmedOffFix });
  assert.equal(firstOff.cueEvent?.kind, "off-route");
  const restoredOff = createNavigationSession(route, {
    confirmMs: 4000,
    recoverMs: 3000,
    snapshot: offRoute.snapshot(),
  });
  const stillOff = restoredOff.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { ...confirmedOffFix, timestamp: 7000 },
  });
  assert.equal(stillOff.status, "off-route");
  assert.equal(stillOff.cueEvent, null, "off-route event is not re-fired after restore");
}

console.log("navigation session lifecycle tests passed");
console.log("navigation session location tests passed");
