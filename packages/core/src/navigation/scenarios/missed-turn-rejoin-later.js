import missedTurnGrid, { xy } from "./routes/missed-turn-grid.js";

function fixAt(xMeters, yMeters, timestamp, heading) {
  const point = xy(xMeters, yMeters);
  return {
    ...point,
    accuracy: 5,
    speed: 5,
    heading,
    timestamp,
  };
}

function buildFixes() {
  const fixes = [];
  let timestamp = 1000;
  const push = (xMeters, yMeters, heading) => {
    fixes.push(fixAt(xMeters, yMeters, (timestamp += 1000), heading));
  };

  for (let x = 0; x <= 600; x += 5) push(x, 0, 90);
  for (let x = 605; x <= 1200; x += 5) push(x, 0, 90);
  for (let y = 5; y <= 600; y += 5) push(1200, y, 0);
  return fixes;
}

// Rider misses the first northbound turn and keeps riding on a parallel lower
// road, then turns north later and rejoins the planned route farther ahead.
export default {
  name: "missed-turn-rejoin-later",
  description: "פספוס פנייה והתחברות מחדש בהמשך המסלול",
  route: { routeState: missedTurnGrid },
  track: { fixes: buildFixes() },
  expect: [
    { type: "status", value: "off-route", betweenMeters: [560, 900] },
    { type: "camera-stage", value: "off-route", betweenMeters: [560, 900] },
    { type: "card-mode", value: "off-route", betweenMeters: [560, 900] },
    { type: "chip", match: "חזרה למסלול" },
    { type: "haptic", kind: "heavy" },
    { type: "rerouted", withinFixesOfOffRoute: 10 },
    { type: "rejoin-target", position: "first", betweenMeters: [560, 700] },
    { type: "rejoin-target", position: "last", betweenMeters: [1450, 1550] },
    { type: "rejoin-target-advances", byMeters: 700 },
    { type: "camera-rotations", atMost: 0, during: "off-route" },
    { type: "camera-rotations", atMost: 1 },
    { type: "arrived" },
  ],
};
