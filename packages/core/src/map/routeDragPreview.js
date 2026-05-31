// Pure builder for the route-point drag preview overlay (the rubber-band
// "guide" lines from the dragged point to its neighbors, plus a cursor point).
// Shared so web and the native iPhone map render the same preview from the
// controller's `routePointDragPreview` state. Mirrors the web implementation in
// src/map/mapLayers.product.js (kept in sync; logic identical).

export function buildRoutePointDragPreviewFeatureCollection(preview) {
  const empty = { type: "FeatureCollection", features: [] };
  const cursor = normalizePoint(preview);
  if (!cursor || !Array.isArray(preview?.points)) return empty;

  const points = preview.points.map(normalizePoint);
  const neighbors = dragPreviewNeighbors(points, preview);
  const lineFeatures = [];

  if (neighbors.previous) {
    lineFeatures.push(dragPreviewLineFeature(neighbors.previous, cursor));
  }
  if (neighbors.next) {
    lineFeatures.push(dragPreviewLineFeature(cursor, neighbors.next));
  }

  return {
    type: "FeatureCollection",
    features: [
      ...lineFeatures,
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [cursor.lng, cursor.lat],
        },
        properties: { kind: "cursor" },
      },
    ],
  };
}

function dragPreviewNeighbors(points, preview) {
  if (preview.mode === "insert") {
    const insertIndex = clampInteger(preview.insertIndex, 0, points.length);
    return {
      previous: points[insertIndex - 1] || null,
      next: points[insertIndex] || null,
    };
  }

  const index = clampInteger(preview.index, 0, points.length - 1);
  return {
    previous: points[index - 1] || null,
    next: points[index + 1] || null,
  };
}

function dragPreviewLineFeature(from, to) {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ],
    },
    properties: { kind: "guide" },
  };
}

function normalizePoint(point) {
  const lng = Number(point?.lng);
  const lat = Number(point?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
}

function clampInteger(value, min, max) {
  if (!Number.isInteger(value)) return min;
  return Math.max(min, Math.min(max, value));
}
