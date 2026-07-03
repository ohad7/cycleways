import rideRealistic from "./recorded/ride-realistic.js";

// Replay of a real recorded ride (approach, jittery riding, a pause, and a
// GPS jump — see the fixture provenance header). Milestones mirror the ones
// asserted in tests/test-navigation-replay.mjs.
export default {
  name: "recorded-real-ride",
  description: "שחזור רכיבה אמיתית שהוקלטה בשטח (התקרבות, רעש GPS, קפיצה)",
  route: { routeState: rideRealistic.routeState },
  track: { fixes: rideRealistic.fixes },
  expect: [
    { type: "status", value: "approaching" },
    { type: "acquired" },
    { type: "progress-at-least", meters: 800 },
    { type: "arrived" },
  ],
};
