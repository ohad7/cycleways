// Pure mapper from an Expo `Location.LocationObject` (or any {coords,timestamp}
// shape) to the route-progress engine's fix shape. Kept in core (platform-free)
// so it can be unit-tested without the native location stack.
//
// Expo reports -1 (and sometimes null) for unknown heading/speed; both normalize
// to null so the progress engine treats course/heading as unavailable rather
// than as a real 0.

function finiteOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nonNegativeOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function toNavigationFix(location) {
  const coords = location?.coords;
  if (!coords) return null;
  const lat = Number(coords.latitude);
  const lng = Number(coords.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    lat,
    lng,
    accuracy: nonNegativeOrNull(coords.accuracy),
    heading: nonNegativeOrNull(coords.heading),
    speed: nonNegativeOrNull(coords.speed),
    timestamp: finiteOrNull(location.timestamp),
  };
}
