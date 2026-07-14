import { createHash } from "node:crypto";

export const CW_OVERLAY_V2_SCHEMA_VERSION = 2;
export const ALIGNMENT_KEYS = Object.freeze(["aToB", "bToA"]);
export const UNAVAILABLE_REASON_CODES = new Set([
  "no_canonical_alignment",
  "outside_logical_corridor",
  "editorially_not_offered",
]);
const STATES = new Set(["allowed", "prohibited", "conditional", "unknown"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])]),
  );
}

export function canonicalCwOverlayV2(value) {
  return JSON.stringify(stable(value));
}

export function serializeCwOverlayV2(value, { pretty = true } = {}) {
  const parsed = parseCwOverlayV2(value);
  return `${JSON.stringify(stable(parsed), null, pretty ? 2 : 0)}\n`;
}

export function digestCwOverlayValue(value) {
  return createHash("sha256").update(canonicalCwOverlayV2(value)).digest("hex");
}

export function normalizeAlignmentEdgeRefs(refs) {
  return [...(refs || [])]
    .sort((left, right) => Number(left.sequenceIndex ?? 0) - Number(right.sequenceIndex ?? 0))
    .map((ref, sequenceIndex) => ({
      ...ref,
      edgeId: String(ref.edgeId || ""),
      direction: ref.direction === "reverse" ? "reverse" : "forward",
      sequenceIndex,
      fromFraction: Number(ref.fromFraction ?? 0),
      toFraction: Number(ref.toFraction ?? 1),
    }));
}

const orderedRefs = normalizeAlignmentEdgeRefs;

export function alignmentMappingDigest(segmentId, alignmentKey, realization) {
  const normalized = realization?.type === "explicit"
    ? { type: "explicit", edgeRefs: orderedRefs(realization.edgeRefs) }
    : {
        type: "reverseOf",
        alignmentKey: String(realization?.alignmentKey || ""),
        referencedMappingDigest: String(realization?.referencedMappingDigest || ""),
      };
  return digestCwOverlayValue({ segmentId: Number(segmentId), alignmentKey, realization: normalized });
}

function assertCoordinate(value, label) {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    !Number.isFinite(Number(value[0])) ||
    !Number.isFinite(Number(value[1]))
  ) {
    throw new Error(`${label} must be a [lng, lat] coordinate`);
  }
}

function validateEdgeRefs(edgeRefs, label) {
  if (!Array.isArray(edgeRefs) || edgeRefs.length === 0) {
    throw new Error(`${label} explicit realization must contain edgeRefs`);
  }
  for (const [index, ref] of orderedRefs(edgeRefs).entries()) {
    if (!ref.edgeId) throw new Error(`${label} edge ref ${index} is missing edgeId`);
    if (!Number.isFinite(ref.fromFraction) || !Number.isFinite(ref.toFraction)) {
      throw new Error(`${label} edge ref ${index} has invalid fractions`);
    }
    if (
      ref.fromFraction < 0 ||
      ref.fromFraction > 1 ||
      ref.toFraction < 0 ||
      ref.toFraction > 1
    ) {
      throw new Error(`${label} edge ref ${index} fractions are outside [0, 1]`);
    }
  }
}

function validateRealization(realization, label) {
  if (!realization || typeof realization !== "object") {
    throw new Error(`${label} is missing a realization`);
  }
  if (realization.type === "explicit") {
    validateEdgeRefs(realization.edgeRefs, label);
    return;
  }
  if (realization.type === "reverseOf") {
    if (!ALIGNMENT_KEYS.includes(realization.alignmentKey)) {
      throw new Error(`${label} reverseOf target is invalid`);
    }
    if (!realization.referencedMappingDigest) {
      throw new Error(`${label} reverseOf is missing referencedMappingDigest`);
    }
    return;
  }
  throw new Error(`${label} realization type is invalid`);
}

export function validateReviewEvidence(record, segment, alignmentKey) {
  const review = record?.review;
  const required = [
    "reviewer",
    "reviewedAt",
    "graphDigest",
    "policyDigest",
    "sourceGeometryDigest",
    "mappingDigest",
  ];
  const missing = required.filter((key) => !review?.[key]);
  if (missing.length > 0) {
    throw new Error(
      `segment ${segment.segmentId} ${alignmentKey} review is incomplete: ${missing.join(", ")}`,
    );
  }
  if (review.sourceGeometryDigest !== segment.sourceGeometryDigest) {
    throw new Error(`segment ${segment.segmentId} ${alignmentKey} review source digest is stale`);
  }
  if (review.mappingDigest !== record.mappingDigest) {
    throw new Error(`segment ${segment.segmentId} ${alignmentKey} review mapping digest is stale`);
  }
}

function validatePublished(record, segment, alignmentKey) {
  const label = `segment ${segment.segmentId} ${alignmentKey} published`;
  if (record.disposition === "accepted") {
    validateRealization(record.realization, label);
    const expected = alignmentMappingDigest(segment.segmentId, alignmentKey, record.realization);
    if (record.mappingDigest !== expected) {
      throw new Error(`${label} mappingDigest does not match its realization`);
    }
    validateReviewEvidence(record, segment, alignmentKey);
    return;
  }
  if (record.disposition === "unavailable") {
    if (!UNAVAILABLE_REASON_CODES.has(record.unavailableReasonCode)) {
      throw new Error(`${label} has an invalid unavailableReasonCode`);
    }
    if (!record.review?.reviewer || !record.review?.reviewedAt || !record.review?.rationale) {
      throw new Error(`${label} unavailable review is incomplete`);
    }
    return;
  }
  throw new Error(`${label} disposition must be accepted or unavailable`);
}

function validateDraft(record, segment, alignmentKey) {
  const label = `segment ${segment.segmentId} ${alignmentKey} draft`;
  if (record.disposition !== "needs_review") {
    throw new Error(`${label} disposition must be needs_review`);
  }
  if (record.realization) {
    validateRealization(record.realization, label);
    const expected = alignmentMappingDigest(segment.segmentId, alignmentKey, record.realization);
    if (record.mappingDigest && record.mappingDigest !== expected) {
      throw new Error(`${label} mappingDigest does not match its realization`);
    }
  }
  for (const state of Object.values(record.validation?.traversalStates || {})) {
    if (!STATES.has(state)) throw new Error(`${label} has an invalid traversal state`);
  }
}

export function oppositeAlignmentKey(alignmentKey) {
  return alignmentKey === "aToB" ? "bToA" : "aToB";
}

function validateReverseOf(segment, alignmentKey, record, label) {
  const realization = record?.realization;
  if (realization?.type !== "reverseOf") return;
  if (realization.alignmentKey === alignmentKey) {
    throw new Error(`${label} cannot reverse itself`);
  }
  if (realization.alignmentKey !== oppositeAlignmentKey(alignmentKey)) {
    throw new Error(`${label} reverseOf must target the opposite alignment`);
  }
  const target = segment.alignments[realization.alignmentKey]?.published;
  if (!target || target.disposition !== "accepted") {
    throw new Error(`${label} reverseOf target must be a published accepted alignment`);
  }
  if (target.realization?.type !== "explicit") {
    throw new Error(`${label} reverseOf chains and cycles are not allowed`);
  }
  if (realization.referencedMappingDigest !== target.mappingDigest) {
    throw new Error(`${label} reverseOf referenced mapping digest is stale`);
  }
}

function validateSegment(segment, key) {
  if (!segment || typeof segment !== "object") throw new Error(`segment ${key} is invalid`);
  if (!Number.isInteger(segment.segmentId) || String(segment.segmentId) !== String(key)) {
    throw new Error(`segment ${key} has a mismatched segmentId`);
  }
  if (!segment.segmentName || !segment.sourceGeometryDigest) {
    throw new Error(`segment ${key} is missing identity fields`);
  }
  for (const endpointKey of ["a", "b"]) {
    const endpoint = segment.endpoints?.[endpointKey];
    assertCoordinate(endpoint?.coordinate, `segment ${key} endpoint ${endpointKey}`);
    if (!Number.isFinite(Number(endpoint.zoneMeters)) || Number(endpoint.zoneMeters) <= 0) {
      throw new Error(`segment ${key} endpoint ${endpointKey} has invalid zoneMeters`);
    }
  }
  for (const alignmentKey of ALIGNMENT_KEYS) {
    const slot = segment.alignments?.[alignmentKey];
    if (!slot || !("published" in slot) || !("draft" in slot)) {
      throw new Error(`segment ${key} ${alignmentKey} must contain published and draft`);
    }
    if (slot.published) validatePublished(slot.published, segment, alignmentKey);
    if (slot.draft) validateDraft(slot.draft, segment, alignmentKey);
    validateReverseOf(segment, alignmentKey, slot.published, `segment ${key} ${alignmentKey} published`);
    validateReverseOf(segment, alignmentKey, slot.draft, `segment ${key} ${alignmentKey} draft`);
  }
  const activeNavigable = segment.lifecycleStatus === "active" && segment.navigable !== false;
  if (
    activeNavigable &&
    ALIGNMENT_KEYS.every(
      (alignmentKey) => segment.alignments[alignmentKey].published?.disposition === "unavailable",
    )
  ) {
    throw new Error(`segment ${key} cannot be active+navigable with both directions unavailable`);
  }
}

export function parseCwOverlayV2(value) {
  const input = typeof value === "string" ? JSON.parse(value) : value;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("CW Overlay V2 must be an object");
  }
  if (input.schemaVersion !== CW_OVERLAY_V2_SCHEMA_VERSION) {
    throw new Error(`CW Overlay V2 requires schemaVersion ${CW_OVERLAY_V2_SCHEMA_VERSION}`);
  }
  if (!input.policyId || !input.policyDigest || !input.graphDigest) {
    throw new Error("CW Overlay V2 is missing policy/graph identity");
  }
  if (!input.segments || typeof input.segments !== "object" || Array.isArray(input.segments)) {
    throw new Error("CW Overlay V2 segments must be an object");
  }
  for (const [key, segment] of Object.entries(input.segments)) validateSegment(segment, key);
  return JSON.parse(JSON.stringify(input));
}

export function materializeAcceptedAlignment(segment, alignmentKey) {
  const record = segment?.alignments?.[alignmentKey]?.published;
  if (record?.disposition !== "accepted") return null;
  if (record.realization.type === "explicit") return orderedRefs(record.realization.edgeRefs);
  const target = segment.alignments[record.realization.alignmentKey]?.published;
  if (target?.disposition !== "accepted" || target.realization?.type !== "explicit") return null;
  return orderedRefs(target.realization.edgeRefs)
    .reverse()
    .map((ref, sequenceIndex) => ({
      ...ref,
      direction: ref.direction === "reverse" ? "forward" : "reverse",
      sequenceIndex,
      // Overlay fractions describe the covered interval in stored-edge
      // orientation; traversal direction is carried separately.
      fromFraction: ref.fromFraction,
      toFraction: ref.toFraction,
    }));
}

function replacementRef(original, replacement, sequenceIndex, preserveFractions) {
  return {
    edgeId: String(replacement.edgeId),
    source: replacement.source || original.source || "manual",
    direction: original.direction,
    sequenceIndex,
    fromFraction: preserveFractions ? original.fromFraction : 0,
    toFraction: preserveFractions ? original.toFraction : 1,
    ...(replacement.manualEdgeId ? { manualEdgeId: String(replacement.manualEdgeId) } : {}),
    ...(Number.isFinite(Number(replacement.osmWayId))
      ? { osmWayId: Number(replacement.osmWayId) }
      : {}),
  };
}

export function replaceOverlayV2AlignmentEdge(overlay, replacedEdgeId, replacements) {
  const target = String(replacedEdgeId || "");
  const children = (replacements || []).filter((replacement) => replacement?.edgeId);
  if (!target || children.length === 0) return { overlay, affected: [], invalidated: [] };
  const next = structuredClone(overlay);
  const affected = [];
  const invalidated = [];
  for (const segment of Object.values(next.segments || {})) {
    for (const alignmentKey of ALIGNMENT_KEYS) {
      const slot = segment.alignments[alignmentKey];
      for (const recordKey of ["published", "draft"]) {
        const record = slot[recordKey];
        if (record?.realization?.type !== "explicit") continue;
        const refs = orderedRefs(record.realization.edgeRefs);
        if (!refs.some((ref) => ref.edgeId === target)) continue;
        const unsafe =
          children.length > 1 &&
          refs.some(
            (ref) =>
              ref.edgeId === target &&
              (ref.fromFraction !== 0 || ref.toFraction !== 1),
          );
        const identity = { segmentId: segment.segmentId, alignmentKey, recordKey };
        if (unsafe) {
          record.validation = {
            status: "invalid",
            reasons: ["base_edge_replaced_fraction_ambiguous"],
          };
          invalidated.push(identity);
          continue;
        }
        const expanded = [];
        for (const ref of refs) {
          if (ref.edgeId !== target) {
            expanded.push({ ...ref, sequenceIndex: expanded.length });
            continue;
          }
          const oriented = ref.direction === "reverse" ? [...children].reverse() : children;
          for (const child of oriented) {
            expanded.push(replacementRef(ref, child, expanded.length, children.length === 1));
          }
        }
        record.realization.edgeRefs = expanded;
        record.mappingDigest = alignmentMappingDigest(segment.segmentId, alignmentKey, record.realization);
        affected.push(identity);
      }
    }
  }
  return { overlay: next, affected, invalidated };
}

function alignmentSlot(overlay, segmentId, alignmentKey) {
  if (!ALIGNMENT_KEYS.includes(alignmentKey)) {
    throw new Error(`alignment key ${alignmentKey} is invalid`);
  }
  const segment = overlay?.segments?.[String(Number(segmentId))];
  if (!segment) throw new Error(`segment ${segmentId} is not present in Overlay V2`);
  return { segment, slot: segment.alignments[alignmentKey] };
}

export function setAlignmentDraft(
  overlay,
  segmentId,
  alignmentKey,
  { realization = null, validation, candidate = { kind: "manual-editor" } } = {},
) {
  const next = structuredClone(overlay);
  const { slot } = alignmentSlot(next, segmentId, alignmentKey);
  const draft = {
    disposition: "needs_review",
    candidate: structuredClone(candidate || { kind: "manual-editor" }),
    validation: structuredClone(validation || { status: "pending", reasons: [] }),
  };
  if (realization) {
    draft.realization = structuredClone(realization);
    draft.mappingDigest = alignmentMappingDigest(segmentId, alignmentKey, realization);
  }
  slot.draft = draft;
  return parseCwOverlayV2(next);
}

export function clearAlignmentDraft(overlay, segmentId, alignmentKey) {
  const next = structuredClone(overlay);
  alignmentSlot(next, segmentId, alignmentKey).slot.draft = null;
  return parseCwOverlayV2(next);
}

export function deriveReverseAlignmentDraft(overlay, segmentId, alignmentKey, validation) {
  const next = structuredClone(overlay);
  const { segment } = alignmentSlot(next, segmentId, alignmentKey);
  const targetKey = oppositeAlignmentKey(alignmentKey);
  const target = segment.alignments[targetKey]?.published;
  if (target?.disposition !== "accepted" || target.realization?.type !== "explicit") {
    throw new Error(`Publish an explicit ${targetKey} alignment before deriving its reverse`);
  }
  const realization = {
    type: "reverseOf",
    alignmentKey: targetKey,
    referencedMappingDigest: target.mappingDigest,
  };
  return setAlignmentDraft(next, segmentId, alignmentKey, {
    realization,
    validation,
    candidate: {
      kind: "exact-reverse",
      reverseOfAlignmentKey: targetKey,
      referencedMappingDigest: target.mappingDigest,
    },
  });
}

export function acceptAlignmentDraft(overlay, segmentId, alignmentKey, review) {
  const next = structuredClone(overlay);
  const { segment, slot } = alignmentSlot(next, segmentId, alignmentKey);
  const draft = slot.draft;
  if (!draft?.realization) throw new Error(`segment ${segmentId} ${alignmentKey} has no realization to accept`);
  if (draft.validation?.status !== "valid") {
    throw new Error(`segment ${segmentId} ${alignmentKey} must validate before acceptance`);
  }
  if (!review?.reviewer || !review?.reviewedAt || !review?.batchId) {
    throw new Error("Alignment acceptance requires reviewer, reviewedAt, and batchId");
  }
  const mappingDigest = alignmentMappingDigest(segmentId, alignmentKey, draft.realization);
  slot.published = {
    disposition: "accepted",
    realization: structuredClone(draft.realization),
    mappingDigest,
    review: {
      reviewer: review.reviewer,
      reviewedAt: review.reviewedAt,
      batchId: review.batchId,
      rationale: review.rationale || undefined,
      graphDigest: next.graphDigest,
      policyDigest: next.policyDigest,
      sourceGeometryDigest: segment.sourceGeometryDigest,
      mappingDigest,
    },
  };
  slot.draft = null;
  return parseCwOverlayV2(next);
}

export function publishAlignmentUnavailable(overlay, segmentId, alignmentKey, review) {
  const next = structuredClone(overlay);
  const { slot } = alignmentSlot(next, segmentId, alignmentKey);
  if (!UNAVAILABLE_REASON_CODES.has(review?.unavailableReasonCode)) {
    throw new Error("Select a valid unavailable reason");
  }
  if (!review?.reviewer || !review?.reviewedAt || !review?.rationale) {
    throw new Error("Unavailable review requires reviewer, reviewedAt, and rationale");
  }
  slot.published = {
    disposition: "unavailable",
    unavailableReasonCode: review.unavailableReasonCode,
    userExplanation: review.userExplanation || undefined,
    review: {
      reviewer: review.reviewer,
      reviewedAt: review.reviewedAt,
      batchId: review.batchId || undefined,
      rationale: review.rationale,
      evidence: review.evidence || undefined,
      graphDigest: next.graphDigest,
      policyDigest: next.policyDigest,
    },
  };
  slot.draft = null;
  return parseCwOverlayV2(next);
}

export function applyReviewedMigrationBatch(proposalOverlay, segmentIds, review) {
  const selected = new Set((segmentIds || []).map(Number));
  const next = structuredClone(proposalOverlay);
  const applied = [];
  for (const segment of Object.values(next.segments || {})) {
    if (!selected.has(segment.segmentId)) continue;
    for (const alignmentKey of ALIGNMENT_KEYS) {
      const slot = segment.alignments[alignmentKey];
      const draft = slot.draft;
      if (draft?.candidate?.kind !== "v1-existing" || draft.validation?.status !== "valid") {
        continue;
      }
      const mappingDigest = alignmentMappingDigest(segment.segmentId, alignmentKey, draft.realization);
      slot.published = {
        disposition: "accepted",
        realization: draft.realization,
        mappingDigest,
        review: {
          reviewer: review.reviewer,
          reviewedAt: review.reviewedAt,
          batchId: review.batchId,
          graphDigest: next.graphDigest,
          policyDigest: next.policyDigest,
          sourceGeometryDigest: segment.sourceGeometryDigest,
          mappingDigest,
        },
      };
      slot.draft = null;
      applied.push({ segmentId: segment.segmentId, alignmentKey });
    }
  }
  parseCwOverlayV2(next);
  return { overlay: next, applied };
}

/**
 * Batch-publish only mechanically proven symmetric legacy segments. The
 * existing V1 direction is stored explicitly; the opposite direction is
 * bound to that exact mapping digest through reverseOf so later edits
 * invalidate it instead of silently changing it.
 */
export function applyReviewedSymmetricMigrationBatch(
  proposalOverlay,
  segmentIds,
  review,
) {
  if (!review?.reviewer || !review?.reviewedAt || !review?.batchId) {
    throw new Error("Symmetric migration requires reviewer, reviewedAt, and batchId");
  }
  const selected = new Set((segmentIds || []).map(Number));
  const next = structuredClone(proposalOverlay);
  const applied = [];
  const skipped = [];

  for (const segment of Object.values(next.segments || {})) {
    if (!selected.has(segment.segmentId)) continue;
    if (segment.migration?.classification !== "symmetric_candidate") {
      skipped.push({ segmentId: segment.segmentId, reason: "not-symmetric-candidate" });
      continue;
    }
    const existingKey = ALIGNMENT_KEYS.find(
      (alignmentKey) =>
        segment.alignments[alignmentKey]?.draft?.candidate?.kind === "v1-existing",
    );
    const reverseKey = existingKey && oppositeAlignmentKey(existingKey);
    const existingDraft = existingKey
      ? segment.alignments[existingKey]?.draft
      : null;
    const reverseDraft = reverseKey
      ? segment.alignments[reverseKey]?.draft
      : null;
    if (
      !existingKey ||
      existingDraft?.validation?.status !== "valid" ||
      existingDraft?.realization?.type !== "explicit" ||
      reverseDraft?.candidate?.kind !== "exact-reverse" ||
      reverseDraft?.validation?.status !== "valid"
    ) {
      skipped.push({ segmentId: segment.segmentId, reason: "symmetric-proof-incomplete" });
      continue;
    }

    const existingDigest = alignmentMappingDigest(
      segment.segmentId,
      existingKey,
      existingDraft.realization,
    );
    const existingPublished = {
      disposition: "accepted",
      realization: structuredClone(existingDraft.realization),
      mappingDigest: existingDigest,
      review: {
        reviewer: review.reviewer,
        reviewedAt: review.reviewedAt,
        batchId: review.batchId,
        rationale: review.rationale || "Mechanically validated bidirectional migration batch",
        graphDigest: next.graphDigest,
        policyDigest: next.policyDigest,
        sourceGeometryDigest: segment.sourceGeometryDigest,
        mappingDigest: existingDigest,
      },
    };
    segment.alignments[existingKey] = { published: existingPublished, draft: null };

    const reverseRealization = {
      type: "reverseOf",
      alignmentKey: existingKey,
      referencedMappingDigest: existingDigest,
    };
    const reverseDigest = alignmentMappingDigest(
      segment.segmentId,
      reverseKey,
      reverseRealization,
    );
    segment.alignments[reverseKey] = {
      published: {
        disposition: "accepted",
        realization: reverseRealization,
        mappingDigest: reverseDigest,
        review: {
          reviewer: review.reviewer,
          reviewedAt: review.reviewedAt,
          batchId: review.batchId,
          rationale: review.rationale || "Mechanically validated exact reverse",
          graphDigest: next.graphDigest,
          policyDigest: next.policyDigest,
          sourceGeometryDigest: segment.sourceGeometryDigest,
          mappingDigest: reverseDigest,
        },
      },
      draft: null,
    };
    applied.push({ segmentId: segment.segmentId, alignmentKeys: [existingKey, reverseKey] });
  }

  return { overlay: parseCwOverlayV2(next), applied, skipped };
}
