import assert from "node:assert/strict";
import {
  loadFeaturedRouteSnapshot,
  snapshotToRouteState,
} from "@cycleways/core/data/featuredRouteSnapshots.js";

function makeSnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    slug: "demo-route",
    generatedAt: "2026-06-03T00:00:00.000Z",
    source: {
      routeTokenHash: "sha256:abc",
      routeFormat: "compact_route",
      mapVersion: "v1",
      assetHashes: {},
    },
    route: {
      geometry: [
        { lat: 33.1, lng: 35.6, elevation: 90 },
        { lat: 33.2, lng: 35.7, elevation: 91 },
      ],
      bounds: { west: 35.6, south: 33.1, east: 35.7, north: 33.2 },
      distance: 1234.5,
      elevationGain: 12,
      elevationLoss: 11,
      selectedSegments: ["seg a", "seg b"],
    },
    pois: {
      activeDataPoints: [
        {
          id: "poi-1",
          type: "beach",
          name: "חוף",
          description: "desc",
          location: [33.15, 35.65],
          routeFraction: 0.42,
          images: [{ photo: "p.webp", thumbnail: "t.webp" }],
        },
      ],
      dataMarkerFeatures: [
        { type: "Feature", id: "poi-1", geometry: { type: "Point", coordinates: [35.65, 33.15] }, properties: {} },
      ],
      activeDataPointIds: ["poi-1"],
    },
    ...overrides,
  };
}

// --- snapshotToRouteState: maps grouped snapshot into flat routeState ---
{
  const snapshot = makeSnapshot();
  const state = snapshotToRouteState(snapshot);
  assert.deepEqual(state.geometry, snapshot.route.geometry);
  assert.deepEqual(state.selectedSegments, snapshot.route.selectedSegments);
  assert.equal(state.distance, 1234.5);
  assert.equal(state.elevationGain, 12);
  assert.equal(state.elevationLoss, 11);
  assert.deepEqual(state.points, []);
  assert.equal(state.routeFailure, null);

  // activeDataPoints round-trip preserves rich fields
  assert.equal(state.activeDataPoints.length, 1);
  const poi = state.activeDataPoints[0];
  assert.equal(poi.id, "poi-1");
  assert.equal(poi.type, "beach");
  assert.equal(poi.name, "חוף");
  assert.equal(poi.description, "desc");
  assert.deepEqual(poi.location, [33.15, 35.65]);
  assert.equal(poi.routeFraction, 0.42);
  assert.deepEqual(poi.images, [{ photo: "p.webp", thumbnail: "t.webp" }]);
}

// --- snapshotToRouteState: empty / missing groups default safely ---
{
  const state = snapshotToRouteState({});
  assert.deepEqual(state.geometry, []);
  assert.deepEqual(state.selectedSegments, []);
  assert.equal(state.distance, 0);
  assert.deepEqual(state.activeDataPoints, []);
  assert.equal(state.routeFailure, null);
}

// --- loadFeaturedRouteSnapshot: valid snapshot fetched & returned ---
const originalFetch = global.fetch;
function mockFetch(value, { ok = true } = {}) {
  global.fetch = async () => ({
    ok,
    status: ok ? 200 : 404,
    statusText: ok ? "OK" : "Not Found",
    headers: { get: () => "application/json" },
    async json() {
      return value;
    },
  });
}

try {
  mockFetch(makeSnapshot());
  const loaded = await loadFeaturedRouteSnapshot("demo-route");
  assert.equal(loaded.slug, "demo-route");
  assert.equal(loaded.route.geometry.length, 2);

  // missing slug arg throws
  await assert.rejects(() => loadFeaturedRouteSnapshot(""), /requires a slug/);

  // slug mismatch throws
  mockFetch(makeSnapshot({ slug: "other" }));
  await assert.rejects(() => loadFeaturedRouteSnapshot("demo-route"), /slug mismatch/);

  // wrong schemaVersion throws
  mockFetch(makeSnapshot({ schemaVersion: 99 }));
  await assert.rejects(
    () => loadFeaturedRouteSnapshot("demo-route"),
    /unsupported schemaVersion/,
  );

  // short geometry throws
  mockFetch(
    makeSnapshot({
      route: { geometry: [{ lat: 33.1, lng: 35.6 }] },
    }),
  );
  await assert.rejects(
    () => loadFeaturedRouteSnapshot("demo-route"),
    /fewer than 2 geometry/,
  );

  // missing geometry throws
  mockFetch(makeSnapshot({ route: {} }));
  await assert.rejects(
    () => loadFeaturedRouteSnapshot("demo-route"),
    /fewer than 2 geometry/,
  );

  // missing source metadata throws
  mockFetch(makeSnapshot({ source: undefined }));
  await assert.rejects(
    () => loadFeaturedRouteSnapshot("demo-route"),
    /missing source metadata/,
  );

  // HTTP failure surfaces from getJsonAsset
  mockFetch(undefined, { ok: false });
  await assert.rejects(() => loadFeaturedRouteSnapshot("demo-route"), /HTTP 404/);

  // SPA fallbacks return HTML with HTTP 200; surface that as a missing JSON asset
  // instead of leaking the browser JSON parser's `Unexpected token '<'` message.
  global.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => "text/html; charset=utf-8" },
    async json() {
      throw new SyntaxError("Unexpected token '<'");
    },
  });
  await assert.rejects(
    () => loadFeaturedRouteSnapshot("demo-route"),
    /expected JSON asset but received HTML/,
  );
} finally {
  global.fetch = originalFetch;
}

console.log("Featured route snapshot loader tests passed");
