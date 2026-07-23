import assert from "node:assert/strict";
import { buildSnapshotFromRouteState } from "../scripts/lib/featuredRouteSnapshotBuilder.mjs";

const manifest = {
  version: "2026-06-03T00:00:00Z",
  hashes: {
    bikeRoads: "bike-hash",
    segments: "seg-hash",
    cwBaseIndex: "cw-hash",
    baseRoutingShards: "shard-hash",
  },
};

function baseRouteState(overrides = {}) {
  return {
    geometry: [
      { lng: 35.0, lat: 33.0 },
      { lng: 35.5, lat: 33.5 },
      { lng: 34.5, lat: 32.5 },
    ],
    distance: 1234,
    elevationGain: 100,
    elevationLoss: 50,
    selectedSegments: ["Seg A", "Seg B"],
    activeDataPoints: [],
    ...overrides,
  };
}

{
  // Bounds computation: min/max over finite lng/lat pairs.
  const snapshot = buildSnapshotFromRouteState({
    slug: "demo",
    routeState: baseRouteState(),
    routeToken: "TOKEN-1",
    routeFormat: "hybrid_route_v6",
    manifest,
  });

  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.slug, "demo");
  assert.equal(typeof snapshot.generatedAt, "string");

  assert.deepEqual(snapshot.route.bounds, {
    west: 34.5,
    south: 32.5,
    east: 35.5,
    north: 33.5,
  });
  assert.equal(snapshot.route.distance, 1234);
  assert.equal(snapshot.route.elevationGain, 100);
  assert.equal(snapshot.route.elevationLoss, 50);
  assert.deepEqual(snapshot.route.selectedSegments, ["Seg A", "Seg B"]);
  assert.equal(snapshot.route.guidanceMode, "legacy");
  assert.deepEqual(snapshot.route.itinerary, []);

  const displayImage = { photo: "map.webp", thumbnail: "map-thumb.webp", alt: "Route map" };
  const snapshotWithImage = buildSnapshotFromRouteState({
    slug: "demo",
    displayImage,
    routeState: baseRouteState(),
    routeToken: "TOKEN-1",
    routeFormat: "hybrid_route_v6",
    manifest,
  });
  assert.deepEqual(snapshotWithImage.route.displayImage, displayImage);

  // Source metadata is derived from the manifest + token hash.
  assert.equal(snapshot.source.routeFormat, "hybrid_route_v6");
  assert.equal(snapshot.source.mapVersion, manifest.version);
  assert.deepEqual(snapshot.source.assetHashes, {
    bikeRoads: "bike-hash",
    segments: "seg-hash",
    cwBaseIndex: "cw-hash",
    baseRoutingShards: "shard-hash",
  });
  assert.match(snapshot.source.routeTokenHash, /^sha256:[0-9a-f]{64}$/);
}
console.log("featured-route-snapshot bounds tests passed");

{
  // Bounds ignore non-finite coordinates.
  const snapshot = buildSnapshotFromRouteState({
    slug: "demo",
    routeState: baseRouteState({
      geometry: [
        { lng: 35.0, lat: 33.0 },
        { lng: NaN, lat: 33.9 },
        { lng: 35.5, lat: Infinity },
        { lng: 35.2, lat: 33.4 },
      ],
    }),
    routeToken: "TOKEN-2",
    routeFormat: "base_route_v4",
    manifest,
  });
  assert.deepEqual(snapshot.route.bounds, {
    west: 35.0,
    south: 33.0,
    east: 35.2,
    north: 33.4,
  });
}
console.log("featured-route-snapshot non-finite-coordinate tests passed");

{
  // Empty / short geometry: bounds is null, geometry defaults to [].
  const emptySnapshot = buildSnapshotFromRouteState({
    slug: "empty",
    routeState: baseRouteState({ geometry: [] }),
    routeToken: "TOKEN-3",
    routeFormat: "hybrid_route_v6",
    manifest,
  });
  assert.deepEqual(emptySnapshot.route.geometry, []);
  assert.equal(emptySnapshot.route.bounds, null);

  // Non-array geometry is coerced to [].
  const missingSnapshot = buildSnapshotFromRouteState({
    slug: "missing",
    routeState: baseRouteState({ geometry: undefined }),
    routeToken: "TOKEN-4",
    routeFormat: "hybrid_route_v6",
    manifest,
  });
  assert.deepEqual(missingSnapshot.route.geometry, []);
  assert.equal(missingSnapshot.route.bounds, null);

  // Single-point geometry still yields a (degenerate) bounds.
  const shortSnapshot = buildSnapshotFromRouteState({
    slug: "short",
    routeState: baseRouteState({ geometry: [{ lng: 35.0, lat: 33.0 }] }),
    routeToken: "TOKEN-5",
    routeFormat: "hybrid_route_v6",
    manifest,
  });
  assert.deepEqual(shortSnapshot.route.bounds, {
    west: 35.0,
    south: 33.0,
    east: 35.0,
    north: 33.0,
  });
}
console.log("featured-route-snapshot empty/short geometry tests passed");

{
  // activeDataPointIds must be consistent with activeDataPoints: only points
  // carrying a non-empty string id are listed, in the same order.
  const snapshot = buildSnapshotFromRouteState({
    slug: "pois",
    routeState: baseRouteState({
      activeDataPoints: [
        { id: "poi-1", type: "cafe", location: [33.0, 35.0] },
        { type: "gate", location: [33.1, 35.1] }, // no id -> excluded from ids
        { id: "", type: "mud", location: [33.2, 35.2] }, // empty id -> excluded
        { id: "poi-2", type: "water", location: [33.3, 35.3] },
      ],
    }),
    routeToken: "TOKEN-6",
    routeFormat: "hybrid_route_v6",
    manifest,
  });

  // All four active data points are preserved verbatim.
  assert.equal(snapshot.pois.activeDataPoints.length, 4);
  // Only points with a non-empty string id appear in activeDataPointIds.
  assert.deepEqual(snapshot.pois.activeDataPointIds, ["poi-1", "poi-2"]);

  // dataMarkerFeatures are projected from the active data points (the no-id
  // points get a fallback id but still render a feature).
  assert.equal(snapshot.pois.dataMarkerFeatures.length, 4);
  const ids = snapshot.pois.dataMarkerFeatures.map((f) => f.id);
  assert.ok(ids.includes("poi-1"));
  assert.ok(ids.includes("poi-2"));

  // Consistency invariant the --check step relies on: every listed id exists
  // in activeDataPoints in the same relative order.
  const expectedIds = snapshot.pois.activeDataPoints
    .map((p) => p.id)
    .filter((id) => typeof id === "string" && id.length > 0);
  assert.deepEqual(snapshot.pois.activeDataPointIds, expectedIds);
}
console.log("featured-route-snapshot activeDataPointIds tests passed");

{
  // Missing manifest hashes degrade to null rather than throwing.
  const snapshot = buildSnapshotFromRouteState({
    slug: "no-manifest",
    routeState: baseRouteState(),
    routeToken: "TOKEN-7",
    routeFormat: "hybrid_route_v6",
    manifest: {},
  });
  assert.equal(snapshot.source.mapVersion, null);
  assert.deepEqual(snapshot.source.assetHashes, {
    bikeRoads: null,
    segments: null,
    cwBaseIndex: null,
    baseRoutingShards: null,
  });
}
console.log("featured-route-snapshot missing-manifest tests passed");

console.log("test-featured-route-snapshots passed");
