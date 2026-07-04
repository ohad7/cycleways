import sovevBeitHillel from "./routes/sovev-beit-hillel.js";

// Approach over the REAL routing network: the rider starts ~500 m west of the
// sovev-beit-hillel start, on a road the base network covers, so the app's
// connector computes an actual routed path (dashed suggestion line) instead
// of the beeline fallback the synthetic l-turn scenarios are limited to.
// tests/test-nav-approach-connector.mjs pins that this point really routes.
// The ride stops ~800 m in — the scenario demos the approach, not the tour.
export default {
  name: "approach-calculated-route",
  description: "התקרבות למסלול אמיתי — הצעת הגעה מחושבת על רשת הניתוב",
  route: { routeState: sovevBeitHillel },
  track: {
    generate: {
      speedMps: 5,
      intervalMs: 1000,
      jitterM: 6,
      seed: 17,
      approachFrom: { lat: 33.2175, lng: 35.6039 },
      stopAtMeters: 800,
    },
  },
  expect: [
    { type: "status", value: "approaching" },
    { type: "banner", match: "בדרך למסלול", field: "statusText" },
    { type: "acquired" },
    { type: "progress-at-least", meters: 700 },
  ],
};
