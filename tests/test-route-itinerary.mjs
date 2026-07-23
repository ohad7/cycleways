import assert from "node:assert/strict";
import {
  buildRouteItinerary,
  sliceRouteGeometryRange,
} from "@cycleways/core/ui/routeItinerary.js";

function span(overrides) {
  return {
    networkRole: "segment",
    resolutionStatus: "resolved",
    role: "named-way",
    kind: "road",
    routeClass: "secondary",
    spokenName: null,
    sectionLabels: [],
    segmentIds: [],
    ...overrides,
  };
}

const routeState = {
  activeDataPoints: [],
  segmentSpans: [],
  guidancePresentationPolicy: "named",
  guidanceSpans: [
    span({
      startMeters: 0,
      endMeters: 100,
      guidanceIdentity: "way:road-99",
      wayId: "road-99",
      name: "כביש 99",
      segmentIds: [1],
      sectionLabels: ["צפון"],
    }),
    span({
      startMeters: 100,
      endMeters: 110,
      networkRole: "junction",
      resolutionStatus: "junction",
      role: null,
      guidanceIdentity: null,
      name: null,
      junctionId: "junction-1",
      junctionName: "צומת הבניאס",
    }),
    span({
      startMeters: 110,
      endMeters: 500,
      guidanceIdentity: "way:road-99",
      wayId: "road-99",
      name: "כביש 99",
      segmentIds: [2],
      sectionLabels: ["דרום"],
    }),
    span({
      startMeters: 500,
      endMeters: 540,
      resolutionStatus: "unreviewed",
      role: null,
      guidanceIdentity: null,
      name: null,
      kind: "connector",
      segmentIds: [3],
    }),
    span({
      startMeters: 540,
      endMeters: 600,
      role: "standalone",
      guidanceIdentity: "standalone:4",
      name: "גשר עינות ירדן",
      spokenName: "גֶּשֶׁר עֵינוֹת יַרְדֵּן",
      kind: "bridge",
      segmentIds: [4],
    }),
    span({
      startMeters: 600,
      endMeters: 900,
      guidanceIdentity: "way:tel-hai",
      wayId: "tel-hai",
      name: "שביל תל חי",
      kind: "trail",
      segmentIds: [5],
    }),
  ],
};

{
  const rows = buildRouteItinerary(routeState);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, "כביש 99");
  assert.equal(rows[0].distanceMeters, 540);
  assert.deepEqual(rows[0].segmentIds, [1, 2, 3]);
  assert.deepEqual(rows[0].sectionLabels, ["צפון", "דרום"]);
  assert.equal(rows[0].junctionContexts[0].junctionName, "צומת הבניאס");
  assert.equal(rows[1].name, "גשר עינות ירדן");
  assert.equal(rows[1].role, "standalone");
  assert.equal(rows[1].distanceMeters, 60);
  assert.equal(rows[2].name, "שביל תל חי");
}

{
  const geometry = [
    { lat: 33, lng: 35 },
    { lat: 33, lng: 35.01 },
    { lat: 33, lng: 35.02 },
  ];
  const clipped = sliceRouteGeometryRange(geometry, 200, 1200);
  assert.ok(clipped.length >= 3);
  assert.ok(clipped[0].lng > 35 && clipped[0].lng < 35.01);
  assert.ok(clipped.at(-1).lng > 35.01 && clipped.at(-1).lng < 35.02);
}

{
  const rows = buildRouteItinerary({
    ...routeState,
    guidancePresentationPolicy: "class-only",
  });
  assert.equal(rows[0].name, "כביש");
  assert.equal(rows[1].name, "גשר");
  assert.equal(rows[2].name, "שביל");
  assert.ok(rows.every((row) => row.isFallback));
}

{
  const cached = [{
    id: "way:road-99:1:0-100",
    name: "כביש 99",
    kind: "road",
    distanceMeters: 100,
  }];
  assert.equal(buildRouteItinerary({
    guidancePresentationPolicy: "named",
    guidanceSpans: [],
    segmentSpans: [],
    guidanceItinerary: cached,
  })[0].name, "כביש 99");
  assert.equal(buildRouteItinerary({
    guidancePresentationPolicy: "class-only",
    guidanceSpans: [],
    segmentSpans: [],
    guidanceItinerary: cached,
  })[0].name, "כביש");
}

console.log("route itinerary tests passed");
