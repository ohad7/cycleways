import assert from "node:assert/strict";
import {
  analyzeBenchmark,
  formatReport,
  percentile,
  summarizeValues,
} from "../scripts/benchmark-osm-segment-matcher.mjs";

assert.equal(percentile([30, 10, 20], 0.5), 20);
assert.equal(percentile([10, 20, 30, 40], 0.95), 40);
assert.deepEqual(summarizeValues([10, 20, 30]), {
  medianMs: 20,
  p95Ms: 30,
  minMs: 10,
  maxMs: 30,
});

const records = [
  benchmarkRecord("62", 1000, 700, 40),
  benchmarkRecord("62", 1100, 720, 45),
  benchmarkRecord("276", 1050, 710, 80),
];
const report = analyzeBenchmark(records);

assert.equal(report.samples, 3);
assert.equal(report.wall.medianMs, 1050);
assert.equal(report.reusableGraphSetup.medianMs, 710);
assert.equal(report.workerCandidate.strength, "strong");
assert.equal(report.workerCandidate.medianSetupSharePercent, 67.6);
assert.equal(report.bySegment["62"].runs, 2);
assert.equal(report.bySegment["276"].segmentMatch.medianMs, 80);

const rendered = formatReport(report, {
  graph: "build/osm/osm-base-edges.geojson",
  segmentIds: ["62", "276"],
  runs: 2,
  warmup: 1,
});
assert.match(rendered, /read-only/);
assert.match(rendered, /Long-lived worker signal: STRONG/);
assert.match(rendered, /#276/);

console.log("OSM matcher benchmark tests passed");

function benchmarkRecord(segmentId, wallMs, reusableGraphSetupMs, segmentMatchMs) {
  return {
    segmentId,
    wallMs,
    performance: {
      reusableGraphSetupMs,
      measuredThroughResultAssemblyMs: wallMs - 50,
      phasesMs: {
        graphReadParse: reusableGraphSetupMs * 0.2,
        spatialIndexBuild: reusableGraphSetupMs * 0.5,
        connectivityIndexBuild: reusableGraphSetupMs * 0.3,
        segmentMatch: segmentMatchMs,
      },
    },
  };
}
