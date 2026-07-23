import sovevBeitHillel from "./routes/sovev-beit-hillel.js";

// Full clean ride over a real catalog route (snapshot). Real geometry means
// real cue density and real corner sharpness — expectations stay structural
// (no meter windows) because the geometry may be refreshed from the catalog.
export default {
  name: "sovev-beit-hillel-ride",
  description: "רכיבה מלאה על מסלול קטלוג אמיתי (סובב בית הלל)",
  route: { routeState: sovevBeitHillel },
  track: { generate: { speedMps: 8, intervalMs: 1000, jitterM: 6, seed: 21 } },
  expect: [
    { type: "status", value: "navigating" },
    { type: "current-road", match: "דרך עפר" },
    { type: "status", value: "off-route", never: true },
    { type: "arrived" },
  ],
};
