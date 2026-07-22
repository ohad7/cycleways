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
    { type: "voice", match: "רִכְבוּ בִּזְהִירוּת", count: 1 },
    { type: "banner", match: "פנה שמאלה", afterMeters: 430, beforeMeters: 600 },
    { type: "banner", match: "שביל הצפון" },
    { type: "voice", match: "שביל הצפון", atLeast: 1 },
    { type: "banner", match: "בעוד 200 מטרים תגיע ליעד" },
    { type: "voice", match: "בעוד 200 מטרים תגיע ליעד", count: 1 },
    { type: "camera-rotations", atMost: 2 },
    { type: "camera-stage", value: "pre-turn", betweenMeters: [430, 600] },
    { type: "camera-stage", value: "arrived-local" },
    { type: "camera-stage", value: "off-route", never: true },
    { type: "card-mode", value: "status" },
    { type: "card-mode", value: "cue", betweenMeters: [430, 600] },
    { type: "card-mode", value: "arrived" },
    { type: "chip", match: "דרך הפרדס" },
    { type: "arrived" },
  ],
};
