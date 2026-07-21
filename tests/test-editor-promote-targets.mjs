import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPromoteTargets } from "../editor/server.mjs";

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
assert.ok(releaseTargets.some((target) => target.label === "versioned route catalog"));
assert.ok(
  releaseTargets.some((target) => target.label === "versioned featured route snapshots"),
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

console.log("editor promote target tests passed");
