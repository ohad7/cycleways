import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  deriveGuidanceIndexes,
  fallbackGuidanceKind,
  guidanceClassLabel,
  guidanceModeForSchema,
  isSupportedGuidanceSchema,
  normalizeResolvedSegmentGuidance,
} from "@cycleways/core/data/navigationWays.js";
import {
  detectMaterialParallel,
  reviewWayStructure,
  structureIssueFingerprint,
  validateRegistry,
  validateSegmentGuidance,
} from "@cycleways/core/data/navigationWayValidation.js";

const fixtures = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/navigation-way-names/schema-cases.json", import.meta.url)),
    "utf8",
  ),
);

function summarize(issues) {
  return issues.map((entry) => entry.code).sort();
}

function expectMatch(actual, expected, label) {
  assert.deepEqual(summarize(actual), summarize(expected), `${label}: issue codes`);
  for (const want of expected) {
    const found = actual.find((entry) => entry.code === want.code);
    assert.ok(found, `${label}: missing ${want.code}`);
    for (const [key, value] of Object.entries(want)) {
      if (key === "code") continue;
      assert.equal(found[key], value, `${label}: ${want.code}.${key}`);
    }
  }
}

// --- registry -------------------------------------------------------------
for (const testCase of fixtures.registryCases) {
  const { issues } = validateRegistry(testCase.registry);
  expectMatch(issues, testCase.expectedIssues, `registry/${testCase.name}`);
}

// --- per-segment records --------------------------------------------------
for (const testCase of fixtures.segmentCases) {
  const ways = new Map((testCase.knownWayIds || []).map((wayId) => [wayId, { wayId }]));
  const { issues, reviewed } = validateSegmentGuidance(testCase.guidance, {
    segmentId: testCase.segmentId,
    internalName: testCase.internalName,
    ways,
  });
  expectMatch(issues, testCase.expectedIssues, `segment/${testCase.name}`);
  assert.equal(reviewed, testCase.expectedReviewed, `segment/${testCase.name}: reviewed`);
}

// --- structure review -----------------------------------------------------
for (const testCase of fixtures.structureCases) {
  const adjacency = new Map(
    Object.entries(testCase.adjacency || {}).map(([id, neighbours]) => [
      Number(id),
      new Set(neighbours.map(Number)),
    ]),
  );
  const memberEvidence = new Map(
    Object.entries(testCase.memberEvidence || {}).map(([id, evidence]) => [Number(id), evidence]),
  );
  const result = reviewWayStructure({
    wayId: testCase.wayId,
    wayKind: testCase.wayKind,
    memberIds: testCase.memberIds,
    adjacency,
    memberEvidence,
    acknowledgedIssueFingerprints: testCase.acknowledgedIssueFingerprints || [],
    parallelPairs: testCase.parallelPairs || [],
  });
  expectMatch(result.issues, testCase.expectedIssues, `structure/${testCase.name}`);
  assert.equal(
    result.components.length,
    testCase.expectedComponentCount,
    `structure/${testCase.name}: component count`,
  );
  assert.equal(
    result.maxDegree,
    testCase.expectedMaxDegree,
    `structure/${testCase.name}: max degree`,
  );
}

// A structure warning must never be resolvable by splitting the way: the same
// members under one ID keep one guidance identity, which is the whole point.
{
  const branching = fixtures.structureCases.find((c) => c.expectedMaxDegree === 4);
  const result = reviewWayStructure({
    wayId: branching.wayId,
    wayKind: branching.wayKind,
    memberIds: branching.memberIds,
    adjacency: new Map(
      Object.entries(branching.adjacency).map(([id, n]) => [Number(id), new Set(n.map(Number))]),
    ),
  });
  assert.ok(
    result.issues.every((entry) => entry.severity === "warning"),
    "branching alone never blocks",
  );
}

// --- fingerprints ---------------------------------------------------------
{
  const base = structureIssueFingerprint("way-structure-branching", "x", {
    branchNodes: [1, 2],
    maxDegree: 3,
  });
  assert.equal(
    base,
    structureIssueFingerprint("way-structure-branching", "x", {
      branchNodes: [2, 1],
      maxDegree: 3,
    }),
    "fingerprints are order-independent",
  );
  assert.notEqual(
    base,
    structureIssueFingerprint("way-structure-branching", "x", {
      branchNodes: [1, 2, 5],
      maxDegree: 3,
    }),
    "a membership change yields a new fingerprint",
  );
}

// --- material-parallel detector ------------------------------------------
{
  // Two lines 15 m apart running 600 m in the same direction: the road and its
  // parallel cycleway. This is the case that must fire.
  const road = [];
  const cycleway = [];
  for (let index = 0; index <= 20; index += 1) {
    const lng = 35.6 + index * 0.0003;
    road.push([lng, 33.2]);
    cycleway.push([lng, 33.200135]);
  }
  const parallel = detectMaterialParallel(road, cycleway);
  assert.ok(parallel, "a sustained 15 m corridor is material");
  assert.ok(parallel.overlapMeters > 400);
  assert.ok(parallel.separationMeters < 25);

  // Two lines crossing at right angles must not fire it.
  const crossing = [];
  for (let index = 0; index <= 20; index += 1) {
    crossing.push([35.603, 33.19 + index * 0.001]);
  }
  assert.equal(detectMaterialParallel(road, crossing), null, "a crossing is not parallel");

  // Two chained segments meeting end to end must not fire it either.
  const continuation = [];
  for (let index = 0; index <= 20; index += 1) {
    continuation.push([35.606 + index * 0.0003, 33.2]);
  }
  assert.equal(
    detectMaterialParallel(road, continuation),
    null,
    "an end-to-end continuation is not parallel",
  );
}

// --- presentation fallbacks ----------------------------------------------
{
  assert.equal(guidanceClassLabel("dirt-road"), "דרך עפר");
  assert.equal(guidanceClassLabel(null, "track"), "דרך עפר");
  assert.equal(guidanceClassLabel("connector"), "מקטע מקשר");
  // Nothing reaches the generic phrase because the table lacked an entry: it is
  // the floor for spans with neither a kind nor a route class.
  assert.equal(guidanceClassLabel(null, null), "המשך במסלול");
  assert.equal(fallbackGuidanceKind(null, "secondary"), "road");
  assert.equal(fallbackGuidanceKind(null, "unknown-class"), "other");
  assert.equal(guidanceClassLabel(fallbackGuidanceKind(null, "unknown-class")), "מקטע");
}

// --- schema-bound guidance mode ------------------------------------------
{
  assert.equal(isSupportedGuidanceSchema(1), true);
  assert.equal(isSupportedGuidanceSchema(2), false);
  assert.equal(guidanceModeForSchema(1), "guidance-v1");
  assert.equal(guidanceModeForSchema(null), "legacy");
  assert.equal(guidanceModeForSchema(2), "legacy");
}

// --- runtime indexes ------------------------------------------------------
{
  const segmentsData = {
    "כביש 99 קריית שמונה": {
      id: 174,
      guidance: {
        role: "named-way",
        wayId: "road-99",
        guidanceIdentity: "way:road-99",
        name: "כביש 99",
        kind: "road",
      },
    },
    "כביש 99 שאר ישוב": {
      id: 61,
      guidance: {
        role: "named-way",
        wayId: "road-99",
        guidanceIdentity: "way:road-99",
        name: "כביש 99",
        kind: "road",
      },
    },
    "גשר עינות ירדן": {
      id: 14,
      guidance: {
        role: "standalone",
        guidanceIdentity: "standalone:14",
        name: "גשר עינות ירדן",
        kind: "bridge",
      },
    },
    "שדות דפנה צפון": { id: 244 },
  };
  const { bySegmentId, membersByWayId, issues } = deriveGuidanceIndexes(segmentsData);
  assert.deepEqual(issues, []);
  assert.equal(bySegmentId.size, 3, "unreviewed segments are absent from the index");
  assert.equal(bySegmentId.get(244), undefined);
  assert.deepEqual(membersByWayId.get("road-99").segmentIds, [61, 174]);
  assert.equal(membersByWayId.has("standalone:14"), false, "standalone features are not ways");
}

// A duplicate stable ID would make guidance resolution order-dependent.
{
  const { issues } = deriveGuidanceIndexes({ a: { id: 1 }, b: { id: 1 } });
  assert.deepEqual(summarize(issues), ["segment-duplicate-stable-id"]);
}

// A name or spoken-name edit never changes guidance identity.
{
  const before = normalizeResolvedSegmentGuidance(
    { role: "named-way", wayId: "road-99", guidanceIdentity: "way:road-99", name: "כביש 99", kind: "road" },
    174,
  );
  const after = normalizeResolvedSegmentGuidance(
    {
      role: "named-way",
      wayId: "road-99",
      guidanceIdentity: "way:road-99",
      name: "כביש 99 החדש",
      spokenName: "כביש תשעים ותשע",
      kind: "road",
    },
    174,
  );
  assert.equal(before.guidanceIdentity, after.guidanceIdentity);
}

console.log("test-navigation-ways: OK");
