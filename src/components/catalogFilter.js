const DISTANCE_BUCKETS = ["short", "medium", "long"];
const DIFFICULTY_BUCKETS = ["easy", "moderate", "hard"];

function distanceBucketOf(km) {
  if (km < 10) return "short";
  if (km <= 25) return "medium";
  return "long";
}

function bucketScore(actualBucket, requestedBucket, buckets) {
  if (requestedBucket === "any" || requestedBucket == null) return 0;
  if (actualBucket === requestedBucket) return 3;
  const ai = buckets.indexOf(actualBucket);
  const ri = buckets.indexOf(requestedBucket);
  if (ai >= 0 && ri >= 0 && Math.abs(ai - ri) === 1) return 1;
  return 0;
}

function styleScore(actual, requested) {
  if (requested === "any" || requested == null) return 0;
  return actual === requested ? 3 : 0;
}

export function catalogFilter(catalog, answers) {
  const want = answers || {};

  const hardFiltered = catalog.filter((entry) => {
    if (want.place && want.place !== "any") {
      if (!Array.isArray(entry.passesNear) || !entry.passesNear.includes(want.place)) {
        return false;
      }
    }
    if (want.region && want.region !== "any") {
      if (entry.regionId !== want.region) return false;
    }
    return true;
  });

  const scored = hardFiltered.map((entry) => {
    const distBucket = distanceBucketOf(entry.distanceKm);
    const score =
      bucketScore(distBucket, want.distance, DISTANCE_BUCKETS) +
      bucketScore(entry.difficulty, want.difficulty, DIFFICULTY_BUCKETS) +
      styleScore(entry.style, want.style);
    return { entry, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.entry.qualityScore || 0) - (a.entry.qualityScore || 0);
  });

  return scored.slice(0, 5).map((s) => s.entry);
}

export { distanceBucketOf, DISTANCE_BUCKETS, DIFFICULTY_BUCKETS };
