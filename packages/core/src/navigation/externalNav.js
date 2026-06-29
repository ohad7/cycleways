// Pure builders for handing the approach leg off to a dedicated navigation app.
// Universal https links so the OS opens the installed app (else web/App Store).
// Google Maps in bicycling mode; Waze in its (car-only) navigate mode.

function valid(point) {
  return point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng));
}

export function buildExternalNavLinks(point) {
  if (!valid(point)) return null;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  const dest = `${lat}%2C${lng}`;
  return {
    googleMaps: `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=bicycling`,
    waze: `https://waze.com/ul?ll=${lat}%2C${lng}&navigate=yes`,
  };
}
