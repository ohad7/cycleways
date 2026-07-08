export const PENDING_RIDE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function validPoint(point) {
  return Boolean(
    point &&
      Number.isFinite(Number(point.lat)) &&
      Number.isFinite(Number(point.lng)),
  );
}

export function normalizePendingRideIntent(value, now = Date.now()) {
  if (!value || typeof value !== "object") return null;
  const timestamp = Number(value.timestamp);
  if (
    !Number.isFinite(timestamp) ||
    timestamp > now ||
    now - timestamp > PENDING_RIDE_MAX_AGE_MS
  ) {
    return null;
  }
  if (typeof value.routeToken !== "string" || value.routeToken.length === 0) return null;
  const direction = value.direction === "reverse" ? "reverse" : "forward";
  const startMode = ["official", "nearest", "custom"].includes(value.startMode)
    ? value.startMode
    : "official";
  if (startMode === "custom" && !validPoint(value.selectedPoint)) return null;
  const startProgressMeters = Number(value.startProgressMeters);
  return {
    routeToken: value.routeToken,
    slug: typeof value.slug === "string" ? value.slug : null,
    name: typeof value.name === "string" ? value.name : null,
    direction,
    startMode,
    startProgressMeters:
      Number.isFinite(startProgressMeters) && startProgressMeters >= 0
        ? startProgressMeters
        : null,
    selectedPoint: validPoint(value.selectedPoint)
      ? { lat: Number(value.selectedPoint.lat), lng: Number(value.selectedPoint.lng) }
      : null,
    timestamp,
  };
}
