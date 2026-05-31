import { segmentGrades, classifyGrade } from "./grade.js";

// Greedy: classify each segment, run-length encode into clusters, then merge
// clusters shorter than minDistanceM into the neighbor with greater length.
// Ported from ~/projects/elevator/src/lib/clustering.js.
export function clusterByGrade(cum, ele, opts = {}) {
  const minDistanceM = opts.minDistanceM ?? 100;
  const n = cum.length;
  if (n < 2) return [];

  const seg = segmentGrades(cum, ele); // length n-1
  const classes = seg.map(classifyGrade);

  // run-length encode
  let runs = [];
  let i = 0;
  while (i < classes.length) {
    let j = i;
    while (j + 1 < classes.length && classes[j + 1] === classes[i]) j++;
    runs.push({ startSeg: i, endSeg: j, cls: classes[i] });
    i = j + 1;
  }

  // merge short runs
  let changed = true;
  while (changed && runs.length > 1) {
    changed = false;
    for (let k = 0; k < runs.length; k++) {
      const r = runs[k];
      const dist = cum[r.endSeg + 1] - cum[r.startSeg];
      if (dist >= minDistanceM) continue;
      const left = k > 0 ? runs[k - 1] : null;
      const right = k < runs.length - 1 ? runs[k + 1] : null;
      let mergeWith;
      if (!left) mergeWith = "right";
      else if (!right) mergeWith = "left";
      else {
        const lDist = cum[left.endSeg + 1] - cum[left.startSeg];
        const rDist = cum[right.endSeg + 1] - cum[right.startSeg];
        mergeWith = lDist >= rDist ? "left" : "right";
      }
      if (mergeWith === "left") {
        runs[k - 1] = { startSeg: left.startSeg, endSeg: r.endSeg, cls: left.cls };
        runs.splice(k, 1);
      } else {
        runs[k] = { startSeg: r.startSeg, endSeg: right.endSeg, cls: right.cls };
        runs.splice(k + 1, 1);
      }
      changed = true;
      break; // restart pass — indices shifted
    }
  }

  // Coalesce adjacent same-class runs (merging can produce e.g. hard | hard
  // after a short cluster collapses).
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && last.cls === r.cls) last.endSeg = r.endSeg;
    else merged.push({ ...r });
  }

  return merged.map((r) => {
    const startIdx = r.startSeg;
    const endIdx = r.endSeg + 1;
    const distanceM = cum[endIdx] - cum[startIdx];
    const dy = ele[endIdx] - ele[startIdx];
    const gainM = Math.max(0, dy);
    const avgGrade = distanceM > 0 ? (dy / distanceM) * 100 : 0;
    return {
      startIdx,
      endIdx,
      distanceM,
      avgGrade,
      gainM,
      gradeClass: classifyGrade(avgGrade),
    };
  });
}
