import baniasGanHatsafon from "./routes/banias-gan-hatsafon.js";

// Approach over the REAL routing network: the rider starts ~570 m east of the
// banias-gan-hatsafon start, on a road the base network covers, so the app's
// connector computes an actual routed path (dashed suggestion line) instead
// of the beeline fallback the synthetic l-turn scenarios are limited to.
// tests/test-nav-approach-connector.mjs pins that this point really routes.
// The ride stops ~800 m in — the scenario demos the approach, not the tour.
export default {
  name: "approach-calculated-route",
  description: "התקרבות למסלול אמיתי — הצעת הגעה מחושבת על רשת הניתוב",
  route: { routeState: baniasGanHatsafon },
  track: {
    generate: {
      speedMps: 5,
      intervalMs: 1000,
      jitterM: 6,
      seed: 17,
      approachFrom: { lat: 33.188144, lng: 35.622791 },
      stopAtMeters: 800,
    },
  },
  expect: [
    { type: "status", value: "approaching" },
    { type: "banner", match: "בדרך למסלול", field: "statusText" },
    { type: "camera-stage", value: "approach" },
    { type: "card-mode", value: "approach" },
    { type: "chip", match: "המסלול המוצע" },
    { type: "acquired" },
    // Loop route (start == end): navigation must begin at the START vertex,
    // never acquire at the shared end and read the ride as backwards.
    { type: "status", value: "navigating", betweenMeters: [0, 100] },
    { type: "camera-stage", value: "ride" },
    { type: "card-mode", value: "status" },
    { type: "wrong-way", never: true },
    { type: "progress-at-least", meters: 700 },
  ],
};
