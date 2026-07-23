import lTurn from "./routes/l-turn.js";

// Rider starts ~500 m west of the route start: approach state, approach
// suggestion, acquisition announcement, then a normal ride.
export default {
  name: "approach-from-distance",
  description: "התחלה כ־500 מ׳ לפני תחילת המסלול — מצב התקרבות ורכישת המסלול",
  route: { routeState: lTurn },
  track: {
    generate: {
      speedMps: 5,
      intervalMs: 1000,
      jitterM: 8,
      seed: 12,
      approachFrom: { lat: 33.1, lng: 35.5947 },
    },
  },
  expect: [
    { type: "status", value: "approaching" },
    { type: "banner", match: "בדרך למסלול", field: "statusText" },
    { type: "acquired" },
    { type: "banner", match: "הניווט התחיל", field: "acquisitionText" },
    { type: "voice", match: "דרך הפרדס", atLeast: 1 },
    { type: "arrived" },
  ],
};
