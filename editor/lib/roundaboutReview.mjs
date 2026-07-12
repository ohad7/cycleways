export const ROUNDABOUT_REVIEW_STATUSES = new Set(["accepted", "rejected"]);

function validGeometry(candidate) {
  const lat = Number(candidate?.center?.lat);
  const lng = Number(candidate?.center?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (candidate?.classification === "mini_roundabout") {
    return Number(candidate?.radiusM) > 0;
  }
  return Array.isArray(candidate?.paths)
    && candidate.paths.some((path) =>
      Array.isArray(path)
      && path.length >= 2
      && path.every((coord) =>
        Array.isArray(coord)
        && coord.length >= 2
        && Number.isFinite(Number(coord[0]))
        && Number.isFinite(Number(coord[1])),
      ));
}

export function joinRoundaboutReviews(candidatesPayload = {}, reviewData = {}) {
  const blockingIssues = [];
  if (candidatesPayload?.schemaVersion !== 1) blockingIssues.push({ code: "invalid_candidate_schema" });
  if (reviewData?.schemaVersion !== 1) blockingIssues.push({ code: "invalid_review_schema" });
  const reviews = reviewData?.reviews && typeof reviewData.reviews === "object" && !Array.isArray(reviewData.reviews)
    ? reviewData.reviews
    : {};
  if (reviews !== reviewData?.reviews) blockingIssues.push({ code: "invalid_reviews_map" });
  const candidates = Array.isArray(candidatesPayload?.roundabouts) ? candidatesPayload.roundabouts : [];
  if (!Array.isArray(candidatesPayload?.roundabouts)) blockingIssues.push({ code: "invalid_candidates_list" });

  const seen = new Set();
  const result = { accepted: [], rejected: [], pending: [], stale: [], orphaned: [], items: [] };
  for (const candidate of candidates) {
    const id = candidate?.id;
    if (typeof id !== "string" || !id || typeof candidate?.fingerprint !== "string") {
      blockingIssues.push({ code: "invalid_candidate_identity", id });
      continue;
    }
    if (seen.has(id)) {
      blockingIssues.push({ code: "duplicate_candidate_id", id });
      continue;
    }
    seen.add(id);
    const review = reviews[id];
    let state = "pending";
    if (review !== undefined) {
      if (!review || typeof review !== "object" || !ROUNDABOUT_REVIEW_STATUSES.has(review.status)) {
        blockingIssues.push({ code: "invalid_review", id });
      } else if (review.fingerprint !== candidate.fingerprint) {
        state = "stale";
      } else {
        state = review.status;
      }
    }
    result.items.push({ candidate, review: review ?? null, state });
    result[state].push(candidate);
    if (state === "accepted" && !validGeometry(candidate)) {
      blockingIssues.push({ code: "invalid_accepted_geometry", id });
    }
  }
  result.orphaned = Object.entries(reviews)
    .filter(([id]) => !seen.has(id))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, review]) => ({ id, review }));
  const warnings = [];
  if (candidatesPayload?.coverage?.miniRoundaboutNodes !== "available") {
    warnings.push({ code: "mini_roundabout_coverage_incomplete" });
  }
  for (const candidate of candidates) {
    if (Array.isArray(candidate?.warnings) && candidate.warnings.length) {
      warnings.push({ code: "candidate_warnings", id: candidate.id });
    }
  }
  if (result.pending.length) blockingIssues.push({ code: "pending_reviews", count: result.pending.length });
  if (result.stale.length) blockingIssues.push({ code: "stale_reviews", count: result.stale.length });
  return {
    ...result,
    warnings,
    blockingIssues,
    coverage: candidatesPayload?.coverage || {},
    summary: {
      total: result.items.length,
      accepted: result.accepted.length,
      rejected: result.rejected.length,
      pending: result.pending.length,
      stale: result.stale.length,
      orphaned: result.orphaned.length,
      warnings: warnings.length,
    },
  };
}

function circleCoordinates(center, radiusM, steps = 32) {
  const lat = Number(center?.lat);
  const lng = Number(center?.lng);
  const latRadius = radiusM / 111_320;
  const lngRadius = latRadius / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  const ring = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    ring.push([lng + Math.cos(angle) * lngRadius, lat + Math.sin(angle) * latRadius]);
  }
  return ring;
}

export function roundaboutReviewGeoJson(joined) {
  const lines = [];
  const points = [];
  const corridors = [];
  for (const item of joined?.items || []) {
    const candidate = item.candidate;
    const properties = {
      id: candidate.id,
      state: item.state,
      classification: candidate.classification,
      warning: Boolean(candidate.warnings?.length),
    };
    if (candidate.classification === "mini_roundabout") {
      points.push({ type: "Feature", geometry: { type: "Point", coordinates: [candidate.center.lng, candidate.center.lat] }, properties });
      corridors.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [circleCoordinates(candidate.center, Number(candidate.radiusM) || 10)] }, properties });
    } else {
      for (const path of candidate.paths || []) {
        const coordinates = path.map(([lat, lng]) => [lng, lat]);
        if (coordinates.length < 2) continue;
        lines.push({ type: "Feature", geometry: { type: "LineString", coordinates }, properties });
      }
    }
  }
  return {
    lines: { type: "FeatureCollection", features: lines },
    points: { type: "FeatureCollection", features: points },
    corridors: { type: "FeatureCollection", features: corridors },
  };
}

export function filterRoundaboutItems(items, filter = "all") {
  if (filter === "all") return [...(items || [])];
  if (filter === "warnings") return (items || []).filter((item) => item.candidate?.warnings?.length);
  return (items || []).filter((item) => item.state === filter);
}
