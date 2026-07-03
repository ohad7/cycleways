import lTurn from "./routes/l-turn.js";

// Rider stops for 90 s at ~300 m (zero speed, small GPS wander). Standing
// still must not trigger off-route or regress progress.
export default {
  name: "stop-and-stand",
  description: "עצירה של 90 שניות באמצע המסלול — בלי סטייה כוזבת",
  route: { routeState: lTurn },
  track: {
    generate: { speedMps: 5, intervalMs: 1000, jitterM: 0, seed: 6 },
    dwell: { atMeters: 300, durationMs: 90000, intervalMs: 1000, jitterM: 3, seed: 6 },
  },
  expect: [
    { type: "status", value: "off-route", never: true },
    { type: "arrived" },
  ],
};
