// Pure presentation helpers for the planner segment card.

// Map a segment's road type to the line-icon name used as the no-photo
// fallback glyph. The three road types come from the cycleway geojson
// (`properties.roadType`): "paved" (cycleway), "dirt", "road". Unknown / missing
// types fall back to the trail-sign glyph, a neutral path marker.
const ROAD_TYPE_ICONS = {
  paved: "bicycle-outline",
  dirt: "trail-sign-outline",
  road: "car-outline",
};

export function segmentRoadTypeIcon(roadType) {
  return ROAD_TYPE_ICONS[roadType] || "trail-sign-outline";
}
