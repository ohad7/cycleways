// Shared navigation-way (guidance) constants, normalization, validation, and
// presentation fallbacks.
//
// `data/navigation-ways.json` is the canonical naming registry and
// `data/map-source.geojson` owns membership through `properties.guidance`.
// Build joins the two and embeds a self-contained resolved `guidance` record in
// each `segments.json` entry, so this module never fetches a second runtime
// asset: it operates on already-loaded data.
//
// The Python build validator (`processing/navigation_ways.py`) mirrors the
// rules here. Fixture parity between the two implementations is asserted by
// tests/test-navigation-ways.mjs and tests/test_navigation_ways.py.
//
// See plans/navigation-way-names/design.md.

export const GUIDANCE_SCHEMA_VERSION = 1;
export const SUPPORTED_GUIDANCE_SCHEMA_VERSIONS = Object.freeze([1]);

export const GUIDANCE_ENFORCEMENT_MODES = Object.freeze(["migration", "required"]);

export const GUIDANCE_ROLES = Object.freeze(["named-way", "standalone", "unnamed"]);

// Controlled facility kinds. Adding one requires fallback copy below plus an
// icon decision; source data never accepts an arbitrary new string.
export const GUIDANCE_KINDS = Object.freeze([
  "road",
  "cycleway",
  "dirt-road",
  "trail",
  "promenade",
  "bridge",
  "connector",
  "path",
  "other",
]);

// Resolution statuses that can appear on a resolved segment record or a route
// guidance span. `unreviewed` and `conflict` never reach rider-facing copy as
// anything other than the facility-class fallback below.
export const GUIDANCE_RESOLUTION_STATUSES = Object.freeze([
  "resolved",
  "unnamed",
  "unreviewed",
  "conflict",
  "junction",
  "off-network",
]);

// ---------------------------------------------------------------------------
// Shared product constants
// ---------------------------------------------------------------------------

// A short unnamed/unreviewed connector folds between neighbouring itinerary
// rows instead of becoming its own row. Web and native parity fixtures compare
// row lists, so this must be one shared number rather than a per-surface
// judgement.
export const ITINERARY_FOLD_MAX_M = 120;

// Material-parallel detector. Deliberately conservative: brief proximity or a
// plain crossing must not raise a review issue, but a road and the cycleway
// running beside it must.
export const WAY_PARALLEL_CORRIDOR_M = 40;
export const WAY_PARALLEL_MIN_OVERLAP_M = 150;
export const WAY_PARALLEL_HEADING_TOLERANCE_DEG = 25;

// ---------------------------------------------------------------------------
// Facility classes
// ---------------------------------------------------------------------------

// Broad rider-meaningful facility classes. Surface (`paved` vs `dirt`) is NOT a
// facility class: a dirt road and a paved road are the same class of thing to a
// rider deciding where to ride, while a roadway and a protected cycleway are
// not. A bridge/connector is class-neutral because it carries whatever facility
// it belongs to.
export const FACILITY_CLASSES = Object.freeze([
  "roadway",
  "cycleway",
  "trail-path",
  "neutral",
]);

const KIND_FACILITY_CLASS = Object.freeze({
  road: "roadway",
  "dirt-road": "roadway",
  cycleway: "cycleway",
  trail: "trail-path",
  path: "trail-path",
  promenade: "trail-path",
  bridge: "neutral",
  connector: "neutral",
  other: "neutral",
});

/** Broad facility class for a controlled guidance kind. */
export function facilityClassForKind(kind) {
  return KIND_FACILITY_CLASS[kind] || "neutral";
}

// Conservative mapping from authoritative source/routing evidence (the base
// graph's route class / OSM highway value) to a broad facility class. Anything
// unrecognized stays `neutral` so an unknown tag can never manufacture a
// blocking conflict.
const ROUTE_CLASS_FACILITY_CLASS = Object.freeze({
  motorway: "roadway",
  trunk: "roadway",
  primary: "roadway",
  secondary: "roadway",
  tertiary: "roadway",
  unclassified: "roadway",
  residential: "roadway",
  living_street: "roadway",
  service: "roadway",
  track: "roadway",
  road: "roadway",
  local_road: "roadway",
  cycleway: "cycleway",
  cycle: "cycleway",
  path: "trail-path",
  footway: "trail-path",
  pedestrian: "trail-path",
  bridleway: "trail-path",
  steps: "trail-path",
  path_track: "trail-path",
});

/** Broad facility class implied by base-graph route-class evidence. */
export function facilityClassFromRouteClass(routeClass) {
  if (!routeClass) return "neutral";
  return ROUTE_CLASS_FACILITY_CLASS[String(routeClass)] || "neutral";
}

/**
 * Two facility classes are compatible when either is neutral or they match.
 * A roadway member inside a cycleway way (or the reverse) is the unsafe case
 * the non-waivable `facility-class-conflict` blocker exists for.
 */
export function facilityClassesCompatible(a, b) {
  if (!a || !b) return true;
  if (a === "neutral" || b === "neutral") return true;
  return a === b;
}

// ---------------------------------------------------------------------------
// Presentation fallbacks
// ---------------------------------------------------------------------------

// One platform-neutral table shared by web, native, and voice. Unnamed,
// unreviewed, and conflicting spans all resolve here, so no span may fall
// through to the generic phrase merely because a kind or route class was not
// covered.
const KIND_FALLBACK_LABEL = Object.freeze({
  road: "כביש",
  cycleway: "שביל אופניים",
  "dirt-road": "דרך עפר",
  trail: "שביל",
  promenade: "טיילת",
  bridge: "גשר",
  connector: "מקטע מקשר",
  path: "שביל",
  other: "מקטע",
});

const KIND_FALLBACK_ICON = Object.freeze({
  road: "road",
  cycleway: "cycleway",
  "dirt-road": "dirt-road",
  trail: "trail",
  promenade: "promenade",
  bridge: "bridge",
  connector: "connector",
  path: "trail",
  other: "segment",
});

// Route class -> controlled kind, used when a span has no reviewed kind of its
// own (unreviewed spans, and conflicting spans whose memberships disagree).
const ROUTE_CLASS_KIND = Object.freeze({
  motorway: "road",
  trunk: "road",
  primary: "road",
  secondary: "road",
  tertiary: "road",
  unclassified: "road",
  residential: "road",
  living_street: "road",
  service: "road",
  road: "road",
  local_road: "road",
  track: "dirt-road",
  cycleway: "cycleway",
  cycle: "cycleway",
  path: "path",
  footway: "path",
  pedestrian: "path",
  bridleway: "trail",
  steps: "path",
  path_track: "path",
});

export const GENERIC_GUIDANCE_FALLBACK = "המשך במסלול";

/** Controlled kind implied by base-graph route-class evidence, or null. */
export function guidanceKindFromRouteClass(routeClass) {
  if (!routeClass) return null;
  return ROUTE_CLASS_KIND[String(routeClass)] || null;
}

/**
 * Resolve the facility-class fallback for a span that has no proper name.
 * Never returns an empty string: the generic phrase is the floor, and it is
 * only reached when neither a kind nor a route class is known.
 */
export function guidanceClassLabel(kind, routeClass = null) {
  const resolvedKind = kind && KIND_FALLBACK_LABEL[kind]
    ? kind
    : guidanceKindFromRouteClass(routeClass);
  if (resolvedKind && KIND_FALLBACK_LABEL[resolvedKind]) {
    return KIND_FALLBACK_LABEL[resolvedKind];
  }
  return GENERIC_GUIDANCE_FALLBACK;
}

/** Icon token for a facility kind, for surfaces that render one. */
export function guidanceClassIcon(kind, routeClass = null) {
  const resolvedKind = kind && KIND_FALLBACK_ICON[kind]
    ? kind
    : guidanceKindFromRouteClass(routeClass);
  return (resolvedKind && KIND_FALLBACK_ICON[resolvedKind]) || "segment";
}

/**
 * The kind a nameless span should present with. Reviewed kind wins; otherwise
 * route-class evidence supplies one. Returns `other` rather than null so a
 * conflicting span always has something to say.
 */
export function fallbackGuidanceKind(kind, routeClass = null) {
  if (kind && KIND_FALLBACK_LABEL[kind]) return kind;
  return guidanceKindFromRouteClass(routeClass) || "other";
}

// ---------------------------------------------------------------------------
// Resolved-record normalization
// ---------------------------------------------------------------------------

const ROLE_SET = new Set(GUIDANCE_ROLES);
const KIND_SET = new Set(GUIDANCE_KINDS);

/**
 * Normalize a resolved `guidance` record from `segments.json` into the neutral
 * runtime shape. Returns null when the record is absent or unusable, which the
 * caller treats as "unreviewed" — never as a reason to name the segment by its
 * internal editor label.
 */
export function normalizeResolvedSegmentGuidance(raw, segmentId) {
  if (!raw || typeof raw !== "object") return null;
  const role = raw.role;
  if (!ROLE_SET.has(role)) return null;
  const identity = raw.guidanceIdentity == null ? null : String(raw.guidanceIdentity);
  if (role !== "unnamed" && !identity) return null;
  return {
    role,
    guidanceIdentity: identity,
    wayId: role === "named-way" && raw.wayId ? String(raw.wayId) : null,
    name: raw.name ? String(raw.name) : null,
    spokenName: raw.spokenName ? String(raw.spokenName) : null,
    kind: raw.kind ? String(raw.kind) : "other",
    sectionLabel: raw.sectionLabel ? String(raw.sectionLabel) : null,
    resolutionStatus: role === "unnamed" ? "unnamed" : "resolved",
    segmentId: Number(segmentId),
  };
}

/**
 * Derive the two in-memory indexes every consumer needs from an already-loaded
 * `segments.json` object. No extra fetch, no second runtime asset.
 *
 * - `bySegmentId`: stable segment ID -> resolved guidance record
 * - `membersByWayId`: way ID -> { wayId, name, spokenName, kind, segmentIds[] }
 *
 * `issues` reports duplicate or missing numeric IDs rather than silently
 * dropping records, because a duplicate ID would make guidance resolution
 * order-dependent.
 */
export function deriveGuidanceIndexes(segmentsData) {
  const bySegmentId = new Map();
  const membersByWayId = new Map();
  const issues = [];
  const seen = new Set();

  for (const [internalName, metadata] of Object.entries(segmentsData || {})) {
    const segmentId = Number(metadata?.id);
    if (!Number.isSafeInteger(segmentId) || segmentId <= 0) {
      issues.push({ code: "segment-missing-stable-id", internalName });
      continue;
    }
    if (seen.has(segmentId)) {
      issues.push({ code: "segment-duplicate-stable-id", segmentId, internalName });
      continue;
    }
    seen.add(segmentId);

    const resolved = normalizeResolvedSegmentGuidance(metadata?.guidance, segmentId);
    if (!resolved) continue;
    bySegmentId.set(segmentId, resolved);

    if (resolved.role !== "named-way" || !resolved.wayId) continue;
    const existing = membersByWayId.get(resolved.wayId);
    if (existing) {
      existing.segmentIds.push(segmentId);
      continue;
    }
    membersByWayId.set(resolved.wayId, {
      wayId: resolved.wayId,
      guidanceIdentity: resolved.guidanceIdentity,
      name: resolved.name,
      spokenName: resolved.spokenName,
      kind: resolved.kind,
      segmentIds: [segmentId],
    });
  }

  for (const entry of membersByWayId.values()) {
    entry.segmentIds.sort((a, b) => a - b);
  }
  return { bySegmentId, membersByWayId, issues };
}

/** Whether a manifest-declared guidance schema is understood by this build. */
export function isSupportedGuidanceSchema(schemaVersion) {
  const version = Number(schemaVersion);
  return SUPPORTED_GUIDANCE_SCHEMA_VERSIONS.includes(version);
}

/**
 * The route-level guidance mode for a manifest-bound schema version.
 *
 * This is deliberately independent of whether a particular route happened to
 * traverse a classified segment: naming degrades per span, so a route crossing
 * only unreviewed segments is still `guidance-v1` (every span reads as its
 * facility class) rather than reverting to internal editor names.
 */
export function guidanceModeForSchema(schemaVersion) {
  return isSupportedGuidanceSchema(schemaVersion) ? "guidance-v1" : "legacy";
}
