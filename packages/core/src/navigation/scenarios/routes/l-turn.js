// Synthetic L-shaped scenario route: ~597 m due east, then a 90° left turn
// onto ~601 m due north. Geometry points every ~150 m keep bearings clean so
// exactly one turn cue is generated at the corner; the second segment span
// starts at the corner so its name merges onto the turn cue
// ("פנה שמאלה אל שביל הצפון"). Segment names are synthetic test fixtures.
export default {
  points: [
    { id: "start", lat: 33.1, lng: 35.6 },
    { id: "corner", lat: 33.1, lng: 35.6064 },
    { id: "end", lat: 33.1054, lng: 35.6064 },
  ],
  selectedSegments: ["דרך הפרדס", "שביל הצפון"],
  geometry: [
    { lat: 33.1, lng: 35.6 },
    { lat: 33.1, lng: 35.6016 },
    { lat: 33.1, lng: 35.6032 },
    { lat: 33.1, lng: 35.6048 },
    { lat: 33.1, lng: 35.6064 },
    { lat: 33.10135, lng: 35.6064 },
    { lat: 33.1027, lng: 35.6064 },
    { lat: 33.10405, lng: 35.6064 },
    { lat: 33.1054, lng: 35.6064 },
  ],
  segmentSpans: [
    { startMeters: 0, endMeters: 600, name: "דרך הפרדס", cwSegmentId: 1, onNetwork: true, routeClass: "cycleway" },
    { startMeters: 600, endMeters: 1200, name: "שביל הצפון", cwSegmentId: 2, onNetwork: true, routeClass: "path" },
  ],
  distance: 1198,
};
