import assert from "node:assert/strict";
import { createDemoProject } from "../scripts/demo-studio/projectState.mjs";
import { gpsCoverageForClip, proofWindowFor } from "../scripts/demo-studio/pipeline.mjs";
import { normalizeRideFixes, normalizeRideFixesWithRecovery } from "../scripts/demo-studio/normalizeFixes.mjs";

const rows = [
  { timeSeconds: 0, measureMode: 3, latitude: 33, longitude: 35, speed: 0 },
  { timeSeconds: 1, measureMode: 3, latitude: 33.00001, longitude: 35.00001, speed: 2 },
  { timeSeconds: 2, measureMode: 0, latitude: 0, longitude: 0 },
  { timeSeconds: 3, measureMode: 3, latitude: 40, longitude: 50, speed: 2 },
  { timeSeconds: 5, measureMode: 3, latitude: 33.00003, longitude: 35.00003, speed: 0 },
];
const result = normalizeRideFixes(rows, { trimInSeconds: 0, trimOutSeconds: 7, gpsOffsetSeconds: 1.3, maxTeleportKmh: 100 });
assert.deepEqual(result.fixes.map((fix) => fix.timestamp), [1300, 2300, 6300]);
assert.equal(result.cleanup.dropped.noLock, 1);
assert.equal(result.cleanup.dropped.teleport, 1);
assert.equal(result.fixes[2].heading, result.fixes[1].heading, "stationary heading remains stable");
assert.ok(result.warnings.some((warning) => warning.code === "gps-gap"));

const poisoned = [
  { timeSeconds: 0, measureMode: 3, latitude: 1, longitude: 1 },
  { timeSeconds: 1, measureMode: 3, latitude: 32.1, longitude: 34.8 },
  { timeSeconds: 2, measureMode: 3, latitude: 32.10001, longitude: 34.80001 },
  { timeSeconds: 3, measureMode: 3, latitude: 32.10002, longitude: 34.80002 },
];
assert.throws(
  () => normalizeRideFixes(poisoned, { maxTeleportKmh: 100 }),
  /fewer than two usable GPS fixes/,
  "a bad first sample can poison the normal greedy pass",
);
const recovered = normalizeRideFixesWithRecovery(poisoned, { maxTeleportKmh: 100 });
assert.equal(recovered.fixes.length, 3);
assert.deepEqual(
  recovered.recovery,
  {
    kind: "largest-coherent-run",
    inputRows: 4,
    recoveredRows: 3,
    fromSeconds: 1,
    toSeconds: 3,
  },
);

const gpsCoverage = gpsCoverageForClip(
  [
    { timestamp: 5_000 },
    { timestamp: 6_000 },
    { timestamp: 30_000 },
    { timestamp: 31_000 },
  ],
  { inMs: 100_000, outMs: 140_000, sourceInMs: 0, sourceOutMs: 40_000 },
  "clip-2",
);
assert.deepEqual(gpsCoverage.coverage, [
  { sourceId: "clip-2", inMs: 105_000, outMs: 106_000 },
  { sourceId: "clip-2", inMs: 130_000, outMs: 131_000 },
]);
assert.deepEqual(
  gpsCoverage.warnings.map(({ code, severity, fromMs, toMs }) => ({ code, severity, fromMs, toMs })),
  [
    { code: "gps-unavailable", severity: "blocking-showcase", fromMs: 100_000, toMs: 105_000 },
    { code: "gps-unavailable", severity: "blocking-showcase", fromMs: 106_000, toMs: 130_000 },
    { code: "gps-unavailable", severity: "blocking-showcase", fromMs: 131_000, toMs: 140_000 },
  ],
);

const trimmed = createDemoProject({ id: "trimmed-proof", sourcePath: "/tmp/ride.mp4", routeValue: "route" });
trimmed.inputs.source.trim = { inSeconds: 7, outSeconds: 390 };
trimmed.inputs.story.proof = { inMs: 6006, outMs: 186006, preRollMs: 0 };
assert.deepEqual(
  proofWindowFor(trimmed, [{ timeSeconds: 6.006 }, { timeSeconds: 390 }], 390),
  { inMs: 7000, outMs: 186006, preRollMs: 0 },
  "changing the usable source trim rebases an older showcase start without exposing negative pre-roll",
);

console.log("demo fix normalization tests passed");
