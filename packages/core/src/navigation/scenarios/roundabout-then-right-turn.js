import roundaboutThenRightTurn from "./routes/roundabout-then-right-turn.js";

// Exact shared-route regression: continue straight through the roundabout,
// then turn right only ~9 m after its exit. The compound instruction must own
// both maneuvers and the right turn must not be spoken a second time.
export default {
  name: "roundabout-then-right-turn",
  description: "ישר בכיכר ואז ימינה, כ־9 מטר אחרי היציאה",
  route: { routeState: roundaboutThenRightTurn },
  track: { generate: { speedMps: 5, intervalMs: 1000, jitterM: 2, seed: 73 } },
  expect: [
    { type: "status", value: "navigating" },
    { type: "status", value: "off-route", never: true },
    { type: "wrong-way", never: true },
    { type: "banner", match: "בכיכר, המשיכו ישר", afterMeters: 90, beforeMeters: 250 },
    { type: "voice", match: "בכיכר, המשיכו ישר, ואז פנו ימינה", atLeast: 1 },
    { type: "voice", match: "פנה ימינה", never: true },
    { type: "arrived" },
  ],
};
