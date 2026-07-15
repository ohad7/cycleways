export const CROSSING_REVIEW_STATUSES = new Set(["accepted", "rejected"]);
export const CROSSING_FRACTION_SCALE = 1_000_000;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function validCrossingCoordinate(value) {
  return value && typeof value === "object"
    && finite(value.lat) && finite(value.lng)
    && value.lat >= -90 && value.lat <= 90
    && value.lng >= -180 && value.lng <= 180;
}

export function validCrossingSlice(value) {
  return value && typeof value === "object"
    && Number.isInteger(value.edgeShareId) && value.edgeShareId > 0
    && Number.isInteger(value.fromFractionQ)
    && Number.isInteger(value.toFractionQ)
    && value.fromFractionQ >= 0 && value.fromFractionQ <= CROSSING_FRACTION_SCALE
    && value.toFractionQ >= 0 && value.toFractionQ <= CROSSING_FRACTION_SCALE
    && value.fromFractionQ !== value.toFractionQ;
}

export function crossingMappingIssue(mapping, { representation = "action-path" } = {}) {
  if (!mapping || typeof mapping !== "object" || typeof mapping.id !== "string" || !mapping.id) {
    return "invalid_mapping_identity";
  }
  if (!mapping.match || typeof mapping.match !== "object") return "invalid_mapping_match";
  for (const section of ["before", "action", "after"]) {
    const slices = mapping.match[section];
    const allowEmpty = representation === "junction-transition" && section === "action";
    if (!Array.isArray(slices) || (!slices.length && !allowEmpty) || !slices.every(validCrossingSlice)) {
      return `invalid_mapping_${section}`;
    }
    const signatures = slices.map((slice) => `${slice.edgeShareId}:${slice.fromFractionQ}:${slice.toFractionQ}`);
    if (new Set(signatures).size !== signatures.length) return `duplicate_mapping_${section}_slice`;
  }
  if (representation === "junction-transition" && mapping.match.action.length > 0) {
    return "invalid_transition_action";
  }
  if (!validCrossingCoordinate(mapping.entry) || !validCrossingCoordinate(mapping.exit)) {
    return "invalid_mapping_anchors";
  }
  if (representation === "junction-transition") {
    if (Math.abs(mapping.entry.lat - mapping.exit.lat) > 0.000001
      || Math.abs(mapping.entry.lng - mapping.exit.lng) > 0.000001) {
      return "invalid_transition_anchors";
    }
    if (mapping.continuation?.type !== "turn"
      || !new Set(["left", "right"]).has(mapping.continuation?.direction)) {
      return "invalid_transition_continuation";
    }
  }
  if (mapping.sourceEdgeFingerprint !== undefined
    && (typeof mapping.sourceEdgeFingerprint !== "string" || !mapping.sourceEdgeFingerprint)) {
    return "invalid_source_edge_fingerprint";
  }
  return null;
}

export function crossingIssue(crossing, { requireFingerprint = false } = {}) {
  if (!crossing || typeof crossing !== "object" || typeof crossing.id !== "string" || !crossing.id) {
    return "invalid_crossing_identity";
  }
  if (requireFingerprint && (typeof crossing.fingerprint !== "string" || !crossing.fingerprint)) {
    return "invalid_crossing_fingerprint";
  }
  if (crossing.kind !== "side-change") return "invalid_crossing_kind";
  const representation = crossing.representation || "action-path";
  if (!new Set(["action-path", "junction-transition"]).has(representation)) {
    return "invalid_crossing_representation";
  }
  const guidancePolicy = crossing.guidancePolicy || "always";
  if (!new Set(["always", "user-option"]).has(guidancePolicy)) {
    return "invalid_crossing_guidance_policy";
  }
  if (guidancePolicy === "user-option" && representation !== "junction-transition") {
    return "invalid_optional_crossing_representation";
  }
  if (!validCrossingCoordinate(crossing.center)) return "invalid_crossing_center";
  if (!Array.isArray(crossing.mappings) || !crossing.mappings.length) return "invalid_crossing_mappings";
  const mappingIds = new Set();
  for (const mapping of crossing.mappings) {
    const issue = crossingMappingIssue(mapping, { representation });
    if (issue) return issue;
    if (mappingIds.has(mapping.id)) return "duplicate_mapping_id";
    mappingIds.add(mapping.id);
  }
  return null;
}

function runtimeCrossing(candidate, mappings) {
  const result = {
    id: candidate.id,
    kind: candidate.kind,
    representation: candidate.representation || "action-path",
    guidancePolicy: candidate.guidancePolicy || "always",
    center: candidate.center,
    bbox: candidate.bbox || [candidate.center.lng, candidate.center.lat, candidate.center.lng, candidate.center.lat],
    mappings,
  };
  if (candidate.crossedRoad && typeof candidate.crossedRoad === "object") {
    result.crossedRoad = {};
    for (const key of ["source", "sourceIds", "name", "highway"]) {
      if (key in candidate.crossedRoad) result.crossedRoad[key] = candidate.crossedRoad[key];
    }
  }
  return result;
}

export function joinCrossingReviews(candidatesPayload = {}, reviewData = {}) {
  const blockingIssues = [];
  const warnings = [];
  if (candidatesPayload?.schemaVersion !== 1) blockingIssues.push({ code: "invalid_candidate_schema" });
  if (reviewData?.schemaVersion !== 1) blockingIssues.push({ code: "invalid_review_schema" });
  const reviews = reviewData?.reviews && typeof reviewData.reviews === "object" && !Array.isArray(reviewData.reviews)
    ? reviewData.reviews : {};
  if (reviews !== reviewData?.reviews) blockingIssues.push({ code: "invalid_reviews_map" });
  const manualCrossings = Array.isArray(reviewData?.manualCrossings) ? reviewData.manualCrossings : [];
  if (!Array.isArray(reviewData?.manualCrossings)) blockingIssues.push({ code: "invalid_manual_crossings" });
  const candidates = Array.isArray(candidatesPayload?.crossings) ? candidatesPayload.crossings : [];
  if (!Array.isArray(candidatesPayload?.crossings)) blockingIssues.push({ code: "invalid_candidates_list" });

  const seen = new Set();
  const result = {
    accepted: [], rejected: [], pending: [], staleAccepted: [], staleRejected: [], invalid: [],
    items: [], manualItems: [], orphaned: [], runtimeCrossings: [],
  };
  for (const candidate of candidates) {
    const id = candidate?.id;
    const issue = crossingIssue(candidate, { requireFingerprint: true });
    if (issue || seen.has(id)) {
      blockingIssues.push({ code: issue || "duplicate_crossing_id", id });
      result.invalid.push(candidate);
      continue;
    }
    seen.add(id);
    const review = reviews[id];
    let state = "pending";
    let selectedMappings = [];
    if (review !== undefined) {
      if (!review || typeof review !== "object" || !CROSSING_REVIEW_STATUSES.has(review.status)) {
        state = "invalid";
        blockingIssues.push({ code: "invalid_review", id });
      } else if (review.candidateFingerprint !== candidate.fingerprint) {
        state = review.status === "accepted" ? "staleAccepted" : "staleRejected";
      } else if (review.status === "rejected") {
        state = "rejected";
      } else {
        const acceptedIds = review.acceptedMappingIds;
        if (!Array.isArray(acceptedIds) || !acceptedIds.length || !acceptedIds.every((value) => typeof value === "string")) {
          state = "invalid";
          blockingIssues.push({ code: "accepted_review_without_mappings", id });
        } else {
          const byId = new Map(candidate.mappings.map((mapping) => [mapping.id, mapping]));
          const overrides = review.mappingOverrides || [];
          if (!Array.isArray(overrides)) {
            state = "invalid";
            blockingIssues.push({ code: "invalid_mapping_overrides", id });
          } else {
            for (const override of overrides) {
              const replaced = override?.replacesMappingId;
              const overrideIssue = crossingMappingIssue(override, {
                representation: candidate.representation || "action-path",
              });
              if (!replaced || typeof override?.sourceEdgeFingerprint !== "string"
                || !override.sourceEdgeFingerprint || overrideIssue) {
                state = "invalid";
                blockingIssues.push({ code: overrideIssue || "invalid_mapping_override", id });
                continue;
              }
              const replacement = { ...override };
              delete replacement.replacesMappingId;
              byId.set(replaced, replacement);
            }
          }
          const missing = acceptedIds.filter((mappingId) => !byId.has(mappingId));
          if (missing.length) {
            state = "invalid";
            blockingIssues.push({ code: "unknown_accepted_mapping", id, mappingIds: missing });
          } else if (state !== "invalid") {
            state = "accepted";
            selectedMappings = acceptedIds.map((mappingId) => byId.get(mappingId));
            result.runtimeCrossings.push(runtimeCrossing(candidate, selectedMappings));
          }
        }
      }
    }
    result[state].push(candidate);
    result.items.push({ candidate, review: review ?? null, state });
  }

  for (const crossing of manualCrossings) {
    const id = crossing?.id;
    let issue = crossingIssue(crossing);
    if (!issue && (typeof crossing?.sourceEdgeFingerprint !== "string" || !crossing.sourceEdgeFingerprint)) {
      issue = "invalid_source_edge_fingerprint";
    }
    if (!issue && (!crossing?.audit || typeof crossing.audit.createdAt !== "string" || !crossing.audit.createdAt
      || typeof crossing.audit.updatedAt !== "string" || !crossing.audit.updatedAt)) {
      issue = "invalid_manual_audit";
    }
    if (issue || seen.has(id)) {
      blockingIssues.push({ code: issue || "duplicate_crossing_id", id });
      result.manualItems.push({ crossing, state: "invalid" });
      continue;
    }
    seen.add(id);
    result.runtimeCrossings.push(runtimeCrossing(crossing, crossing.mappings));
    result.manualItems.push({ crossing, state: "manual" });
  }

  result.orphaned = Object.entries(reviews)
    .filter(([id]) => !seen.has(id))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, review]) => ({ id, review }));
  if (result.pending.length) warnings.push({ code: "pending_reviews", count: result.pending.length });
  if (result.staleRejected.length) warnings.push({ code: "stale_rejected_reviews", count: result.staleRejected.length });
  if (result.staleAccepted.length) blockingIssues.push({ code: "stale_accepted_reviews", count: result.staleAccepted.length });
  if (result.orphaned.length) warnings.push({ code: "orphaned_reviews", count: result.orphaned.length });
  for (const candidate of candidates) {
    if (Array.isArray(candidate?.warnings) && candidate.warnings.length) warnings.push({ code: "candidate_warnings", id: candidate.id });
  }
  result.runtimeCrossings.sort((a, b) => a.id.localeCompare(b.id));
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
      staleAccepted: result.staleAccepted.length,
      staleRejected: result.staleRejected.length,
      manual: result.manualItems.filter((item) => item.state === "manual").length,
      invalid: result.invalid.length + result.manualItems.filter((item) => item.state === "invalid").length,
      orphaned: result.orphaned.length,
      warnings: warnings.length,
    },
  };
}

export function filterCrossingItems(items, filter = "all") {
  if (filter === "all") return [...(items || [])];
  if (filter === "warnings") return (items || []).filter((item) => item.candidate?.warnings?.length);
  return (items || []).filter((item) => item.state === filter);
}

export function crossingReviewGeoJson(joined) {
  const action = [];
  const context = [];
  const arrows = [];
  const corridors = [];
  const allItems = [
    ...(joined?.items || []).map((item) => ({ ...item, logical: item.candidate })),
    ...(joined?.manualItems || []).map((item) => ({ ...item, logical: item.crossing })),
  ];
  for (const item of allItems) {
    const crossing = item.logical;
    const properties = {
      id: crossing.id,
      state: item.state,
      warning: Boolean(crossing.warnings?.length),
      representation: crossing.representation || "action-path",
      guidancePolicy: crossing.guidancePolicy || "always",
    };
    for (const mapping of crossing.mappings || []) {
      const mappingProperties = { ...properties, mappingId: mapping.id, direction: mapping.direction || "explicit" };
      const routeGeometry = Array.isArray(mapping.geometry) ? mapping.geometry : null;
      if (routeGeometry?.length >= 2) {
        action.push({ type: "Feature", geometry: { type: "LineString", coordinates: routeGeometry.map(({ lat, lng }) => [lng, lat]) }, properties: mappingProperties });
      }
      const sameAnchor = Math.abs(mapping.entry.lat - mapping.exit.lat) <= 0.000001
        && Math.abs(mapping.entry.lng - mapping.exit.lng) <= 0.000001;
      const beforeGeometry = Array.isArray(mapping.beforeGeometry) ? mapping.beforeGeometry : [];
      const afterGeometry = Array.isArray(mapping.afterGeometry) ? mapping.afterGeometry : [];
      const arrowCoordinates = sameAnchor
        && beforeGeometry.length >= 2
        && afterGeometry.length >= 2
        ? [beforeGeometry.at(-2), beforeGeometry.at(-1), afterGeometry[1]]
          .map(({ lat, lng }) => [lng, lat])
        : [[mapping.entry.lng, mapping.entry.lat], [mapping.exit.lng, mapping.exit.lat]];
      arrows.push({ type: "Feature", geometry: { type: "LineString", coordinates: arrowCoordinates }, properties: mappingProperties });
      for (const section of ["beforeGeometry", "afterGeometry"]) {
        if (Array.isArray(mapping[section]) && mapping[section].length >= 2) {
          context.push({ type: "Feature", geometry: { type: "LineString", coordinates: mapping[section].map(({ lat, lng }) => [lng, lat]) }, properties: mappingProperties });
        }
      }
    }
    if (Array.isArray(crossing.corridorGeometry) && crossing.corridorGeometry.length >= 2) {
      corridors.push({ type: "Feature", geometry: { type: "LineString", coordinates: crossing.corridorGeometry.map(({ lat, lng }) => [lng, lat]) }, properties });
    }
  }
  return {
    action: { type: "FeatureCollection", features: action },
    context: { type: "FeatureCollection", features: context },
    arrows: { type: "FeatureCollection", features: arrows },
    corridors: { type: "FeatureCollection", features: corridors },
  };
}
