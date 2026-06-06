import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildLiveDecodeRoute } from "../editor/server.mjs";
import { decodeRoutePayload } from "@cycleways/core/utils/route-encoding.js";

const SEGMENT_ROUTE = "DvsVvkJ2SiQeaAkhgGPtCZde8S8Q8xGxbG4BSY7c32agaEz219fTkrW2ZA";

const catalog = JSON.parse(await readFile("public-data/route-catalog.json", "utf-8"));
const decode = await buildLiveDecodeRoute();

// Regression: the catalog recompute/promote decoder must handle current
// base-graph route tokens (hybrid_route_v6), not only segment-based routes.
const hybridEntry = catalog.entries.find((entry) => {
  if (entry.slug === "banias-gan-hatsafon") return false;
  try {
    return decodeRoutePayload(entry.route)?.type === "hybrid_route_v6";
  } catch {
    return false;
  }
});
assert.ok(hybridEntry, "expected a current hybrid route in the catalog");
const hybrid = decode(hybridEntry.route, hybridEntry);
assert.ok(
  hybrid && Array.isArray(hybrid.geometry) && hybrid.geometry.length >= 2,
  "current hybrid base-graph route token should decode to geometry",
);

const segment = decode(SEGMENT_ROUTE);
assert.ok(
  segment && Array.isArray(segment.geometry) && segment.geometry.length >= 2,
  "segment-based route token should still decode",
);

const banias = catalog.entries.find((entry) => entry.slug === "banias-gan-hatsafon");
assert.ok(banias, "banias-gan-hatsafon should exist in the route catalog");
const baniasDecoded = decode(banias.route, banias);
assert.ok(
  baniasDecoded && Array.isArray(baniasDecoded.geometry) && baniasDecoded.geometry.length >= 2,
  "banias route should decode through the matching public snapshot fallback",
);

console.log("route-catalog base-graph decode test passed");
