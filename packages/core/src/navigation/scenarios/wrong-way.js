import lTurn from "./routes/l-turn.js";

const LAT = 33.1;
const START_LNG = 35.6;
const METERS_PER_DEG_LNG = 111320 * Math.cos((LAT * Math.PI) / 180);

function fixAt(meters, timestamp, heading) {
  return {
    lat: LAT,
    lng: START_LNG + meters / METERS_PER_DEG_LNG,
    accuracy: 5,
    speed: 5,
    heading,
    timestamp,
  };
}

function buildFixes() {
  const fixes = [];
  let timestamp = 1000;
  for (let meters = 0; meters <= 200; meters += 5) {
    fixes.push(fixAt(meters, (timestamp += 1000), 90));
  }
  for (let meters = 195; meters >= 80; meters -= 5) {
    fixes.push(fixAt(meters, (timestamp += 1000), 270));
  }
  for (let meters = 85; meters <= 280; meters += 5) {
    fixes.push(fixAt(meters, (timestamp += 1000), 90));
  }
  return fixes;
}

// Starts normally from the route start, then turns around and rides backward
// along the first leg long enough for the sustained wrong-way warning, then
// resumes forward riding so the warning resolves.
export default {
  name: "wrong-way",
  description: "רכיבה בכיוון ההפוך ואז חזרה לכיוון המסלול",
  route: { routeState: lTurn },
  track: { fixes: buildFixes() },
  expect: [
    { type: "status", value: "navigating" },
    { type: "wrong-way" },
    { type: "wrong-way-resolved", final: true },
    {
      type: "banner",
      field: "wrongWayText",
      match: "המסלול בכיוון ההפוך - הסתובבו",
    },
    { type: "status", value: "off-route", never: true },
  ],
};
