import compoundTurnLeftRight from "./routes/compound-turn-left-right.js";

// SIM regression for closely spaced maneuvers: the first accepted instruction
// owns both turns and the second turn must not be announced again on its own.
export default {
  name: "compound-turn-left-right",
  description: "פנייה שמאלה ומיד ימינה, בהפרש של כ־40 מטר",
  route: { routeState: compoundTurnLeftRight },
  track: { generate: { speedMps: 5, intervalMs: 1000, jitterM: 2, seed: 41 } },
  expect: [
    { type: "status", value: "navigating" },
    { type: "status", value: "off-route", never: true },
    { type: "banner", match: "פנה שמאלה", afterMeters: 430, beforeMeters: 610 },
    { type: "banner", match: "פנה ימינה", afterMeters: 590, beforeMeters: 650 },
    { type: "voice", match: "פנה שמאלה אל מעבר קצר ומיד ימינה", atLeast: 1 },
    { type: "voice", match: "פנה ימינה אל שביל המזרח", never: true },
    { type: "arrived" },
  ],
};
