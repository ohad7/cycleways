import assert from "node:assert/strict";
import { clusterByGrade } from "../src/utils/slopeClustering.js";
import { classifyGrade } from "../src/utils/grade.js";

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

// ── Short cluster absorbed into the LONGER neighbor (asymmetric) ─────────
{
  // Asymmetric neighbours with DIFFERENT classes so the merge direction is
  // observable in the final cluster list:
  //
  //   4 segments easy   (200m), 0% grade
  //   1 segment  hard   ( 50m), 6% grade   ← short run to be absorbed
  //  10 segments steady (500m), 3% grade
  //
  // With minDistanceM=100, the 50m hard run is too short and must merge
  // into its LONGER neighbour (steady, 500m), not the shorter one
  // (easy, 200m). This pins down the `lDist >= rDist` tie-break — if it
  // were flipped to `<`, the hard run would merge LEFT into easy instead
  // and the cluster shape below would change.
  const segDeltas = [
    ...new Array(4).fill(0),         // easy: 0% → 0m delta per 50m
    50 * 0.06,                       // hard: 6% → 3m delta over 50m
    ...new Array(10).fill(50 * 0.03) // steady: 3% → 1.5m delta per 50m
  ];
  const { cum, ele } = buildRoute(segDeltas);
  const clusters = clusterByGrade(cum, ele, { minDistanceM: 100 });

  // After merging the hard bump RIGHT into steady:
  //   cluster 0: easy, segments 0..3, 200m
  //   cluster 1: steady, segments 4..14, 550m
  // The recomputed avgGrade for cluster 1 is a weighted average over the
  // merged span: dy = 3 + 10 * 1.5 = 18m over 550m → (18/550)*100 ≈ 3.27%,
  // which stays inside the steady band (2% ≤ g < 5%).
  assert.equal(clusters.length, 2, `expected 2 clusters, got ${clusters.length}`);
  assert.equal(clusters[0].gradeClass, "easy", "first cluster should be easy");
  assert.equal(clusters[0].distanceM, 200, "easy cluster should retain its 200m length");
  assert.equal(
    clusters[1].gradeClass,
    "steady",
    "short hard run must merge RIGHT into steady (the longer neighbour)"
  );
  assert.equal(
    clusters[1].distanceM,
    550,
    "steady cluster should absorb the 50m hard bump (500m + 50m = 550m)"
  );
  // Sanity-check the weighted-average grade lands in the steady band.
  assert.ok(
    clusters[1].avgGrade >= 2 && clusters[1].avgGrade < 5,
    `merged avgGrade ${clusters[1].avgGrade} should fall in steady band [2,5)`
  );

  // ── Gap B: gradeClass must be RECOMPUTED from avgGrade, not carried
  // forward from the run's original cls. After the merge above, the run
  // object on the right cluster has cls === "steady" (inherited from the
  // larger neighbour) which happens to match here, but for every cluster
  // we still want to assert the property directly.
  for (const c of clusters) {
    assert.equal(
      c.gradeClass,
      classifyGrade(c.avgGrade),
      `gradeClass must equal classifyGrade(avgGrade) for ${JSON.stringify(c)}`
    );
  }
}

// ── gradeClass is recomputed from avgGrade after a merge flips the class ──
{
  // Construct a case where the merged run's avgGrade lands in a DIFFERENT
  // class from the run's stored `cls`, so carrying `cls` forward would be
  // visibly wrong.
  //
  //   2 segments hard (100m), 6% grade   ← the larger neighbour; cls = "hard"
  //   1 segment  easy ( 50m), 0% grade   ← short run to be absorbed LEFT
  //
  // With minDistanceM=100, the 50m easy run merges LEFT into the 100m hard
  // run (the only neighbour). Resulting run has cls = "hard" but the
  // recomputed avgGrade is dy = 3 + 3 + 0 = 6m over 150m → 4.0% → "steady".
  // If gradeClass were `r.cls`, this cluster would report "hard"; the
  // recomputation produces "steady". This locks in the correct behaviour.
  const segDeltas = [
    50 * 0.06, // hard segment 1
    50 * 0.06, // hard segment 2
    0,         // easy bump
  ];
  const { cum, ele } = buildRoute(segDeltas);
  const clusters = clusterByGrade(cum, ele, { minDistanceM: 100 });

  assert.equal(clusters.length, 1, `expected 1 cluster, got ${clusters.length}`);
  assert.equal(clusters[0].distanceM, 150);
  // dy = 6m over 150m = 4.0% → steady (NOT the run's stored cls of "hard")
  assert.ok(
    Math.abs(clusters[0].avgGrade - 4) < 0.001,
    `expected avgGrade ≈ 4%, got ${clusters[0].avgGrade}`
  );
  assert.equal(
    clusters[0].gradeClass,
    "steady",
    "gradeClass must be recomputed from avgGrade (steady), not inherited from run.cls (hard)"
  );
  assert.equal(clusters[0].gradeClass, classifyGrade(clusters[0].avgGrade));
}

// ── Empty / single-point input → empty result ────────────────────────────
assert.deepEqual(clusterByGrade([], []), []);
assert.deepEqual(clusterByGrade([0], [10]), []);

console.log("test-slope-clustering.mjs: all assertions passed");
