// Synthetic S route: a left turn followed about 40 m later by a right turn.
// The short middle leg is deliberately below the compound-cue window while
// remaining above the minimum turn spacing, so SIM exercises the same cue pair
// riders hear at tightly spaced junctions.
export default {
  points: [
    { id: "start", lat: 33.1, lng: 35.6 },
    { id: "left", lat: 33.1, lng: 35.6064 },
    { id: "right", lat: 33.10036, lng: 35.6064 },
    { id: "end", lat: 33.10036, lng: 35.6128 },
  ],
  selectedSegments: ["דרך הפרדס", "מעבר קצר", "שביל המזרח"],
  geometry: [
    { lat: 33.1, lng: 35.6 },
    { lat: 33.1, lng: 35.6016 },
    { lat: 33.1, lng: 35.6032 },
    { lat: 33.1, lng: 35.6048 },
    { lat: 33.1, lng: 35.6064 },
    { lat: 33.10036, lng: 35.6064 },
    { lat: 33.10036, lng: 35.608 },
    { lat: 33.10036, lng: 35.6096 },
    { lat: 33.10036, lng: 35.6112 },
    { lat: 33.10036, lng: 35.6128 },
  ],
  segmentSpans: [
    { startMeters: 0, endMeters: 600, name: "דרך הפרדס", cwSegmentId: 21, onNetwork: true, routeClass: "cycleway" },
    { startMeters: 600, endMeters: 640, name: "מעבר קצר", cwSegmentId: 22, onNetwork: true, routeClass: "path" },
    { startMeters: 640, endMeters: 1240, name: "שביל המזרח", cwSegmentId: 23, onNetwork: true, routeClass: "cycleway" },
  ],
  guidanceMode: "guidance-v1",
  guidanceSpans: [
    {
      startMeters: 0,
      endMeters: 600,
      guidanceIdentity: "way:orchard-road",
      name: "דרך הפרדס",
      role: "named-way",
      kind: "cycleway",
    },
    {
      startMeters: 600,
      endMeters: 640,
      guidanceIdentity: "standalone:short-passage",
      name: "מעבר קצר",
      role: "standalone",
      kind: "connector",
    },
    {
      startMeters: 640,
      endMeters: 1240,
      guidanceIdentity: "way:east-trail",
      name: "שביל המזרח",
      role: "named-way",
      kind: "cycleway",
    },
  ],
  distance: 1240,
};
