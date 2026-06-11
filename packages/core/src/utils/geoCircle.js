// Builds a GeoJSON Polygon approximating a circle of `radiusMeters` around a
// lat/lng — used to draw a location-accuracy ring as a plain fill layer
// (radius stays meter-accurate at every zoom, unlike a circle paint radius).
const EARTH_RADIUS_M = 6371e3;

export function circlePolygon(lat, lng, radiusMeters, steps = 64) {
  const ring = [];
  const latRad = (lat * Math.PI) / 180;
  const dLat = (radiusMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = dLat / Math.cos(latRad);
  for (let i = 0; i < steps; i += 1) {
    const theta = (2 * Math.PI * i) / steps;
    ring.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  ring.push(ring[0]);
  return { type: "Polygon", coordinates: [ring] };
}
