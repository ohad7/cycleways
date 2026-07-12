// Short real-network movement snapshot used while a different selected route
// remains more than 10 km away. This keeps the too-far journey visibly honest:
// the rider moves along a mapped road/path instead of interpolating across the
// regional overview toward the selected start.
export default {
  points: [
    { id: "start", lat: 33.045963, lng: 35.572792 },
    { id: "end", lat: 33.05002742928697, lng: 35.57283989857772 },
  ],
  selectedSegments: [],
  segmentSpans: [],
  distance: 470.4086034754551,
  geometry: [
    { lat: 33.045963, lng: 35.572792 },
    { lat: 33.04613, lng: 35.572756 },
    { lat: 33.04624, lng: 35.572495 },
    { lat: 33.046686, lng: 35.572547 },
    { lat: 33.047675, lng: 35.572589 },
    { lat: 33.04799, lng: 35.57251 },
    { lat: 33.049149, lng: 35.572693 },
    { lat: 33.049993, lng: 35.572834 },
    { lat: 33.05002742928697, lng: 35.57283989857772 },
  ],
};
