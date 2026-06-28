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
  const near = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.6, accuracy: 8, speed: 4, timestamp: 4000 },
  });
  assert.equal(near.status, "navigating", "reaching the route -> navigating");
}

console.log("navigation session lifecycle tests passed");
console.log("navigation session location tests passed");
