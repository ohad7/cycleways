import lTurn from "./routes/l-turn.js";

// Clean ride from the route start to arrival; also covers the arrival
// milestone (no separate arrival scenario needed).
export default {
  name: "on-route-happy-path",
  description: "רכיבה נקייה מתחילת המסלול ועד היעד (מסלול L סינתטי)",
  route: { routeState: lTurn },
  track: { generate: { speedMps: 5, intervalMs: 1000, jitterM: 8, seed: 11 } },
  expect: [
    { type: "status", value: "navigating" },
    { type: "status", value: "off-route", never: true },
    { type: "wrong-way", never: true },
    { type: "banner", match: "פנה שמאלה", afterMeters: 430, beforeMeters: 600 },
    { type: "banner", match: "שביל הצפון" },
    { type: "arrived" },
  ],
};
