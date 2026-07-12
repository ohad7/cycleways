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
  assert.equal(
    selectActiveCue(cues, arrives[0].distanceMeters - 201),
    null,
    "arrival preview does not start before 200 m",
  );
  const arrivalPreview = selectActiveCue(cues, arrives[0].distanceMeters - 200);
  assert.equal(arrivalPreview?.cue.type, "arrive");
  assert.equal(arrivalPreview?.phase, "preview");
  assert.ok(near(arrivalPreview?.distanceToCueMeters, 200, 0.01));
  assert.equal(findType(cues, "turn").length, 0, "no turns on a straight route");

  const seamCues = buildRouteCues(straight, { includeArrival: false });
  assert.equal(
    findType(seamCues, "arrive").length,
    0,
    "connector-style cue sets can omit destination arrival",
  );

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

// --- Junction-aware classification: turns at junctions, bends elsewhere ----
// With routeState.junctions provided (network nodes where 3+ edges meet):
// a sharp corner at a junction is a "turn"; a sharp corner in open road is a
// "bend" (only >= 75° — the road curving, no decision to make); a moderate
// road curve (40-75°, previously a false "turn") produces nothing.
{
  const geometry = [
    { lat: 33.1, lng: 35.6 },
    { lat: 33.1, lng: 35.605 }, // corner A (~466 m): 90° left, AT a junction
    { lat: 33.105, lng: 35.605 }, // corner B (~1022 m): 90° right, open road
    { lat: 33.105, lng: 35.61 },
    { lat: 33.105, lng: 35.612 }, // curve C (~1675 m): ~50°, open road
    { lat: 33.107, lng: 35.614 },
  ];
  const junctions = [{ lat: 33.1, lng: 35.605 }];

  const gated = buildRouteCues(routeFrom(geometry, { junctions }));
  const turns = findType(gated, "turn");
  const bends = findType(gated, "bend");
  assert.equal(turns.length, 1, "only the junction corner is a turn");
  assert.ok(near(turns[0].distanceMeters, 465.8, 3), "turn at corner A");
  assert.equal(turns[0].direction, "left");
  assert.equal(bends.length, 1, "the sharp open-road corner is a bend");
  assert.ok(near(bends[0].distanceMeters, 1022, 4), "bend at corner B");
  assert.equal(bends[0].direction, "right");
  assert.ok(near(bends[0].turnAngleDeg, 90, 5), "bend keeps its angle");

  // Without junction data the route keeps today's geometry-only behavior.
  const ungated = buildRouteCues(routeFrom(geometry));
  assert.equal(findType(ungated, "turn").length, 3, "fallback: all three cue as turns");
  assert.equal(findType(ungated, "bend").length, 0, "fallback: no bends");

  // A junction slightly off the corner (GPS/network offset) still gates in.
  const offset = buildRouteCues(
    routeFrom(geometry, { junctions: [{ lat: 33.10015, lng: 35.605 }] }), // ~17 m north
  );
  assert.equal(findType(offset, "turn").length, 1, "junction within 30 m still counts");

  // Span boundaries merge onto turns only — a bend never gets ontoSegmentName.
  const total = routeFrom(geometry).distanceMeters;
  const withSpans = buildRouteCues(
    routeFrom(geometry, {
      junctions,
      segmentSpans: [
        { startMeters: 0, endMeters: 1022, name: "דרך הפרדס" },
        { startMeters: 1022, endMeters: total, name: "שביל הצפון" },
      ],
    }),
  );
  const bendWithSpan = findType(withSpans, "bend")[0];
  assert.equal(bendWithSpan.ontoSegmentName, undefined, "no segment merge onto a bend");
  assert.equal(
    findType(withSpans, "enter-segment").length,
    1,
    "the span boundary at the bend stays its own enter-segment cue",
  );

  // A bend is selectable like any maneuver cue.
  const active = selectActiveCue(gated, 950);
  assert.equal(active.cue.type, "bend");
  assert.equal(active.phase, "preview");
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

// --- selectActiveCue: maneuvers outrank informational cues -----------------
{
  const cues = [
    { type: "caution", distanceMeters: 450, dataPointId: "hazard" },
    { type: "turn", distanceMeters: 470, direction: "left" },
  ];
  const active = selectActiveCue(cues, 400);
  assert.equal(active.cue.type, "turn", "upcoming maneuver masks nearer info cue");
  assert.equal(active.distanceToCueMeters, 70);

  const hazardOnly = selectActiveCue([cues[0]], 400);
  assert.equal(hazardOnly.cue.type, "caution", "hazard-only case still selects hazard");
}

// --- Short-segment suppression: close turns do not spam -------------------
{
  // Two ~90 deg turns ~9 m apart (below the hard noise floor) -> one cue.
  const zigzag = routeFrom([
    { lat: 33.1, lng: 35.6 },
    { lat: 33.1, lng: 35.6001 }, // ~9.3 m  (turn 1)
    { lat: 33.10008, lng: 35.6001 }, // ~18.2 m (turn 2, suppressed)
    { lat: 33.10008, lng: 35.6002 },
  ]);
  const turns = findType(buildRouteCues(zigzag), "turn");
  assert.equal(turns.length, 1, "close second turn is suppressed");
  assert.ok(near(turns[0].distanceMeters, 9.3, 2), "kept the first turn");
}

// --- Compound turns: close pairs are linked, not dropped ------------------
{
  const route = routeFrom([
    { lat: 33.0, lng: 35.0 },
    { lat: 33.0, lng: 35.002 },
    { lat: 33.00036, lng: 35.002 },
    { lat: 33.00036, lng: 35.004 },
  ]);
  const turns = findType(buildRouteCues(route), "turn");
  assert.equal(turns.length, 2, "both turns of a close pair survive");
  assert.equal(turns[0].direction, "left");
  assert.equal(turns[0].thenDirection, "right");
  assert.equal(
    turns[1].compoundPreviousDistanceMeters,
    turns[0].distanceMeters,
    "follow-up points back to the compound instruction",
  );
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

// A due segment boundary must not be starved by a farther maneuver preview.
{
  const segment = { type: "enter-segment", distanceMeters: 400, segmentName: "B" };
  const turn = { type: "turn", distanceMeters: 485, direction: "right" };
  const selected = selectActiveCue([segment, turn], 380);
  assert.equal(selected.cue, segment, "final segment cue beats farther turn preview");
  assert.equal(selected.phase, "final");
}

// --- Real catalog route: junction data is baked in and gates the cues -----
// sovev-beit-hillel used to produce 16 "turn" cues, 9 of them at plain road
// curves (no junction within 30 m+). With junctions in the snapshot, every
// remaining turn is at a junction and the curve noise is gone.
{
  const { default: sovev } = await import(
    "@cycleways/core/navigation/scenarios/routes/sovev-beit-hillel.js"
  );
  const { getDistance } = await import("@cycleways/core/utils/distance.js");
  assert.ok(
    Array.isArray(sovev.junctions) && sovev.junctions.length > 0,
    "snapshot carries network junctions",
  );
  const route = navigationRouteFromRouteState(sovev, { param: "sovev" });
  const cues = buildRouteCues(route);
  const turns = findType(cues, "turn");
  assert.ok(
    turns.length > 0 && turns.length <= 10,
    `curve noise is gone (was 16 turns, got ${turns.length})`,
  );
  function pointAt(meters) {
    const g = route.geometry;
    for (let i = 1; i < g.length; i++) {
      if (g[i].distanceFromStartMeters >= meters) return g[i];
    }
    return g[g.length - 1];
  }
  for (const t of turns) {
    const p = pointAt(t.distanceMeters);
    const nearest = Math.min(...sovev.junctions.map((j) => getDistance(p, j)));
    assert.ok(
      nearest <= 30,
      `turn at ${Math.round(t.distanceMeters)}m sits at a junction (nearest ${Math.round(nearest)}m)`,
    );
  }
  for (const b of findType(cues, "bend")) {
    assert.ok(b.turnAngleDeg >= 75, "bends are only genuinely sharp curves");
  }
}

// --- Roundabout traversal records replace in-ring corner noise ------------
{
  const route = routeFrom(
    [
      { lat: 33, lng: 35 },
      { lat: 33, lng: 35.001 },
      { lat: 32.999, lng: 35.001 },
      { lat: 32.998, lng: 35.001 },
    ],
    {
      junctions: [{
        kind: "roundabout",
        roundaboutId: "r1",
        lat: 33,
        lng: 35.001,
        entryMeters: 70,
        exitMeters: 140,
        entryBearingDeg: 90,
        exitBearingDeg: 180,
        complete: true,
      }],
    },
  );
  const cues = buildRouteCues(route);
  assert.deepEqual(findType(cues, "roundabout").map((cue) => cue.direction), ["right"]);
  assert.equal(findType(cues, "turn").length + findType(cues, "bend").length, 0);
}

// Thresholds and repeated visits are one cue per traversal.
{
  const route = routeFrom(
    [{ lat: 33, lng: 35 }, { lat: 33, lng: 35.01 }],
    {
      junctions: [
        { kind: "roundabout", roundaboutId: "a", lat: 33, lng: 35.002, entryMeters: 100, exitMeters: 130, entryBearingDeg: 0, exitBearingDeg: 39.99, complete: true },
        { kind: "roundabout", roundaboutId: "b", lat: 33, lng: 35.004, entryMeters: 300, exitMeters: 330, entryBearingDeg: 0, exitBearingDeg: 40, complete: true },
        { kind: "roundabout", roundaboutId: "c", lat: 33, lng: 35.006, entryMeters: 500, exitMeters: 530, entryBearingDeg: 0, exitBearingDeg: 130, complete: true },
        { kind: "roundabout", roundaboutId: "d", lat: 33, lng: 35.008, entryMeters: 700, exitMeters: 730, entryBearingDeg: 0, exitBearingDeg: 130.01, complete: true },
      ],
    },
  );
  assert.deepEqual(
    findType(buildRouteCues(route), "roundabout").map((cue) => cue.direction),
    ["straight", "right", "right", "u-turn"],
  );
}

// A turn shortly before a roundabout announces both decisions together.
{
  const route = routeFrom(
    [
      { lat: 33, lng: 35 },
      { lat: 33, lng: 35.001 },
      { lat: 33.0005, lng: 35.001 },
      { lat: 33.0015, lng: 35.001 },
    ],
    {
      junctions: [
        { kind: "junction", lat: 33, lng: 35.001 },
        {
          kind: "roundabout",
          roundaboutId: "after-turn",
          lat: 33.00025,
          lng: 35.001,
          entryMeters: 115,
          exitMeters: 160,
          entryBearingDeg: 0,
          exitBearingDeg: 0,
          complete: true,
        },
      ],
    },
  );
  const cues = buildRouteCues(route);
  const turn = findType(cues, "turn")[0];
  const roundabout = findType(cues, "roundabout")[0];
  assert.deepEqual(turn.thenManeuver, { type: "roundabout", direction: "straight" });
  assert.equal(roundabout.compoundPreviousType, "turn");
  assert.equal(roundabout.compoundPreviousDistanceMeters, turn.distanceMeters);
}

// Incomplete traversal suppresses geometry noise but cannot announce direction.
{
  const route = routeFrom(
    [{ lat: 33, lng: 35 }, { lat: 33.001, lng: 35.001 }, { lat: 33.002, lng: 35.001 }],
    { junctions: [{ kind: "roundabout", roundaboutId: "edge", lat: 33, lng: 35, entryMeters: 0, exitMeters: 180, complete: false }] },
  );
  assert.equal(findType(buildRouteCues(route), "roundabout").length, 0);
}

console.log("navigation cue tests passed");
