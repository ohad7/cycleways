import assert from "node:assert/strict";
import { buildLiveDecodeRoute } from "../editor/server.mjs";

// Regression: the catalog recompute/promote decoder must handle base-graph
// route tokens (hybrid_route_v6), not only segment-based (compact_route) ones.
// Tokens are fixtures captured from the current promoted base graph.
const HYBRID_BASE_GRAPH_ROUTE =
  "VjDH1VcUfWNfBnydX8kpJAuNYXinx5y9R9sGULYewn28HS2xCYK55eeWnG12LtfhB2KJyxHE7V9Kwe6VAbubnaLzJD9ntj5v1jiCbC9Gh2khxXDy7rTvAGUodsVuqSmUCNHwUN1rowfNkFxsAeJxKxSNvgz9h4xCmLFBbN9T6vEpsft4omxwkDYi3jUFHqsb3B8Q69iCh2ziNVuUo1uaLks8sDBYdafk5iEVqqURx5n9Wsonh3kjX5Hk7HKoNfMmHigkuxwgbVKGrZQf15CZH1WuWLnZeE3UyourE27VmCuRfR76fewcrpny6V7TRkFSoWj2qHqQdptCLRPmuFrdX3ELb2xksktFCWkHLWr7WXs4zzCv";
const SEGMENT_ROUTE = "DvsVvkJ2SiQeaAkhgGPtCZde8S8Q8xGxbG4BSY7c32agaEz219fTkrW2ZA";

const decode = await buildLiveDecodeRoute();

const hybrid = decode(HYBRID_BASE_GRAPH_ROUTE);
assert.ok(
  hybrid && Array.isArray(hybrid.geometry) && hybrid.geometry.length >= 2,
  "hybrid base-graph route token should decode to geometry",
);

const segment = decode(SEGMENT_ROUTE);
assert.ok(
  segment && Array.isArray(segment.geometry) && segment.geometry.length >= 2,
  "segment-based route token should still decode",
);

console.log("route-catalog base-graph decode test passed");
