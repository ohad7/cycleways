// Load the raw base-routing network (nodes + edges, shard duplicates kept —
// junctionsNearRoute dedupes edges by id) for every compact shard whose
// bounds intersect the padded bbox of a route geometry. Node-side helper for
// diagnostic/snapshot scripts; reads public-data, never writes it.
import { readFileSync } from "node:fs";
import { decodeCompactBaseRoutingShard } from "../../packages/core/src/routing/compactBaseRoutingShard.js";

const BASE = "public-data/base-routing-shards";
const BBOX_PAD_DEG = 0.01;

export function loadBaseNetworkAroundGeometry(geometry) {
  const manifest = JSON.parse(readFileSync(`${BASE}/manifest.json`, "utf-8"));
  const lats = geometry.map((point) => point.lat);
  const lngs = geometry.map((point) => point.lng);
  const bbox = [
    Math.min(...lngs) - BBOX_PAD_DEG,
    Math.min(...lats) - BBOX_PAD_DEG,
    Math.max(...lngs) + BBOX_PAD_DEG,
    Math.max(...lats) + BBOX_PAD_DEG,
  ];
  const nodes = [];
  const edges = [];
  let shardCount = 0;
  for (const entry of manifest.shards) {
    const [west, south, east, north] = entry.bounds;
    if (east < bbox[0] || west > bbox[2] || north < bbox[1] || south > bbox[3]) {
      continue;
    }
    const shard = decodeCompactBaseRoutingShard(
      readFileSync(`${BASE}/${entry.formats.compact.path}`),
    );
    nodes.push(...shard.nodes);
    edges.push(...shard.edges);
    shardCount += 1;
  }
  return { nodes, edges, shardCount };
}
