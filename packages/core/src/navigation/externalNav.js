// Registry of dedicated navigation apps the rider can hand the approach leg off
// to. iOS has no system nav-chooser, so the native layer probes each app with
// Linking.canOpenURL(probeUrl) (apps with alwaysAvailable skip the probe) and
// shows a WhatsApp-style list of those installed. buildUrl(point) returns the
// per-app navigation URL to a { lat, lng }.

function valid(point) {
  return (
    point &&
    Number.isFinite(Number(point.lat)) &&
    Number.isFinite(Number(point.lng))
  );
}

export const EXTERNAL_NAV_APPS = [
  {
    id: "apple-maps",
    label: "Apple Maps",
    probeUrl: "maps://",
    alwaysAvailable: true,
    buildUrl: (lat, lng) => `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`,
  },
  {
    id: "google-maps",
    label: "Google Maps",
    probeUrl: "comgooglemaps://",
    buildUrl: (lat, lng) =>
      `comgooglemaps://?daddr=${lat},${lng}&directionsmode=bicycling`,
  },
  {
    id: "waze",
    label: "Waze",
    probeUrl: "waze://",
    buildUrl: (lat, lng) => `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
  },
  {
    id: "moovit",
    label: "Moovit",
    probeUrl: "moovit://",
    buildUrl: (lat, lng) =>
      `moovit://directions?dest_lat=${lat}&dest_lon=${lng}`,
  },
];

// Build the navigation URL for one app to a destination point, or null when the
// point is invalid.
export function buildAppUrl(app, point) {
  if (!app || typeof app.buildUrl !== "function" || !valid(point)) return null;
  return app.buildUrl(Number(point.lat), Number(point.lng));
}
