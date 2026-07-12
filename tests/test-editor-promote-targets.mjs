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
  roundabouts: "roundabouts.json",
};

const targets = buildPromoteTargets(manifest);
const byLabel = new Map(targets.map((target) => [target.label, target]));

assert.ok(byLabel.has("public CW base index"));
assert.equal(
  byLabel.get("public CW base index").source,
  path.join(repoRoot, "build/public-data/cw-base-index.json"),
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
