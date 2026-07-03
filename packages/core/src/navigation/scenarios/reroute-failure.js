import lTurn from "./routes/l-turn.js";

// Same excursion as missed-turn-reroute, but every connector request fails —
// exercises the failure UX (rider still finds their own way back).
export default {
  name: "reroute-failure",
  description: "סטייה מהמסלול כשחישוב הצעת החזרה נכשל",
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
  connector: "fail",
  expect: [
    { type: "status", value: "off-route", betweenMeters: [230, 420] },
    { type: "suggestionFailed" },
    { type: "arrived" },
  ],
};
