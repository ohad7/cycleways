import lTurn from "./routes/l-turn.js";

const LAT = 33.1;
const START_LNG = 35.6;
const METERS_PER_DEG_LAT = 111320;
const METERS_PER_DEG_LNG = 111320 * Math.cos((LAT * Math.PI) / 180);

function fixAt(xMeters, yMeters, timestamp, heading) {
  return {
    lat: LAT + yMeters / METERS_PER_DEG_LAT,
    lng: START_LNG + xMeters / METERS_PER_DEG_LNG,
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
  for (let x = 605; x <= 850; x += 5) push(x, 0, 90);
  for (let x = 845; x >= 600; x -= 5) push(x, 0, 270);
  for (let y = 5; y <= 600; y += 5) push(600, y, 0);
  return fixes;
}

// Rider misses the left turn, keeps going straight, follows the rejoin guidance
// back to the missed turn, then resumes the planned route.
export default {
  name: "missed-turn-reroute",
  description: "פספוס פנייה, חזרה לנקודת הפנייה, והמשך במסלול",
  route: { routeState: lTurn },
  track: { fixes: buildFixes() },
  expect: [
    { type: "status", value: "off-route", betweenMeters: [560, 660] },
    { type: "camera-stage", value: "off-route", betweenMeters: [560, 660] },
    { type: "card-mode", value: "off-route", betweenMeters: [560, 660] },
    { type: "chip", match: "חזרה למסלול" },
    { type: "haptic", kind: "heavy" },
    { type: "rerouted", withinFixesOfOffRoute: 10 },
    { type: "rejoin-target", position: "first", betweenMeters: [560, 660] },
    { type: "rejoin-target", position: "last", betweenMeters: [560, 700] },
    { type: "camera-rotations", atMost: 0, during: "off-route" },
    { type: "camera-rotations", atMost: 1 },
    { type: "arrived" },
  ],
};
