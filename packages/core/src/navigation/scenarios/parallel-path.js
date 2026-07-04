import lTurn from "./routes/l-turn.js";

// Rider follows a path parallel to the first leg — up to 25 m aside, same
// direction (a service road next to the cycleway). Common in real rides;
// must raise neither off-route (25 + 8 jitter < 38 m threshold) nor a
// wrong-way warning (general direction matches the route).
export default {
  name: "parallel-path",
  description: "רכיבה בשביל מקביל למסלול (עד 25 מ׳) — בלי אזהרות",
  route: { routeState: lTurn },
  track: {
    generate: {
      speedMps: 5,
      intervalMs: 1000,
      jitterM: 8,
      seed: 13,
      offRouteExcursion: { startMeters: 100, lengthMeters: 400, offsetMeters: 25 },
    },
  },
  expect: [
    { type: "status", value: "off-route", never: true },
    { type: "wrong-way", never: true },
    { type: "arrived" },
  ],
};
