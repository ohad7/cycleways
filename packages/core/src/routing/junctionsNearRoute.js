// Derive network junctions (nodes referenced by at least three distinct
// edges) that sit close to a route geometry. The route-segment grid keeps this
// cheap enough to run on-device after the relevant routing shards load.
import { distanceToLineSegment } from "../utils/distance.js";

const DEFAULT_MAX_DISTANCE_M = 50;
const CELL_DEG = 0.001;

function cellKey(latCell, lngCell) {
  return `${latCell}:${lngCell}`;
}

function pointFromNode(node) {
  const lng = Number(node?.coord?.[0]);
  const lat = Number(node?.coord?.[1]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function routePoint(point) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export function junctionsNearRoute(
  network,
  routeGeometry,
  { maxDistanceMeters = DEFAULT_MAX_DISTANCE_M } = {},
) {
  const nodes = Array.isArray(network?.nodes) ? network.nodes : [];
  const edges = Array.isArray(network?.edges) ? network.edges : [];
  const geometry = (Array.isArray(routeGeometry) ? routeGeometry : [])
    .map(routePoint)
    .filter(Boolean);
  const maxDistance = Number(maxDistanceMeters);
  if (
    nodes.length === 0 ||
    edges.length === 0 ||
    geometry.length === 0 ||
    !Number.isFinite(maxDistance) ||
    maxDistance < 0
  ) {
    return [];
  }

  const routeCells = new Map();
  for (let index = 1; index < geometry.length; index += 1) {
    const start = geometry[index - 1];
    const end = geometry[index];
    const segment = { start, end };
    // Visit cells along the whole segment. Route geometries are usually dense,
    // but decoded/synthetic routes are allowed to have long spans.
    const steps = Math.max(
      1,
      Math.ceil(
        Math.max(
          Math.abs(end.lat - start.lat),
          Math.abs(end.lng - start.lng),
        ) /
          (CELL_DEG / 2),
      ),
    );
    for (let step = 0; step <= steps; step += 1) {
      const fraction = step / steps;
      const key = cellKey(
        Math.round((start.lat + (end.lat - start.lat) * fraction) / CELL_DEG),
        Math.round((start.lng + (end.lng - start.lng) * fraction) / CELL_DEG),
      );
      if (!routeCells.has(key)) routeCells.set(key, []);
      const bucket = routeCells.get(key);
      if (bucket.at(-1) !== segment) bucket.push(segment);
    }
  }

  // Edges can appear in more than one shard. Count distinct edge ids so a
  // shard-boundary duplicate cannot turn a degree-2 road node into a junction.
  const nodeEdges = new Map();
  for (const edge of edges) {
    if (typeof edge?.id !== "string") continue;
    for (const nodeId of [edge.from, edge.to]) {
      if (typeof nodeId !== "string") continue;
      if (!nodeEdges.has(nodeId)) nodeEdges.set(nodeId, new Set());
      nodeEdges.get(nodeId).add(edge.id);
    }
  }
  const nodesById = new Map();
  for (const node of nodes) {
    if (typeof node?.id === "string" && !nodesById.has(node.id)) {
      nodesById.set(node.id, node);
    }
  }

  // At Israeli latitudes a 0.001-degree grid cell is at least ~80 m wide.
  // The configurable radius may exceed the default 50 m, so widen the cell
  // search instead of assuming adjacent cells are always sufficient.
  const cellRadius = Math.max(1, Math.ceil(maxDistance / 80));
  const junctions = [];
  for (const [nodeId, edgeIds] of nodeEdges) {
    if (edgeIds.size < 3) continue;
    const node = nodesById.get(nodeId);
    const point = pointFromNode(node);
    if (!point) continue;
    const latCell = Math.round(point.lat / CELL_DEG);
    const lngCell = Math.round(point.lng / CELL_DEG);
    let near = false;
    for (let dLat = -cellRadius; dLat <= cellRadius && !near; dLat += 1) {
      for (let dLng = -cellRadius; dLng <= cellRadius && !near; dLng += 1) {
        const bucket = routeCells.get(cellKey(latCell + dLat, lngCell + dLng));
        if (!bucket) continue;
        near = bucket.some(
          ({ start, end }) =>
            distanceToLineSegment(point, start, end) <= maxDistance,
        );
      }
    }
    if (near) junctions.push({ kind: "junction", ...point });
  }
  return junctions;
}
