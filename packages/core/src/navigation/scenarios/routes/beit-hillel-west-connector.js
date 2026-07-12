// Snapshot of a real connector computed from the bundled routing graph on
// 2026-07-09. It follows the CycleWays/OSM network from the west side of Beit
// Hillel to the start of the Sovev Beit Hillel catalog route. Keeping this as
// geometry (rather than recomputing it in the harness) makes SIM, CAM, and the
// headless runner deterministic while still showing a route that exists on the
// real map.
export default {
  from: { lat: 33.217505625523486, lng: 35.60290063592721 },
  to: { lat: 33.217459062668354, lng: 35.60929916818715 },
  distanceMeters: 895.6928968178331,
  geometry: [
    { lat: 33.217505625523486, lng: 35.60290063592721 },
    { lat: 33.217685, lng: 35.602983 },
    { lat: 33.21809, lng: 35.603176 },
    { lat: 33.218254, lng: 35.603313 },
    { lat: 33.21859, lng: 35.603746 },
    { lat: 33.218706, lng: 35.603972 },
    { lat: 33.218766, lng: 35.604259 },
    { lat: 33.218881, lng: 35.604782 },
    { lat: 33.218888, lng: 35.605038 },
    { lat: 33.218627, lng: 35.606499 },
    { lat: 33.218531, lng: 35.607206 },
    { lat: 33.21855, lng: 35.607644 },
    { lat: 33.218608, lng: 35.607934 },
    { lat: 33.218668, lng: 35.608164 },
    { lat: 33.218757, lng: 35.60837 },
    { lat: 33.218865, lng: 35.60856 },
    { lat: 33.218949, lng: 35.608682 },
    { lat: 33.219076, lng: 35.608882 },
    { lat: 33.219129, lng: 35.609009 },
    { lat: 33.219135, lng: 35.609102 },
    { lat: 33.219096, lng: 35.609189 },
    { lat: 33.219002, lng: 35.609261 },
    { lat: 33.218829, lng: 35.609317 },
    { lat: 33.218752, lng: 35.609321 },
    { lat: 33.218655, lng: 35.609327 },
    { lat: 33.218586, lng: 35.609348 },
    { lat: 33.218558, lng: 35.609433 },
    { lat: 33.218559, lng: 35.609433 },
    { lat: 33.218493, lng: 35.609416 },
    { lat: 33.218412, lng: 35.609375 },
    { lat: 33.218323, lng: 35.609323 },
    { lat: 33.218146, lng: 35.609197 },
    { lat: 33.217791, lng: 35.608956 },
    { lat: 33.217721, lng: 35.609004 },
    { lat: 33.217459062668354, lng: 35.60929916818715 },
  ],
  edgeCosts: [
    {
      routeClass: "manual",
      roadType: "paved",
      cyclewaysSegmentIds: [301],
      distanceMeters: 750.1081921148183,
    },
    {
      routeClass: "road",
      roadType: null,
      cyclewaysSegmentIds: [304],
      distanceMeters: 96.6,
    },
    {
      routeClass: "path_track",
      roadType: null,
      cyclewaysSegmentIds: [101],
      distanceMeters: 48.984704703014756,
    },
  ],
};
