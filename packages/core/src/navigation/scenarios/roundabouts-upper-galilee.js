import roundaboutsUpperGalilee from "./routes/roundabouts-upper-galilee.js";

// Snapshot of the shared route used to prove that reviewed OSM roundabouts
// become real navigation cues. The route crosses two complete roundabouts in
// its first 600 m, making it quick to inspect in SIM even at normal speed.
export default {
  name: "roundabouts-upper-galilee",
  description: "שתי כיכרות מאומתות בתחילת מסלול בגליל העליון",
  route: { routeState: roundaboutsUpperGalilee },
  track: { generate: { speedMps: 8, intervalMs: 1000, jitterM: 3, seed: 37 } },
  expect: [
    { type: "status", value: "navigating" },
    { type: "status", value: "off-route", never: true },
    { type: "wrong-way", never: true },
    { type: "banner", match: "בכיכר, המשיכו ישר", afterMeters: 40, beforeMeters: 180 },
    { type: "voice", match: "בכיכר, המשיכו ישר", atLeast: 2, beforeMeters: 530 },
    { type: "arrived" },
  ],
};
