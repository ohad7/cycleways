import assert from "node:assert/strict";
import { clusterByGrade } from "../src/utils/slopeClustering.js";

// Build a cum/ele pair: one entry per 50m, with a per-segment elevation delta
// supplied by the caller (length n-1).
function buildRoute(segDeltas, stepM = 50) {
  const cum = [0];
  const ele = [0];
  for (let i = 0; i < segDeltas.length; i++) {
    cum.push(cum[cum.length - 1] + stepM);
    ele.push(ele[ele.length - 1] + segDeltas[i]);
  }
  return { cum, ele };
}

// ── Single-class flat route → one "easy" cluster ─────────────────────────
{
  const { cum, ele } = buildRoute(new Array(20).fill(0)); // 20 × 50m = 1000m
  const clusters = clusterByGrade(cum, ele, { minDistanceM: 100 });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].gradeClass, "easy");
  assert.equal(clusters[0].startIdx, 0);
  assert.equal(clusters[0].endIdx, 20);
  assert.equal(clusters[0].distanceM, 1000);
}

// ── Two clusters with no merging ─────────────────────────────────────────
{
  // First 10 segments flat (500m, "easy"), next 10 climbing at 8% (500m, "hard")
  const segDeltas = [
    ...new Array(10).fill(0),       // flat: 0% grade
    ...new Array(10).fill(50 * 0.08) // 8% grade: 4m per 50m
  ];
  const { cum, ele } = buildRoute(segDeltas);
  const clusters = clusterByGrade(cum, ele, { minDistanceM: 100 });
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].gradeClass, "easy");
  assert.equal(clusters[1].gradeClass, "hard");
  assert.equal(clusters[0].distanceM, 500);
  assert.equal(clusters[1].distanceM, 500);
}

// ── Short cluster (< 100m) absorbed into longer neighbor ─────────────────
{
  // 10 flat segments (500m), then ONE 8% segment (50m, "hard"),
  // then 10 more flat segments (500m). The single hard segment is only
  // 50m so should be merged into a neighbor.
  const segDeltas = [
    ...new Array(10).fill(0),
    50 * 0.08, // one short "hard" bump: 50m
    ...new Array(10).fill(0),
  ];
  const { cum, ele } = buildRoute(segDeltas);
  const clusters = clusterByGrade(cum, ele, { minDistanceM: 100 });
  // After merging the 50m hard run into one of its neighbors and
  // coalescing same-class neighbors, we expect a single "easy" cluster.
  assert.equal(clusters.length, 1, `expected 1 cluster, got ${clusters.length}`);
  assert.equal(clusters[0].gradeClass, "easy");
  assert.equal(clusters[0].distanceM, 1050);
}

// ── avgGrade and gainM are computed per cluster ──────────────────────────
{
  // 10 segments at 8% (500m total, +40m gain)
  const segDeltas = new Array(10).fill(50 * 0.08);
  const { cum, ele } = buildRoute(segDeltas);
  const clusters = clusterByGrade(cum, ele, { minDistanceM: 100 });
  assert.equal(clusters.length, 1);
  assert.ok(Math.abs(clusters[0].avgGrade - 8) < 0.001);
  assert.ok(Math.abs(clusters[0].gainM - 40) < 0.001);
}

// ── Empty / single-point input → empty result ────────────────────────────
assert.deepEqual(clusterByGrade([], []), []);
assert.deepEqual(clusterByGrade([0], [10]), []);

console.log("test-slope-clustering.mjs: all assertions passed");
