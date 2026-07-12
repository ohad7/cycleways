import lTurn from "./routes/l-turn.js";

// Rider drifts up to 120 m off the first leg between ~250-450 m (a smooth
// leave-and-return arc), triggering off-route + a rejoin suggestion, then
// rejoins in time to get the turn cue.
export default {
  name: "off-route-excursion",
  description: "סטייה צדית מהמסלול וחזרה אליו",
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
    { type: "camera-stage", value: "off-route", betweenMeters: [230, 420] },
    { type: "card-mode", value: "off-route", betweenMeters: [230, 420] },
    { type: "chip", match: "חזרה למסלול" },
    { type: "haptic", kind: "heavy" },
    { type: "rerouted", withinFixesOfOffRoute: 10 },
    { type: "banner", match: "פנה שמאלה", afterMeters: 430 },
    // A guided rejoin leg is delivered during this excursion, so the frame
    // steers course-up along it instead of holding still.
    { type: "camera-rotations", atMost: 1, during: "off-route" },
    { type: "camera-rotations", atMost: 4 },
    { type: "arrived" },
  ],
};
