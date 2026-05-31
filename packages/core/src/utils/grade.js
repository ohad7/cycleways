// Grade classification and smoothing utilities, ported from
// ~/projects/elevator/src/lib/grade.js.

export const GRADE_CLASSES = ["downhill", "easy", "steady", "hard", "brutal"];

export const GRADE_COLORS = {
  downhill: "#3e7fc8",
  easy: "#2fa14f",
  steady: "#c9a020",
  hard: "#d97520",
  brutal: "#c43030",
};

export const GRADE_LABELS_HE = {
  downhill: "ירידה",
  easy: "קל",
  steady: "יציב",
  hard: "קשה",
  brutal: "קשוח",
};

// Returns per-segment grade in percent. Output length = cum.length - 1.
export function segmentGrades(cum, ele) {
  const n = cum.length;
  const out = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const dx = cum[i + 1] - cum[i];
    const dy = ele[i + 1] - ele[i];
    out[i] = dx > 0 ? (dy / dx) * 100 : 0;
  }
  return out;
}

export function classifyGrade(gradePct) {
  if (gradePct < -1) return "downhill";
  if (gradePct < 2) return "easy";
  if (gradePct < 5) return "steady";
  if (gradePct < 9) return "hard";
  return "brutal";
}

// For each point, the grade over a centered distance window of ~windowM.
// The window shrinks at the route ends. Returns array length cum.length (%).
export function pointSmoothedGrades(cum, ele, windowM) {
  const n = cum.length;
  const half = windowM / 2;
  const out = new Array(n);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    while (lo < i && cum[i] - cum[lo] > half) lo++;
    while (hi < n - 1 && cum[hi] - cum[i] < half) hi++;
    const dx = cum[hi] - cum[lo];
    const dy = ele[hi] - ele[lo];
    out[i] = dx > 0 ? (dy / dx) * 100 : 0;
  }
  return out;
}
