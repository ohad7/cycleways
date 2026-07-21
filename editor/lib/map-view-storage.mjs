export const MAP_VIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseStoredMapView(
  value,
  { now = Date.now(), maxAgeMs = MAP_VIEW_MAX_AGE_MS } = {},
) {
  if (typeof value !== "string" || !value) return null;

  try {
    const stored = JSON.parse(value);
    const longitude = finiteNumber(stored?.center?.[0]);
    const latitude = finiteNumber(stored?.center?.[1]);
    const zoom = finiteNumber(stored?.zoom);
    const updatedAt = finiteNumber(stored?.updatedAt);
    const age = now - updatedAt;

    if (
      longitude === null ||
      longitude < -180 ||
      longitude > 180 ||
      latitude === null ||
      latitude < -90 ||
      latitude > 90 ||
      zoom === null ||
      zoom < 0 ||
      zoom > 24 ||
      updatedAt === null ||
      age < 0 ||
      age > maxAgeMs
    ) {
      return null;
    }

    return {
      center: [longitude, latitude],
      zoom,
    };
  } catch {
    return null;
  }
}

export function serializeMapView({ center, zoom, updatedAt = Date.now() }) {
  const longitude = finiteNumber(center?.lng ?? center?.[0]);
  const latitude = finiteNumber(center?.lat ?? center?.[1]);
  const normalizedZoom = finiteNumber(zoom);

  if (longitude === null || latitude === null || normalizedZoom === null) {
    return null;
  }

  return JSON.stringify({
    center: [longitude, latitude],
    zoom: normalizedZoom,
    updatedAt,
  });
}
