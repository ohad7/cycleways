import assert from "node:assert/strict";
import { routeDetailModel } from "../apps/mobile/src/screens/routeDetailModel.js";

const entry = {
  name: "סובב בית הלל",
  regionName: "עמק החולה",
  summary: "מסלול קצר ונעים",
  description: "",
  notes: "",
  distanceKm: 6.5,
  elevationGainM: 12,
  elevationLossM: 12,
  difficulty: "easy",
  surfaceType: "paved",
};
const snapshot = { route: { distance: 6543, elevationGain: 15, elevationLoss: 14 } };

const m = routeDetailModel(entry, snapshot);
assert.equal(m.title, "סובב בית הלל");
assert.equal(m.kicker, "עמק החולה · מסלול מומלץ");
assert.equal(m.summary, "מסלול קצר ונעים");
// description falls back to summary when description+notes are empty
assert.equal(m.description, "מסלול קצר ונעים");
// snapshot metrics win: 6543m -> 6.5 km, gain 15, loss 14
const distance = m.stats.find((s) => s.label === "מרחק");
assert.equal(distance.value, "6.5 ק״מ");
const gain = m.stats.find((s) => s.label === "טיפוס");
assert.equal(gain.value, "15 מ׳");
// labels present, difficulty mapped to Hebrew, no empty entries
const labels = m.stats.map((s) => s.label);
assert.ok(labels.includes("מרחק"));
assert.ok(labels.includes("טיפוס"));
assert.ok(m.stats.every((s) => s.value && s.value.length > 0));
const difficulty = m.stats.find((s) => s.label === "דרגת קושי");
assert.equal(difficulty.value, "קל");

// Missing region → kicker is just the eyebrow; bare entry → no stats
const m2 = routeDetailModel({ name: "x" }, {});
assert.equal(m2.kicker, "מסלול מומלץ");
assert.equal(m2.stats.length, 0);

console.log("test-route-detail-model: ok");
