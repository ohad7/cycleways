// Visual-runner-only: replay a generic clean ride over whatever route is
// currently open in the Build screen (the old dev SIM button behavior).
export default {
  name: "current-route-generic",
  description: "רכיבה סימולטיבית על המסלול הפתוח כרגע",
  visualOnly: true,
  route: "current",
  track: { generate: { speedMps: 5, intervalMs: 1000, jitterM: 8, seed: 1 } },
  expect: [],
};
