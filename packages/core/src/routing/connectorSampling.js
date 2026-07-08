// Pure origin-grid generator for connector usage-frequency runs. Produces a
// square lattice clipped to a circle around the target, excluding the center,
// and coarsens spacing until the origin count fits `maxOrigins`.

const EARTH_RADIUS_M = 6371000;

function metersPerDegLat() {
  return (Math.PI / 180) * EARTH_RADIUS_M;
}

function metersPerDegLng(lat) {
  return (Math.PI / 180) * EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180);
}

function generate(center, radiusMeters, spacingMeters) {
  const origins = [];
  const mLat = metersPerDegLat();
  const mLng = metersPerDegLng(center.lat) || mLat;
  const steps = Math.floor(radiusMeters / spacingMeters);
  for (let iy = -steps; iy <= steps; iy++) {
    for (let ix = -steps; ix <= steps; ix++) {
      if (ix === 0 && iy === 0) continue;
      const dxM = ix * spacingMeters;
      const dyM = iy * spacingMeters;
      if (Math.hypot(dxM, dyM) > radiusMeters) continue;
      origins.push({
        lat: center.lat + dyM / mLat,
        lng: center.lng + dxM / mLng,
      });
    }
  }
  return origins;
}

export function buildOriginGrid(
  center,
  { radiusMeters = 2000, spacingMeters = 150, maxOrigins = 400 } = {},
) {
  let spacing = Math.max(1, spacingMeters);
  let origins = generate(center, radiusMeters, spacing);
  let capped = false;
  // Coarsen spacing (×1.25 per pass) until under the cap.
  while (origins.length > maxOrigins) {
    spacing *= 1.25;
    origins = generate(center, radiusMeters, spacing);
    capped = true;
  }
  return { origins, spacingMeters: spacing, radiusMeters, capped };
}
