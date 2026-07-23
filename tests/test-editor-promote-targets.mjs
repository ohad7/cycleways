import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPromoteTargets,
  offeredRouteMigrationBlockers,
  stablePromotionManifest,
} from "../editor/server.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const manifest = {
  bikeRoads: "bike_roads.geojson",
  segments: "segments.json",
  cwBaseIndex: "cw-base-index.json",
  kml: "exports/map.kml",
  baseRoutingShards: "base-routing-shards/manifest.json",
  cwAlignmentGeometry: "cw-alignment-geometry.json",
  legacyRoutingCompatibility: {
    cwBaseIndex: "routing-compat/cw-base-index-v1.json",
    metadata: "routing-compat/cw-base-index-v1.metadata.json",
  },
  routeAnchorCompatibility: {
    path: "routing-compat/route-anchor-compatibility.abc123def456.json",
  },
  roundabouts: "roundabouts.json",
  crossings: "crossings.json",
};

const targets = buildPromoteTargets(manifest);
const byLabel = new Map(targets.map((target) => [target.label, target]));

assert.ok(byLabel.has("public CW base index"));
assert.ok(byLabel.has("public CW alignment geometry"));
assert.ok(byLabel.has("legacy routing compatibility index"));
assert.ok(byLabel.has("legacy routing compatibility metadata"));
assert.ok(byLabel.has("historical route anchor compatibility"));
assert.equal(targets.at(-1).label, "public manifest");

const releaseTargets = buildPromoteTargets({
  ...manifest,
  routeCatalog: "route-catalog.abc123.json",
  featuredRoutesBase: "featured-routes.def456",
});
assert.ok(releaseTargets.some((target) => target.label === "public route catalog"));
assert.ok(
  releaseTargets.some((target) => target.label === "public featured route snapshots"),
);
assert.equal(releaseTargets.at(-1).label, "public manifest");
assert.equal(
  byLabel.get("public CW base index").source,
  path.join(repoRoot, "build/public-data/cw-base-index.json"),
);
assert.equal(
  byLabel.get("historical route anchor compatibility").target,
  path.join(
    repoRoot,
    "public-data/routing-compat/route-anchor-compatibility.abc123def456.json",
  ),
);

assert.equal(
  byLabel.get("public roundabouts").source,
  path.join(repoRoot, "build/public-data/roundabouts.json"),
);
assert.equal(
  byLabel.get("public roundabouts").target,
  path.join(repoRoot, "public-data/roundabouts.json"),
);
assert.equal(
  byLabel.get("public crossings").source,
  path.join(repoRoot, "build/public-data/crossings.json"),
);
assert.equal(
  byLabel.get("public crossings").target,
  path.join(repoRoot, "public-data/crossings.json"),
);

assert.deepEqual(
  offeredRouteMigrationBlockers({
    summary: { routes: 8, exactCurrentPolicy: 8, materialChanges: 0 },
    routes: Array.from({ length: 8 }, (_, index) => ({
      slug: `route-${index}`,
      exactCurrentPolicy: true,
      automaticPromotionSafe: true,
      currentFingerprint: `fingerprint-${index}`,
    })),
  }),
  [],
);
assert.deepEqual(
  offeredRouteMigrationBlockers({
    summary: { routes: 2, exactCurrentPolicy: 1, automaticPromotionSafe: 0 },
    routes: [
      {
        slug: "not-exact",
        exactCurrentPolicy: false,
        automaticPromotionSafe: false,
        currentFingerprint: "fingerprint-1",
      },
      {
        slug: "changed",
        exactCurrentPolicy: true,
        automaticPromotionSafe: false,
        currentFingerprint: "fingerprint-2",
      },
    ],
  }),
  ["not-exact-current-policy=1", "route-changes-need-review=1"],
);
assert.deepEqual(offeredRouteMigrationBlockers({ summary: {} }), [
  "no-offered-routes-migrated",
]);
assert.deepEqual(
  offeredRouteMigrationBlockers({ summary: { routes: 1 }, routes: [] }),
  ["route-report-count-mismatch=1"],
);
assert.deepEqual(
  offeredRouteMigrationBlockers(
    {
      summary: { routes: 1 },
      routes: [{
        slug: "reviewed-change",
        exactCurrentPolicy: true,
        automaticPromotionSafe: false,
        currentFingerprint: "accepted-after-review",
      }],
    },
    { entries: [{ slug: "reviewed-change", acceptedFingerprint: "accepted-after-review" }] },
  ),
  [],
);

assert.equal(
  buildPromoteTargets({ ...manifest, roundabouts: null }).some((target) => target.label === "public roundabouts"),
  false,
);
assert.equal(
  byLabel.get("public CW base index").target,
  path.join(repoRoot, "public-data/cw-base-index.json"),
);

assert.equal(
  byLabel.get("base routing shards").source,
  path.join(repoRoot, "build/public-data/base-routing-shards"),
);
assert.equal(
  byLabel.get("base routing shards").target,
  path.join(repoRoot, "public-data/base-routing-shards"),
);

const stableRelease = stablePromotionManifest({
  ...manifest,
  bikeRoads: "bike_roads.abc123def456.geojson",
  segments: "segments.abc123def456.json",
  cwBaseIndex: "cw-base-index.abc123def456.json",
  kml: "exports/map.abc123def456.kml",
  baseRoutingShards: "base-routing-shards.abc123def456/manifest.json",
  cwAlignmentGeometry: "cw-alignment-geometry.abc123def456.json",
  roundabouts: "roundabouts.abc123def456.json",
  networkJunctions: "network-junctions.abc123def456.json",
  routeAnchorCompatibility: {
    ...manifest.routeAnchorCompatibility,
    path: "routing-compat/route-anchor-compatibility.abc123def456.json",
  },
});
assert.equal(stableRelease.bikeRoads, "bike_roads.geojson");
assert.equal(stableRelease.segments, "segments.json");
assert.equal(stableRelease.cwBaseIndex, "cw-base-index.json");
assert.equal(stableRelease.baseRoutingShards, "base-routing-shards/manifest.json");
assert.equal(stableRelease.cwAlignmentGeometry, "cw-alignment-geometry.json");
assert.equal(stableRelease.roundabouts, "roundabouts.json");
assert.equal(stableRelease.networkJunctions, "network-junctions.json");
assert.equal(
  stableRelease.routeAnchorCompatibility.path,
  "routing-compat/route-anchor-compatibility.json",
);
assert.equal(stableRelease.routeCatalog, "route-catalog.json");
assert.equal(stableRelease.featuredRoutesBase, "featured-routes");

const stableTimestamp = stablePromotionManifest(
  { ...stableRelease, generatedAt: "2026-07-23T13:00:00.000Z" },
  {
    currentManifest: {
      ...stableRelease,
      generatedAt: "2026-07-23T12:00:00.000Z",
    },
  },
);
assert.equal(stableTimestamp.generatedAt, "2026-07-23T12:00:00.000Z");

const existingPublication = {
  bikeRoads: "bike_roads.oldslot.geojson",
  segments: "segments.oldslot.json",
  cwBaseIndex: "cw-base-index.oldslot.json",
  kml: "exports/map.oldslot.kml",
  baseRoutingShards: "base-routing-shards.oldslot/manifest.json",
  cwAlignmentGeometry: "cw-alignment-geometry.oldslot.json",
  roundabouts: "roundabouts.oldslot.json",
  networkJunctions: "network-junctions.oldslot.json",
  routeCatalog: "route-catalog.oldslot.json",
  featuredRoutesBase: "featured-routes.oldslot",
  routeAnchorCompatibility: {
    path: "routing-compat/route-anchor-compatibility.oldslot.json",
  },
};
const reusedPublication = stablePromotionManifest(stableRelease, {
  currentManifest: existingPublication,
});
assert.equal(reusedPublication.baseRoutingShards, existingPublication.baseRoutingShards);
assert.equal(reusedPublication.routeCatalog, existingPublication.routeCatalog);
assert.equal(
  reusedPublication.routeAnchorCompatibility.path,
  existingPublication.routeAnchorCompatibility.path,
);

const slottedTargets = buildPromoteTargets(reusedPublication, {
  sourceManifest: stableRelease,
});
const slottedByLabel = new Map(slottedTargets.map((target) => [target.label, target]));
assert.equal(
  slottedByLabel.get("base routing shards").source,
  path.join(repoRoot, "build/public-data/base-routing-shards"),
);
assert.equal(
  slottedByLabel.get("base routing shards").target,
  path.join(repoRoot, "public-data/base-routing-shards.oldslot"),
);

console.log("editor promote target tests passed");
