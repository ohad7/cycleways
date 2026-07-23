// Unit tests for the pure derivation behind the Ways workspace UI.
//
// Everything here runs without a browser: the module owns ordering, candidate
// discovery, health/summary copy, search and the merged work queue, so the
// editor's render code stays a thin projection of it.
//
// See plans/ways-workspace-ux/design.md.

import assert from "node:assert/strict";

import {
  buildGeometryIndex,
  buildWorkQueue,
  formatLengthMeters,
  orderWayMembers,
  searchWorkspace,
  wayCandidates,
  wayHealth,
  wayIssueSentence,
  waySummary,
} from "../editor/lib/ways-workspace.mjs";

// ~0.0003 deg lng ≈ 28 m at this latitude; a 10-step run is ~280 m.
const run = (startLng, lat, steps = 10, step = 0.0003) =>
  Array.from({ length: steps + 1 }, (_, index) => [
    Number((startLng + index * step).toFixed(7)),
    lat,
  ]);

function line(id, name, coordinates, extra = {}) {
  return {
    type: "Feature",
    properties: { id, name, status: "active", roadType: "paved", ...extra },
    geometry: { type: "LineString", coordinates },
  };
}

const member = (wayId, sectionLabel) => ({
  guidance: { role: "named-way", wayId, ...(sectionLabel ? { sectionLabel } : {}) },
});

// --- geometry index -------------------------------------------------------
{
  const source = {
    type: "FeatureCollection",
    features: [
      line(1, "A", run(35.6, 33.2)),
      line(2, "B", run(35.61, 33.2), { status: "draft" }),
      line(3, "C", run(35.62, 33.2), { deprecated: true }),
      { type: "Feature", properties: { id: 4 }, geometry: { type: "Point", coordinates: [35, 33] } },
    ],
  };
  const index = buildGeometryIndex(source);
  assert.deepEqual([...index.keys()], [1], "only active line segments are indexed");
  const entry = index.get(1);
  assert.equal(entry.name, "A");
  assert.equal(entry.endpoints.length, 2);
  assert.ok(entry.lengthMeters > 250 && entry.lengthMeters < 310, `length ${entry.lengthMeters}`);
}

// --- ordering along the way ----------------------------------------------
{
  // Three touching runs given to us out of order: 30 → 10 → 20 on the ground.
  const source = {
    type: "FeatureCollection",
    features: [
      line(10, "middle", run(35.603, 33.2), member("road-99")),
      line(20, "east", run(35.606, 33.2), member("road-99", "מעיין ברוך")),
      line(30, "west", run(35.6, 33.2), member("road-99")),
    ],
  };
  const index = buildGeometryIndex(source);
  const ordered = orderWayMembers([10, 20, 30], index);
  assert.deepEqual(
    ordered.rows.map((row) => row.segmentId),
    [30, 10, 20],
    "members are ordered along the chain, not by id",
  );
  assert.deepEqual(ordered.rows.map((row) => row.componentIndex), [0, 0, 0]);
  assert.equal(ordered.componentCount, 1);
  assert.deepEqual(ordered.gaps, [], "a continuous way has no gaps");
  assert.ok(ordered.totalLengthMeters > 800, `total ${ordered.totalLengthMeters}`);

  // Reversing the input must not change the derived order (up to direction).
  const reversed = orderWayMembers([20, 30, 10], index);
  assert.deepEqual(
    reversed.rows.map((row) => row.segmentId),
    [30, 10, 20],
  );
}

// --- disconnected components report a gap in place ------------------------
{
  const source = {
    type: "FeatureCollection",
    features: [
      line(1, "north", run(35.6, 33.2), member("trail")),
      line(2, "north cont", run(35.603, 33.2), member("trail")),
      // ~1 km further east, nothing touching.
      line(9, "south", run(35.62, 33.2), member("trail")),
    ],
  };
  const index = buildGeometryIndex(source);
  const ordered = orderWayMembers([1, 2, 9], index);
  assert.equal(ordered.componentCount, 2);
  assert.equal(ordered.gaps.length, 1, "one gap between the two components");
  assert.equal(ordered.gaps[0].afterSegmentId, 2);
  assert.equal(ordered.gaps[0].beforeSegmentId, 9);
  assert.ok(ordered.gaps[0].distanceMeters > 500, `gap ${ordered.gaps[0].distanceMeters}`);
  assert.deepEqual(
    ordered.rows.map((row) => row.componentIndex),
    [0, 0, 1],
    "each row knows which component it belongs to",
  );
}

// --- candidates at the ends ----------------------------------------------
{
  const source = {
    type: "FeatureCollection",
    features: [
      line(1, "member", run(35.6, 33.2), member("road-99")),
      // Touches the member's east endpoint: a candidate.
      line(2, "continues east", run(35.603, 33.2)),
      // Touches the member's west endpoint but already belongs elsewhere.
      line(3, "other way", run(35.597, 33.2), member("trail")),
      // Nowhere near either endpoint.
      line(4, "far away", run(35.8, 33.4)),
      // Already classified as intentionally unnamed: still attachable, still shown.
      line(5, "unnamed link", run(35.6, 33.2001), { guidance: { role: "unnamed", kind: "connector" } }),
    ],
  };
  const index = buildGeometryIndex(source);
  const candidates = wayCandidates([1], index, { limit: 10 });
  const ids = candidates.map((entry) => entry.segmentId);
  assert.ok(ids.includes(2), "an unclassified segment touching an endpoint is a candidate");
  assert.ok(ids.includes(3), "a segment owned by another way is offered, flagged");
  assert.ok(!ids.includes(4), "a distant segment is never a candidate");
  assert.ok(!ids.includes(1), "members are not their own candidates");

  assert.ok(
    ids.indexOf(2) < ids.indexOf(3),
    "extending the way outranks stealing another way's segment",
  );

  const east = candidates.find((entry) => entry.segmentId === 2);
  assert.equal(east.anchorSegmentId, 1, "a candidate names the member it continues from");
  assert.equal(east.occupiedByWayId, null);
  assert.ok(east.distanceMeters < 25);
  const taken = candidates.find((entry) => entry.segmentId === 3);
  assert.equal(taken.occupiedByWayId, "trail");

  assert.equal(
    wayCandidates([1], index, { limit: 1 }).length,
    1,
    "the candidate list is capped",
  );
  assert.deepEqual(wayCandidates([], index, {}), [], "a way with no members has no candidates");
}

// --- health, summary and sentences ---------------------------------------
{
  const clear = wayHealth({ wayId: "w", memberCount: 3, componentCount: 1 }, []);
  assert.equal(clear.level, "ok");
  assert.equal(clear.label, "תקין");

  const warned = wayHealth({ wayId: "w", memberCount: 3, componentCount: 2 }, [
    { wayId: "w", severity: "warning", code: "way-structure-multi-component", componentCount: 2 },
  ]);
  assert.equal(warned.level, "warning");
  assert.equal(warned.label, "שני חלקים מנותקים", "the chip label stays short");
  assert.match(warned.detail, /תקין אם זו אותה דרך/, "the full sentence stays available");

  const blocked = wayHealth({ wayId: "w", memberCount: 2, componentCount: 1 }, [
    { wayId: "w", severity: "error", code: "parallel-facility-risk", segmentIds: [1, 2] },
    { wayId: "w", severity: "warning", code: "way-structure-branching", maxDegree: 3 },
  ]);
  assert.equal(blocked.level, "blocked", "a blocker outranks a warning");
  assert.equal(blocked.label, "מקטעים מקבילים");

  assert.equal(
    wayHealth({ wayId: "w", memberCount: 3, componentCount: 2 }, [
      {
        wayId: "w",
        severity: "warning",
        code: "way-structure-multi-component",
        componentCount: 2,
        acknowledged: true,
      },
    ]).level,
    "ok",
    "an acknowledged structure finding stops nagging",
  );

  assert.equal(formatLengthMeters(640), "640 מ׳");
  assert.equal(formatLengthMeters(8412), "8.4 ק״מ");
  assert.equal(formatLengthMeters(0), "0 מ׳");

  assert.equal(
    waySummary(
      { name: "כביש 99", kind: "road", ref: "99" },
      { memberCount: 6, componentCount: 1, totalLengthMeters: 8412 },
    ),
    "99 · כביש · 6 מקטעים · 8.4 ק״מ · רצף אחד",
  );
  assert.equal(
    waySummary(
      { name: "גשר", kind: "bridge" },
      { memberCount: 1, componentCount: 1, totalLengthMeters: 137 },
    ),
    "גשר · מקטע אחד · 137 מ׳ · רצף אחד",
    "Hebrew counts one and two by word",
  );
  assert.equal(
    waySummary(
      { name: "שביל יובלים", kind: "cycleway" },
      { memberCount: 4, componentCount: 2, totalLengthMeters: 3100 },
    ),
    "שביל אופניים · 4 מקטעים · 3.1 ק״מ · שני חלקים מנותקים",
  );

  assert.match(wayIssueSentence({ code: "segment-unreviewed", segmentId: 7 }), /לא סווג/);
  assert.match(
    wayIssueSentence({ code: "way-structure-branching", maxDegree: 3 }),
    /הסתעפות/,
  );
  assert.equal(
    wayIssueSentence({ code: "totally-new-code", segmentId: 3 }),
    "totally-new-code (#3)",
    "an unknown code degrades to its raw identity rather than lying",
  );
}

// --- one search over ways and segments -----------------------------------
{
  const registry = {
    ways: {
      "road-99": { name: "כביש 99", kind: "road", ref: "99" },
      "yuvalim-cycleway": { name: "שביל אופניים יובלים", kind: "cycleway" },
    },
  };
  const source = {
    type: "FeatureCollection",
    features: [
      line(162, "מעיין ברוך", run(35.6, 33.2)),
      line(99, "כביש 99 מזרח", run(35.61, 33.2), member("road-99")),
    ],
  };
  const index = buildGeometryIndex(source);

  const byName = searchWorkspace("יובלים", { registry, index });
  assert.equal(byName.length, 1);
  assert.equal(byName[0].type, "way");
  assert.equal(byName[0].id, "yuvalim-cycleway");

  const byId = searchWorkspace("162", { registry, index });
  assert.equal(byId[0].type, "segment");
  assert.equal(byId[0].id, 162);
  assert.match(byId[0].subtitle, /לא סווג/);

  const mixed = searchWorkspace("99", { registry, index });
  assert.deepEqual(
    mixed.map((entry) => entry.type),
    ["way", "segment"],
    "ways rank above segments so the library stays the default target",
  );
  assert.deepEqual(searchWorkspace("   ", { registry, index }), []);
  assert.equal(
    searchWorkspace("9", { registry, index, limit: 1 }).length,
    1,
    "results are capped",
  );
}

// --- the merged work queue -----------------------------------------------
{
  const source = {
    type: "FeatureCollection",
    features: [
      line(1, "classified", run(35.6, 33.2), member("road-99")),
      line(2, "suggested", run(35.61, 33.2)),
      line(3, "bare", run(35.62, 33.2)),
    ],
  };
  const index = buildGeometryIndex(source);
  const suggestions = {
    groups: [
      {
        id: "g1",
        role: "named-way",
        wayId: "road-99",
        name: "כביש 99",
        kind: "road",
        segmentIds: [2],
        decision: "pending",
        confidence: "high",
        validator: { verdict: "clear" },
      },
      {
        id: "g2",
        role: "unnamed",
        kind: "connector",
        segmentIds: [1],
        decision: "pending",
        validator: { verdict: "clear" },
      },
      {
        id: "g3",
        role: "standalone",
        name: "גשר",
        kind: "bridge",
        segmentIds: [3],
        decision: "accepted",
        validator: { verdict: "clear" },
      },
    ],
  };

  const all = buildWorkQueue({ suggestions, index, filter: "all" });
  assert.deepEqual(
    all.map((item) => item.key),
    ["suggestion:g1", "segment:3"],
    "pending suggestions for unreviewed segments come first, then bare unreviewed segments;"
    + " classified segments and decided suggestions drop out",
  );
  assert.equal(all[0].kind, "suggestion");
  assert.deepEqual(all[0].segmentIds, [2]);
  assert.equal(all[1].kind, "segment");
  assert.equal(all[1].segmentId, 3);

  assert.deepEqual(
    buildWorkQueue({ suggestions, index, filter: "no-suggestion" }).map((item) => item.key),
    ["segment:3"],
  );

  const flagged = {
    groups: [
      { ...suggestions.groups[0], validator: { verdict: "blocked", blocking: [{ code: "x" }] } },
    ],
  };
  assert.deepEqual(
    buildWorkQueue({ suggestions: flagged, index, filter: "warning" }).map((item) => item.key),
    ["suggestion:g1"],
    "the warning filter keeps only flagged suggestions",
  );

  assert.deepEqual(
    buildWorkQueue({ suggestions: null, index, filter: "all" }).map((item) => item.key),
    ["segment:2", "segment:3"],
    "with no artifact at all the queue is still the unreviewed set",
  );
}

console.log("test-ways-workspace: OK");
