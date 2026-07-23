import assert from "node:assert/strict";
import {
  buildGuidanceSpans,
  buildRouteSpans,
  buildSegmentSpans,
} from "@cycleways/core/route-manager.js";

// buildSegmentSpans is a pure exported helper over an ordered traversal list.
{
  const segmentNamesById = new Map([[10, "Yarkon Path"], [11, "Ayalon Bridge"]]);
  const traversals = [
    { fromDistance: 0, toDistance: 200, distanceMeters: 200, edge: { cwSegmentIds: [10], routeClass: "cycleway" } },
    { fromDistance: 0, toDistance: 150, distanceMeters: 150, edge: { cwSegmentIds: [10], routeClass: "cycleway" } },
    { fromDistance: 0, toDistance: 100, distanceMeters: 100, edge: { cwSegmentIds: [], routeClass: "residential" } },
    { fromDistance: 0, toDistance: 300, distanceMeters: 300, edge: { cwSegmentIds: [11], routeClass: "cycleway" } },
  ];
  const spans = buildSegmentSpans(traversals, segmentNamesById);
  assert.equal(spans.length, 3, "same-name traversals merge");
  assert.deepEqual(
    spans.map((s) => [s.startMeters, s.endMeters, s.name, s.onNetwork, s.routeClass]),
    [
      [0, 350, "Yarkon Path", true, "cycleway"],
      [350, 450, null, false, "residential"],
      [450, 750, "Ayalon Bridge", true, "cycleway"],
    ],
  );
}
{
  const spans = buildSegmentSpans([
    { fromDistance: 0, toDistance: 25, distanceMeters: 25, junctionMemberships: [{ junctionId: "j1", junctionName: "Test Junction" }], edge: { routeClass: "manual" } },
  ], new Map());
  assert.deepEqual(spans[0], {
    startMeters: 0,
    endMeters: 25,
    name: null,
    cwSegmentId: null,
    segmentId: null,
    internalName: null,
    segmentIds: [],
    segmentMemberships: [],
    onNetwork: true,
    onCycleways: true,
    networkRole: "junction",
    junctionId: "j1",
    junctionName: "Test Junction",
    junctionMemberships: [{
      junctionId: "j1",
      fingerprint: null,
      junctionName: "Test Junction",
    }],
    routeClass: "manual",
  });
}

// Direction-scoped overlaps are retained as a set; guidance may collapse them
// only when every exact member resolves to the same stable identity.
{
  const traversals = [
    {
      distanceMeters: 100,
      fromDistance: 0,
      toDistance: 100,
      cwMemberships: [
        { segmentId: 97, alignmentKey: "aToB", mappingDigest: "a" },
        { segmentId: 326, alignmentKey: "aToB", mappingDigest: "b" },
      ],
      edge: { routeClass: "cycleway" },
    },
    {
      distanceMeters: 200,
      fromDistance: 0,
      toDistance: 200,
      cwMemberships: [{ segmentId: 326, alignmentKey: "aToB", mappingDigest: "b" }],
      edge: { routeClass: "cycleway" },
    },
  ];
  const exact = buildSegmentSpans(
    traversals,
    new Map([[97, "שביל אופניים 99 כפר יובל"], [326, "שביל אופניים 99 מעיין ברוך"]]),
  );
  assert.deepEqual(exact[0].segmentIds, [97, 326]);
  assert.equal(exact[0].cwSegmentId, null, "overlap has no lossy singular alias");
  assert.equal(exact[0].name, null);

  const guidance = new Map([97, 326].map((segmentId) => [segmentId, {
    role: "named-way",
    guidanceIdentity: "way:cycleway-99",
    wayId: "cycleway-99",
    name: "שביל אופניים 99",
    spokenName: "שביל אופניים תשעים ותשע",
    kind: "cycleway",
    sectionLabel: null,
    resolutionStatus: "resolved",
    segmentId,
  }]));
  const guidanceSpans = buildGuidanceSpans(traversals, guidance);
  assert.equal(guidanceSpans.length, 1, "same-way exact sections form one guidance span");
  assert.equal(guidanceSpans[0].guidanceIdentity, "way:cycleway-99");
  assert.deepEqual(guidanceSpans[0].segmentIds, [97, 326]);

  const routeSpans = buildRouteSpans(traversals, new Map(), guidance, {
    guidanceSchemaVersion: 1,
  });
  assert.equal(routeSpans.guidanceMode, "guidance-v1");
  assert.equal(routeSpans.guidanceSpans.length, 1);
}

// Naming degrades per span, not per route. An unreviewed member reads as its
// facility class; it never restores the internal editor name and never demotes
// the surrounding classified spans.
{
  const traversals = [{
    distanceMeters: 50,
    fromDistance: 0,
    toDistance: 50,
    cwMemberships: [{ segmentId: 999 }],
    edge: { routeClass: "path" },
  }];
  const routeSpans = buildRouteSpans(
    traversals,
    new Map([[999, "Unreviewed"]]),
    new Map(),
    { guidanceSchemaVersion: 1 },
  );
  assert.equal(routeSpans.guidanceMode, "guidance-v1");
  assert.equal(routeSpans.guidanceSpans.length, 1);
  assert.equal(routeSpans.guidanceSpans[0].resolutionStatus, "unreviewed");
  assert.equal(routeSpans.guidanceSpans[0].name, null);
  assert.equal(routeSpans.guidanceSpans[0].kind, "path",
    "an unreviewed span still carries a facility class to fall back on");
}

// A route mixing one classified and one unreviewed member keeps the name it has.
{
  const traversals = [
    {
      distanceMeters: 100,
      fromDistance: 0,
      toDistance: 100,
      cwMemberships: [{ segmentId: 174 }],
      edge: { routeClass: "secondary" },
    },
    {
      distanceMeters: 40,
      fromDistance: 0,
      toDistance: 40,
      cwMemberships: [{ segmentId: 888 }],
      edge: { routeClass: "track" },
    },
  ];
  const guidance = new Map([[174, {
    role: "named-way",
    guidanceIdentity: "way:road-99",
    wayId: "road-99",
    name: "כביש 99",
    spokenName: null,
    kind: "road",
    sectionLabel: null,
    resolutionStatus: "resolved",
    segmentId: 174,
  }]]);
  const routeSpans = buildRouteSpans(traversals, new Map(), guidance, {
    guidanceSchemaVersion: 1,
  });
  assert.deepEqual(
    routeSpans.guidanceSpans.map((span) => [span.name, span.resolutionStatus]),
    [["כביש 99", "resolved"], [null, "unreviewed"]],
  );
}

// Overlapping memberships that disagree speak neither name, but must still
// expose a class: a null name with a null kind is silent navigation.
{
  const traversals = [{
    distanceMeters: 60,
    fromDistance: 0,
    toDistance: 60,
    cwMemberships: [{ segmentId: 1 }, { segmentId: 2 }],
    edge: { routeClass: "secondary" },
  }];
  const guidance = new Map([
    [1, {
      role: "named-way",
      guidanceIdentity: "way:road-99",
      wayId: "road-99",
      name: "כביש 99",
      spokenName: null,
      kind: "road",
      sectionLabel: null,
      resolutionStatus: "resolved",
      segmentId: 1,
    }],
    [2, {
      role: "named-way",
      guidanceIdentity: "way:cycleway-99",
      wayId: "cycleway-99",
      name: "שביל אופניים 99",
      spokenName: null,
      kind: "cycleway",
      sectionLabel: null,
      resolutionStatus: "resolved",
      segmentId: 2,
    }],
  ]);
  const routeSpans = buildRouteSpans(traversals, new Map(), guidance, {
    guidanceSchemaVersion: 1,
  });
  assert.equal(routeSpans.guidanceSpans[0].resolutionStatus, "conflict");
  assert.equal(routeSpans.guidanceSpans[0].name, null);
  assert.equal(routeSpans.guidanceSpans[0].kind, "road",
    "conflicting kinds fall back to route-class evidence");
}

// A release with no supported guidance schema is the only remaining legacy path.
{
  const routeSpans = buildRouteSpans([{
    distanceMeters: 50,
    fromDistance: 0,
    toDistance: 50,
    cwMemberships: [{ segmentId: 1 }],
    edge: { routeClass: "path" },
  }], new Map(), new Map(), {});
  assert.equal(routeSpans.guidanceMode, "legacy");
  assert.deepEqual(routeSpans.guidanceSpans, []);
}

// The reverse-ready projection is resolved up front, in the reverse frame.
{
  const traversals = [
    {
      distanceMeters: 100,
      fromDistance: 0,
      toDistance: 100,
      cwMemberships: [{ segmentId: 1 }],
      oppositeCwMemberships: [{ segmentId: 1 }],
      edge: { routeClass: "cycleway" },
    },
    {
      distanceMeters: 50,
      fromDistance: 0,
      toDistance: 50,
      cwMemberships: [{ segmentId: 2 }],
      // Asymmetric: riding back, these edges belong to a different segment.
      oppositeCwMemberships: [{ segmentId: 3 }],
      edge: { routeClass: "cycleway" },
    },
  ];
  const makeWay = (segmentId, wayId, name) => [segmentId, {
    role: "named-way",
    guidanceIdentity: `way:${wayId}`,
    wayId,
    name,
    spokenName: null,
    kind: "cycleway",
    sectionLabel: null,
    resolutionStatus: "resolved",
    segmentId,
  }];
  const guidance = new Map([
    makeWay(1, "one", "One"),
    makeWay(2, "two", "Two"),
    makeWay(3, "three", "Three"),
  ]);
  const routeSpans = buildRouteSpans(traversals, new Map(), guidance, {
    guidanceSchemaVersion: 1,
  });
  assert.deepEqual(
    routeSpans.guidanceSpans.map((span) => [span.startMeters, span.endMeters, span.name]),
    [[0, 100, "One"], [100, 150, "Two"]],
  );
  assert.deepEqual(
    routeSpans.oppositeGuidanceSpans.map((span) => [span.startMeters, span.endMeters, span.name]),
    [[0, 50, "Three"], [50, 150, "One"]],
    "asymmetric reverse membership resolves to its own way, not the forward name",
  );
}
console.log("test-segment-spans OK");
