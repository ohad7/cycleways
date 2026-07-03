import lTurn from "./routes/l-turn.js";

// GPS signal drops for ~150 m / 30 s mid-leg (timestamps jump); navigation
// must absorb the on-route jump without a false off-route. jitterM 0 keeps
// the gap's meter positions exact (see trackTools.cumulativeFixMeters).
export default {
  name: "gps-gap",
  description: "אובדן קליטת GPS באמצע המקטע הראשון — קפיצת זמן ומרחק על המסלול",
  route: { routeState: lTurn },
  track: {
    generate: { speedMps: 5, intervalMs: 1000, jitterM: 0, seed: 5 },
    gap: { startMeters: 300, endMeters: 450 },
  },
  expect: [
    { type: "status", value: "off-route", never: true },
    { type: "arrived" },
  ],
};
