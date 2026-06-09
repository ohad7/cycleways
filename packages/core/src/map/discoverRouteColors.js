// Distinct, saturated colors for Discover/recommended route lines and their
// matching list swatches. Deliberately avoids the CW network's earth tones
// (teal-green / gray-blue / tan), the built-route blue, and the red/green
// waypoint dots. Assigned by list position (see plans/discover-route-colors).

export const DISCOVER_ROUTE_PALETTE = [
  "#e8590c", // orange
  "#ae3ec9", // magenta
  "#7048e8", // violet
  "#f59f00", // amber
  "#d6336c", // raspberry
  "#5f3dc4", // deep indigo
  "#f06595", // pink
  "#9c36b5", // purple
];

// Color for a route at the given list position; cycles the palette. Any
// non-integer or negative index falls back to the first color.
export function discoverRouteColor(index) {
  const n = DISCOVER_ROUTE_PALETTE.length;
  const i = Number.isInteger(index) && index >= 0 ? index % n : 0;
  return DISCOVER_ROUTE_PALETTE[i];
}
