import assert from "node:assert/strict";
import {
  GRADE_CLASSES,
  GRADE_COLORS,
  GRADE_LABELS_HE,
  classifyGrade,
  segmentGrades,
  pointSmoothedGrades,
} from "../src/utils/grade.js";

// ── GRADE_CLASSES ────────────────────────────────────────────────────────
assert.deepEqual(GRADE_CLASSES, ["downhill", "easy", "steady", "hard", "brutal"]);

// ── GRADE_COLORS ─────────────────────────────────────────────────────────
assert.equal(GRADE_COLORS.downhill, "#3e7fc8");
assert.equal(GRADE_COLORS.easy, "#2fa14f");
assert.equal(GRADE_COLORS.steady, "#c9a020");
assert.equal(GRADE_COLORS.hard, "#d97520");
assert.equal(GRADE_COLORS.brutal, "#c43030");

// ── GRADE_LABELS_HE ──────────────────────────────────────────────────────
assert.equal(GRADE_LABELS_HE.downhill, "ירידה");
assert.equal(GRADE_LABELS_HE.easy, "קל");
assert.equal(GRADE_LABELS_HE.steady, "יציב");
assert.equal(GRADE_LABELS_HE.hard, "קשה");
assert.equal(GRADE_LABELS_HE.brutal, "קשוח");

// ── classifyGrade ────────────────────────────────────────────────────────
assert.equal(classifyGrade(-5), "downhill");
assert.equal(classifyGrade(-1.01), "downhill");
assert.equal(classifyGrade(-1), "easy", "−1% is the boundary, classifies as easy");
assert.equal(classifyGrade(0), "easy");
assert.equal(classifyGrade(1.99), "easy");
assert.equal(classifyGrade(2), "steady", "2% is the boundary, classifies as steady");
assert.equal(classifyGrade(4.99), "steady");
assert.equal(classifyGrade(5), "hard", "5% is the boundary, classifies as hard");
assert.equal(classifyGrade(8.99), "hard");
assert.equal(classifyGrade(9), "brutal", "9% is the boundary, classifies as brutal");
assert.equal(classifyGrade(12), "brutal");

// ── segmentGrades ────────────────────────────────────────────────────────
{
  // cum is cumulative distance in meters; ele is elevation in meters
  // Two segments: flat 100m (0% grade), then +5m over 100m (5% grade)
  const cum = [0, 100, 200];
  const ele = [10, 10, 15];
  const grades = segmentGrades(cum, ele);
  assert.equal(grades.length, 2);
  assert.equal(grades[0], 0);
  assert.equal(grades[1], 5);
}

{
  // Zero-distance segment returns 0% grade (avoid division by zero)
  const grades = segmentGrades([0, 0, 100], [10, 20, 30]);
  assert.equal(grades[0], 0);
  assert.equal(grades[1], 10);
}

// ── pointSmoothedGrades ──────────────────────────────────────────────────
{
  // Linear climb: 1000m climbing at constant 5% — every smoothed grade ≈ 5%
  const cum = [];
  const ele = [];
  for (let i = 0; i <= 100; i++) {
    cum.push(i * 10);
    ele.push(i * 0.5); // 0.5m per 10m = 5%
  }
  const smoothed = pointSmoothedGrades(cum, ele, 200);
  assert.equal(smoothed.length, cum.length);
  for (let i = 0; i < smoothed.length; i++) {
    assert.ok(
      Math.abs(smoothed[i] - 5) < 0.001,
      `expected ~5% at index ${i}, got ${smoothed[i]}`,
    );
  }
}

{
  // Smoothing reduces noise: noisy ele values around a flat trend
  // Window covers all points; result at midpoint should average toward 0
  const cum = [0, 50, 100, 150, 200];
  const ele = [0, 10, 0, -10, 0]; // oscillates around 0
  const smoothed = pointSmoothedGrades(cum, ele, 1000);
  // Window is huge so each point sees the whole array; lo=0, hi=4
  // dx=200, dy=0 → 0% grade everywhere
  for (const g of smoothed) {
    assert.ok(Math.abs(g) < 0.001, `expected ~0% smoothed, got ${g}`);
  }
}

console.log("test-grade.mjs: all assertions passed");
