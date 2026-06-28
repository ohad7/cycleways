import assert from "node:assert/strict";
import { navigationRouteFromRouteState } from "@cycleways/core/navigation/navigationRoute.js";
import {
  buildRouteCues,
  selectActiveCue,
} from "@cycleways/core/navigation/navigationCues.js";

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const findType = (cues, type) => cues.filter((c) => c.type === type);

function routeFrom(geometry, extra = {}) {
  return navigationRouteFromRouteState(
    {
      points: [
        { id: "start", lat: geometry[0].lat, lng: geometry[0].lng },
        {
          id: "end",
          lat: geometry[geometry.length - 1].lat,
          lng: geometry[geometry.length - 1].lng,
        },
      ],
      selectedSegments: [],
      geometry,
      ...extra,
    },
    { param: "cue-token" },
  );
}

// --- Start + arrive cues on a straight route ------------------------------
{
  const straight = routeFrom([
    { lat: 33.1, lng: 35.6 },
    { lat: 33.1, lng: 35.605 },
    { lat: 33.1, lng: 35.61 },
  ]);
  const cues = buildRouteCues(straight);

  const starts = findType(cues, "start");
  const arrives = findType(cues, "arrive");
  assert.equal(starts.length, 1, "exactly one start cue");
  assert.equal(arrives.length, 1, "exactly one arrive cue");
  assert.equal(starts[0].distanceMeters, 0, "start cue at 0 m");
  assert.ok(near(arrives[0].distanceMeters, 931.5, 2), "arrive cue at route end");
  assert.equal(findType(cues, "turn").length, 0, "no turns on a straight route");

  // Deterministic + sorted by distance.
  const again = buildRouteCues(straight);
  assert.deepEqual(again, cues, "cue list is deterministic");
  for (let i = 1; i < cues.length; i++) {
    assert.ok(
      cues[i].distanceMeters >= cues[i - 1].distanceMeters,
      "cues sorted by distance",
    );
  }
}

// --- Turn cue at an L-corner ----------------------------------------------
{
  const lRoute = routeFrom([
    { lat: 33.1, lng: 35.6 },
    { lat: 33.1, lng: 35.605 }, // corner (~466 m)
    { lat: 33.105, lng: 35.605 }, // turn north
  ]);
  const turns = findType(buildRouteCues(lRoute), "turn");
  assert.equal(turns.length, 1, "one turn cue at the corner");
  assert.ok(near(turns[0].distanceMeters, 465.8, 3), "turn at the corner distance");
  assert.equal(turns[0].direction, "left", "east-then-north is a left turn");
  assert.ok(near(turns[0].turnAngleDeg, 90, 5), "turn angle ~90");
}

// --- Hazard/POI cues from active data points ------------------------------
{
  const withHazard = routeFrom(
    [
      { lat: 33.1, lng: 35.6 },
      { lat: 33.1, lng: 35.605 },
      { lat: 33.1, lng: 35.61 },
    ],
    {
      activeDataPoints: [
        { id: "poi-1", type: "caution", segmentName: "Seg A", routeProgressMeters: 300 },
        { id: "poi-2", type: "viewpoint", routeProgressMeters: 9999 }, // off route -> dropped
        { id: "poi-3", type: "caution" }, // no progress -> dropped
      ],
    },
  );
  const hazards = buildRouteCues(withHazard).filter((c) => c.dataPointId);
  assert.equal(hazards.length, 1, "only the on-route hazard with progress becomes a cue");
  assert.equal(hazards[0].dataPointId, "poi-1");
  assert.equal(hazards[0].type, "caution");
  assert.equal(hazards[0].segmentName, "Seg A");
  assert.equal(hazards[0].distanceMeters, 300);
}

// --- selectActiveCue scheduling phases ------------------------------------
{
  const cues = [
    { type: "start", distanceMeters: 0 },
    { type: "turn", distanceMeters: 500, direction: "left" },
    { type: "arrive", distanceMeters: 1000 },
  ];

  // Far from the turn: no active cue yet (UI shows "continue on route").
  assert.equal(selectActiveCue(cues, 300), null, "no active cue beyond preview range");

  // Within preview range (~120 m before).
  const preview = selectActiveCue(cues, 400);
  assert.equal(preview.cue.type, "turn", "next upcoming cue is the turn");
  assert.equal(preview.phase, "preview", "100 m out is a preview");
  assert.ok(near(preview.distanceToCueMeters, 100, 0.01), "distance to cue");

  // Within final range (~25 m before).
  const final = selectActiveCue(cues, 475);
  assert.equal(final.phase, "final", "25 m out is a final cue");

  // Passed cues are not re-emitted.
  const afterTurn = selectActiveCue(cues, 520);
  assert.notEqual(afterTurn?.cue?.type, "turn", "passed turn is not re-selected");

  // The start cue is informational and never selected as a maneuver.
  assert.equal(selectActiveCue(cues, 0), null, "start cue is not an active maneuver");
}

// --- Short-segment suppression: close turns do not spam -------------------
{
  // Two ~90 deg turns ~11 m apart (below the min-spacing) -> only one cue.
  const zigzag = routeFrom([
    { lat: 33.1, lng: 35.6 },
    { lat: 33.1, lng: 35.6001 }, // ~9.3 m  (turn 1)
    { lat: 33.10010, lng: 35.6001 }, // ~20.4 m (turn 2, suppressed)
    { lat: 33.10010, lng: 35.6002 },
  ]);
  const turns = findType(buildRouteCues(zigzag), "turn");
  assert.equal(turns.length, 1, "close second turn is suppressed");
  assert.ok(near(turns[0].distanceMeters, 9.3, 2), "kept the first turn");
}

// --- enter-segment cues + merge ---
import { buildRouteCues as _brc } from "@cycleways/core/navigation/navigationCues.js";
{
  // Route whose sharp turn coincides with a new segment boundary.
  const route = {
    geometry: [
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 0 },
      { lat: 33.1, lng: 35.61, distanceFromStartMeters: 500 },
      { lat: 33.11, lng: 35.61, distanceFromStartMeters: 1000 }, // ~90° turn at 500m
    ],
    segmentSpans: [
      { startMeters: 0, endMeters: 500, name: "First", onNetwork: true, cwSegmentId: 1, routeClass: "cycleway" },
      { startMeters: 500, endMeters: 1000, name: "Second", onNetwork: true, cwSegmentId: 2, routeClass: "cycleway" },
    ],
    activeDataPoints: [],
  };
  const cues = _brc(route);
  const turn = cues.find((c) => c.type === "turn");
  assert.ok(turn, "turn cue exists at the bend");
  assert.equal(turn.ontoSegmentName, "Second", "turn merged with segment entry");
  assert.equal(
    cues.filter((c) => c.type === "enter-segment" && Math.abs(c.distanceMeters - 500) < 20).length,
    0,
    "standalone enter-segment near the turn is suppressed",
  );
}
{
  // Segment boundary with no nearby turn -> standalone enter-segment cue.
  const route = {
    geometry: [
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 0 },
      { lat: 33.1, lng: 35.62, distanceFromStartMeters: 1000 },
    ],
    segmentSpans: [
      { startMeters: 0, endMeters: 400, name: "A", onNetwork: true, cwSegmentId: 1, routeClass: "cycleway" },
      { startMeters: 400, endMeters: 1000, name: "B", onNetwork: true, cwSegmentId: 2, routeClass: "cycleway" },
    ],
    activeDataPoints: [],
  };
  const cues = _brc(route);
  assert.ok(cues.some((c) => c.type === "enter-segment" && c.segmentName === "B"),
    "standalone enter-segment cue for B");
}

console.log("navigation cue tests passed");
