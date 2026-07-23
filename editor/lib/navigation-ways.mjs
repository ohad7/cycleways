// Pure helpers for guidance (navigation-way) authoring in the editor.
//
// Everything here operates on plain documents so it can be unit-tested without
// a browser or a server. Validation itself lives in the shared core module, so
// the editor and the Python build cannot drift.
//
// See plans/navigation-way-names/design.md, "Editor experience".

import {
  GUIDANCE_KINDS,
  GUIDANCE_ROLES,
  GUIDANCE_SCHEMA_VERSION,
  facilityClassForKind,
  facilityClassFromRouteClass,
  facilityClassesCompatible,
  guidanceClassLabel,
} from "../../packages/core/src/data/navigationWays.js";
import { canonicalSha256 } from "../../packages/core/src/utils/canonicalHash.js";
import {
  ISSUE_CODES,
  ISSUE_SEVERITY,
  detectMaterialParallel,
  reviewWayStructure,
  validateRegistry,
  validateSegmentGuidance,
} from "../../packages/core/src/data/navigationWayValidation.js";

export {
  GUIDANCE_KINDS,
  GUIDANCE_ROLES,
  ISSUE_CODES,
  ISSUE_SEVERITY,
  guidanceClassLabel,
};

// Endpoint proximity is the documented migration fallback for adjacency, used
// only where reviewed alignment/junction evidence is unavailable. Links derived
// this way are reported so a curator can see which are weakly evidenced.
const ENDPOINT_ADJACENCY_TOLERANCE_M = 25;
const EARTH_M_PER_DEG_LAT = 111320;

export function emptyRegistry() {
  return { schemaVersion: GUIDANCE_SCHEMA_VERSION, enforcement: "migration", ways: {} };
}

function endpointDistanceMeters(a, b) {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (a[0] - b[0]) * EARTH_M_PER_DEG_LAT * Math.cos(meanLat);
  const dy = (a[1] - b[1]) * EARTH_M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

function isActiveFeature(feature) {
  if (feature?.geometry?.type !== "LineString") return false;
  const properties = feature.properties || {};
  if (["deprecated", "draft", "legacy"].includes(properties.status)) return false;
  if (properties.deprecated) return false;
  return true;
}

/**
 * Index the active source features by stable segment ID with the evidence the
 * structure review needs.
 */
export function indexActiveSegments(source, routingEvidenceBySegmentId = new Map()) {
  const byId = new Map();
  for (const feature of source?.features || []) {
    if (!isActiveFeature(feature)) continue;
    const properties = feature.properties || {};
    const segmentId = Number(properties.id);
    if (!Number.isSafeInteger(segmentId) || segmentId <= 0) continue;
    const coordinates = feature.geometry.coordinates || [];
    const routingEvidence = routingEvidenceBySegmentId.get(segmentId) || null;
    const geometryDigest = canonicalSha256(coordinates);
    const fallbackFacilityClass = properties.roadType === "road" ? "roadway" : "neutral";
    byId.set(segmentId, {
      segmentId,
      internalName: properties.name || "",
      roadType: properties.roadType || null,
      guidance: properties.guidance ?? null,
      coordinates,
      endpoints: coordinates.length
        ? [coordinates[0], coordinates[coordinates.length - 1]]
        : [],
      // `roadType` is the map's surface/styling field (`paved`, `dirt`,
      // `road`), not a facility class. Reviewed alignment/base-edge evidence is
      // authoritative; only the explicit `road` source value is a safe legacy
      // fallback.
      facilityClass: routingEvidence?.facilityClass || fallbackFacilityClass,
      routeClass: routingEvidence?.routeClass || null,
      geometryDigest,
      evidenceDigest: canonicalSha256({
        geometryDigest,
        routingEvidence: routingEvidence || null,
      }),
    });
  }
  return byId;
}

/**
 * Full validation pass over the editor's in-memory documents.
 *
 * Returns per-way structure reports plus a flat issue list, using exactly the
 * shared codes the build reports, so "save, reload, Build and Promote show the
 * same issue set" is true by construction.
 */
export function reviewGuidanceDocuments(
  source,
  registry,
  { routingEvidenceBySegmentId = new Map() } = {},
) {
  const { issues: registryIssues, ways } = validateRegistry(registry || emptyRegistry());
  const issues = [...registryIssues];
  const segments = indexActiveSegments(source, routingEvidenceBySegmentId);

  const membersByWayId = new Map();
  let reviewed = 0;
  const unreviewedIds = [];

  for (const segment of segments.values()) {
    const result = validateSegmentGuidance(segment.guidance, {
      segmentId: segment.segmentId,
      internalName: segment.internalName,
      ways,
    });
    issues.push(...result.issues);
    if (!result.reviewed) {
      unreviewedIds.push(segment.segmentId);
      // Reported with the same code and severity the build uses, so the editor,
      // Build and Promote all show one issue set. Missing classification is a
      // warning in `migration` and a blocker in `required`; either way it never
      // changes rider-facing behavior, because an unreviewed span reads as its
      // facility class.
      issues.push({
        code: ISSUE_CODES.SEGMENT_UNREVIEWED,
        severity: registry?.enforcement === "required"
          ? ISSUE_SEVERITY.ERROR
          : ISSUE_SEVERITY.WARNING,
        segmentId: segment.segmentId,
        internalName: segment.internalName,
      });
      continue;
    }
    reviewed += 1;
    if (result.record?.role !== "named-way") continue;
    const list = membersByWayId.get(result.record.wayId) || [];
    list.push(segment.segmentId);
    membersByWayId.set(result.record.wayId, list);
  }

  const wayReports = [];
  for (const [wayId, way] of ways) {
    const memberIds = (membersByWayId.get(wayId) || []).sort((a, b) => a - b);
    const { adjacency, endpointOnlyLinks } = memberAdjacency(memberIds, segments);
    const parallelPairs = materialParallelPairs(memberIds, segments);
    const memberEvidence = new Map(memberIds.map((id) => {
      const segment = segments.get(id);
      return [id, {
        facilityClass: segment?.facilityClass,
        routeClass: segment?.routeClass,
        geometryDigest: segment?.geometryDigest,
        evidenceDigest: segment?.evidenceDigest,
      }];
    }));
    const review = reviewWayStructure({
      wayId,
      wayKind: way.kind,
      memberIds,
      adjacency,
      memberEvidence,
      acknowledgedIssueFingerprints: way.acknowledgedIssueFingerprints,
      parallelPairs,
    });
    issues.push(...review.issues);
    wayReports.push({
      wayId,
      name: way.name,
      kind: way.kind,
      memberIds,
      memberCount: memberIds.length,
      totalLengthMeters: memberIds.reduce(
        (sum, id) => sum + geometryLengthMeters(segments.get(id)?.coordinates || []),
        0,
      ),
      componentCount: review.components.length,
      components: review.components,
      maxDegree: review.maxDegree,
      endpointOnlyLinks,
      issues: review.issues,
    });
  }

  const blocking = issues.filter((entry) => entry.severity === ISSUE_SEVERITY.ERROR);
  return {
    ways: wayReports.sort((a, b) => a.wayId.localeCompare(b.wayId)),
    issues,
    blocking,
    warnings: issues.filter((entry) => entry.severity === ISSUE_SEVERITY.WARNING),
    coverage: {
      activeSegments: segments.size,
      reviewedSegments: reviewed,
      unreviewedSegments: segments.size - reviewed,
      unreviewedSegmentIds: unreviewedIds.sort((a, b) => a - b),
      coverageComplete: segments.size > 0 && reviewed === segments.size,
    },
  };
}

function memberAdjacency(memberIds, segments) {
  const adjacency = new Map(memberIds.map((id) => [id, new Set()]));
  const endpointOnlyLinks = [];
  for (let i = 0; i < memberIds.length; i += 1) {
    for (let j = i + 1; j < memberIds.length; j += 1) {
      const left = segments.get(memberIds[i]);
      const right = segments.get(memberIds[j]);
      if (!left?.endpoints.length || !right?.endpoints.length) continue;
      let closest = Infinity;
      for (const a of left.endpoints) {
        for (const b of right.endpoints) {
          closest = Math.min(closest, endpointDistanceMeters(a, b));
        }
      }
      if (closest > ENDPOINT_ADJACENCY_TOLERANCE_M) continue;
      adjacency.get(memberIds[i]).add(memberIds[j]);
      adjacency.get(memberIds[j]).add(memberIds[i]);
      endpointOnlyLinks.push([memberIds[i], memberIds[j]]);
    }
  }
  return { adjacency, endpointOnlyLinks };
}

function materialParallelPairs(memberIds, segments) {
  const pairs = [];
  for (let i = 0; i < memberIds.length; i += 1) {
    for (let j = i + 1; j < memberIds.length; j += 1) {
      const left = segments.get(memberIds[i])?.coordinates;
      const right = segments.get(memberIds[j])?.coordinates;
      if (!left || !right) continue;
      const match = detectMaterialParallel(left, right);
    if (match) {
      pairs.push({
        a: memberIds[i],
        b: memberIds[j],
        ...match,
        evidenceDigest: canonicalSha256({
          a: segments.get(memberIds[i])?.evidenceDigest || null,
          b: segments.get(memberIds[j])?.evidenceDigest || null,
          match,
        }),
      });
    }
    }
  }
  return pairs;
}

/**
 * Derive broad facility evidence from accepted CW alignments and the generated
 * base-routing graph. Surface styling is deliberately excluded.
 */
export function buildRoutingEvidenceBySegmentId(overlay, routingGraph) {
  const edgesById = new Map(
    (routingGraph?.edges || []).map((edge) => [String(edge.id), edge]),
  );
  const result = new Map();
  for (const [rawSegmentId, segment] of Object.entries(overlay?.segments || {})) {
    const segmentId = Number(rawSegmentId);
    if (!Number.isSafeInteger(segmentId) || segmentId <= 0) continue;
    const classes = new Map();
    const evidence = [];
    for (const [alignmentKey, alignment] of Object.entries(segment?.alignments || {})) {
      const published = alignment?.published;
      if (published?.disposition !== "accepted") continue;
      for (const ref of published?.realization?.edgeRefs || []) {
        const edge = edgesById.get(String(ref?.edgeId));
        if (!edge) continue;
        const routeClass = edge.routeClass || edge.highway || null;
        const facilityClass = facilityClassFromRouteClass(routeClass);
        if (facilityClass !== "neutral") {
          classes.set(facilityClass, (classes.get(facilityClass) || 0) + 1);
        }
        evidence.push({
          alignmentKey,
          mappingDigest: published.mappingDigest || null,
          edgeId: String(ref.edgeId),
          routeClass,
          facilityClass,
        });
      }
    }
    const ranked = [...classes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const facilityClass = ranked.length > 0 ? ranked[0][0] : "neutral";
    result.set(segmentId, {
      facilityClass,
      routeClass: ranked.length > 0 ? ranked[0][0] : null,
      classCounts: Object.fromEntries(ranked),
      evidenceDigest: canonicalSha256(evidence),
    });
  }
  return result;
}

function geometryLengthMeters(coordinates) {
  let total = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    total += endpointDistanceMeters(coordinates[index], coordinates[index + 1]);
  }
  return total;
}

/**
 * Would assigning `segmentId` to `wayId` create an unresolved facility-class
 * conflict? Surfaced before the write so the editor can refuse the assignment
 * rather than reporting it after the fact.
 */
export function assignmentFacilityConflict(source, registry, segmentId, wayId) {
  const segment = indexActiveSegments(source).get(Number(segmentId));
  const way = (registry?.ways || {})[wayId];
  if (!segment || !way) return null;
  const wayClass = facilityClassForKind(way.kind);
  const memberClass = segment.facilityClass;
  if (facilityClassesCompatible(wayClass, memberClass)) return null;
  return {
    code: ISSUE_CODES.FACILITY_CLASS_CONFLICT,
    segmentId: Number(segmentId),
    wayId,
    wayFacilityClass: wayClass,
    memberFacilityClass: memberClass,
    // Non-waivable by design: this is the rule that stops a roadway being
    // absorbed into a cycleway way.
    waivable: false,
  };
}

/**
 * Apply one guidance classification to a source document, returning a new
 * document. Never mutates the input, so the caller can diff before saving.
 */
export function applySegmentGuidance(source, segmentId, guidance) {
  const target = Number(segmentId);
  let found = false;
  const features = (source?.features || []).map((feature) => {
    if (Number(feature?.properties?.id) !== target) return feature;
    found = true;
    const properties = { ...feature.properties };
    if (guidance == null) {
      delete properties.guidance;
    } else {
      properties.guidance = guidance;
    }
    return { ...feature, properties };
  });
  if (!found) throw new Error(`segment ${segmentId} not found in source`);
  return { ...source, features };
}

/** Upsert one way in the registry, returning a new registry document. */
export function applyWay(registry, wayId, way) {
  const base = registry || emptyRegistry();
  const ways = { ...(base.ways || {}) };
  if (way == null) {
    delete ways[wayId];
  } else {
    ways[wayId] = way;
  }
  return { ...base, ways };
}

/**
 * Record an acknowledgement of one exact structure-issue fingerprint.
 * Broad waivers are deliberately unavailable: an acknowledgement names the
 * finding it forgives, so unrelated later damage still surfaces.
 */
export function acknowledgeStructureIssue(registry, wayId, fingerprint) {
  const way = (registry?.ways || {})[wayId];
  if (!way) throw new Error(`unknown way ${wayId}`);
  const existing = way.structureReview?.acknowledgedIssueFingerprints || [];
  if (existing.includes(fingerprint)) return registry;
  return applyWay(registry, wayId, {
    ...way,
    structureReview: {
      ...(way.structureReview || {}),
      acknowledgedIssueFingerprints: [...existing, fingerprint],
    },
  });
}

export function revokeStructureAcknowledgement(registry, wayId, fingerprint) {
  const way = (registry?.ways || {})[wayId];
  if (!way) throw new Error(`unknown way ${wayId}`);
  const existing = way.structureReview?.acknowledgedIssueFingerprints || [];
  const next = existing.filter((value) => value !== fingerprint);
  if (next.length === existing.length) return registry;
  const structureReview = { ...(way.structureReview || {}) };
  if (next.length > 0) {
    structureReview.acknowledgedIssueFingerprints = next;
  } else {
    delete structureReview.acknowledgedIssueFingerprints;
  }
  const nextWay = { ...way };
  if (Object.keys(structureReview).length > 0) {
    nextWay.structureReview = structureReview;
  } else {
    // Drop the container entirely rather than leaving the stale one behind.
    delete nextWay.structureReview;
  }
  return applyWay(registry, wayId, nextWay);
}

/**
 * Apply one reviewed suggestion group as a single transaction over both
 * documents. Nothing here infers acceptance: the caller has already approved
 * this group in the UI.
 */
export function applySuggestionGroup(source, registry, group) {
  let nextRegistry = registry || emptyRegistry();
  let nextSource = source;

  if (group.role === "named-way") {
    const existing = (nextRegistry.ways || {})[group.wayId];
    nextRegistry = applyWay(nextRegistry, group.wayId, {
      name: group.name,
      kind: group.kind,
      ...(group.ref ? { ref: group.ref } : {}),
      aliases: existing?.aliases || [],
      // A suggested audible form is a listening candidate, never a canonical
      // value: `spokenName` stays null until a device recording says the clean
      // display form is wrong.
      spokenName: existing?.spokenName ?? null,
      ...(existing?.structureReview ? { structureReview: existing.structureReview } : {}),
    });
    for (const segmentId of group.segmentIds) {
      const sectionLabel = group.sectionLabels?.[String(segmentId)] || null;
      nextSource = applySegmentGuidance(nextSource, segmentId, {
        role: "named-way",
        wayId: group.wayId,
        ...(sectionLabel ? { sectionLabel } : {}),
      });
    }
    return { source: nextSource, registry: nextRegistry };
  }

  if (group.role === "standalone") {
    for (const segmentId of group.segmentIds) {
      nextSource = applySegmentGuidance(nextSource, segmentId, {
        role: "standalone",
        name: group.name,
        kind: group.kind,
      });
    }
    return { source: nextSource, registry: nextRegistry };
  }

  for (const segmentId of group.segmentIds) {
    nextSource = applySegmentGuidance(nextSource, segmentId, {
      role: "unnamed",
      kind: group.kind,
    });
  }
  return { source: nextSource, registry: nextRegistry };
}

/** Rider-facing preview for the editor's inspector, mirroring runtime copy. */
export function guidancePreview(guidance, registry, routeClass) {
  if (!guidance) {
    return {
      title: guidanceClassLabel(null, routeClass),
      eyebrow: "לא סווג",
      // Unreviewed reads exactly like intentionally unnamed at runtime.
      isFallback: true,
    };
  }
  if (guidance.role === "named-way") {
    const way = (registry?.ways || {})[guidance.wayId];
    return {
      title: way?.name || guidance.wayId,
      eyebrow: guidanceClassLabel(way?.kind),
      sectionLabel: guidance.sectionLabel || null,
      isFallback: false,
    };
  }
  if (guidance.role === "standalone") {
    return {
      title: guidance.name,
      eyebrow: guidanceClassLabel(guidance.kind),
      isFallback: false,
    };
  }
  return {
    title: guidanceClassLabel(guidance.kind, routeClass),
    eyebrow: "ללא שם",
    isFallback: true,
  };
}
