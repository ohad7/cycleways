import lTurn from "./routes/l-turn.js";

// Rider drifts up to 120 m off the first leg between ~250-450 m (a smooth
// leave-and-return arc), triggering off-route + a rejoin suggestion, then
// rejoins in time to get the turn cue.
export default {
  name: "missed-turn-reroute",
  description: "סטייה של עד 120 מ׳ מהמסלול — זיהוי סטייה, הצעת חזרה, וחזרה למסלול",
  route: { routeState: lTurn },
  track: {
    generate: {
      speedMps: 5,
      intervalMs: 1000,
      jitterM: 8,
      seed: 3,
      offRouteExcursion: { startMeters: 250, lengthMeters: 200, offsetMeters: 120 },
    },
  },
  expect: [
    { type: "status", value: "off-route", betweenMeters: [230, 420] },
    { type: "haptic", kind: "heavy" },
    { type: "rerouted", withinFixesOfOffRoute: 10 },
    { type: "banner", match: "פנה שמאלה", afterMeters: 430 },
    // The map frame must hold perfectly still while the rider is off-route.
    { type: "camera-rotations", atMost: 0, during: "off-route" },
    { type: "camera-rotations", atMost: 3 },
    { type: "arrived" },
  ],
};
