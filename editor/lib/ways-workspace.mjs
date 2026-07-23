// Pure derivation behind the Ways workspace UI.
//
// The editor's Ways panel is a projection of this module: ordering members
// along the way, finding the segments that continue it, turning validator
// output into sentences, one search across ways and segments, and one merged
// work queue. Nothing here touches the DOM, the map, or the network, so the
// whole surface is unit-testable under plain node.
//
// Validation itself stays in the shared core module — this file never invents
// a finding, it only phrases and arranges what the validator already reported.
//
// See plans/ways-workspace-ux/design.md.

import { guidanceClassLabel } from "../../packages/core/src/data/navigationWays.js";

// Same endpoint tolerance the structure validator uses for adjacency, so the
// candidates a curator is offered are exactly the links validation would see.
export const ENDPOINT_ADJACENCY_TOLERANCE_M = 25;
const EARTH_M_PER_DEG_LAT = 111320;
const DEFAULT_CANDIDATE_LIMIT = 12;
const DEFAULT_SEARCH_LIMIT = 12;

function distanceMeters(a, b) {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (a[0] - b[0]) * EARTH_M_PER_DEG_LAT * Math.cos(meanLat);
  const dy = (a[1] - b[1]) * EARTH_M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

function lineLengthMeters(coordinates) {
  let total = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    total += distanceMeters(coordinates[index], coordinates[index + 1]);
  }
  return total;
}

function isActiveFeature(feature) {
  if (feature?.geometry?.type !== "LineString") return false;
  const properties = feature.properties || {};
  if (["deprecated", "draft", "legacy"].includes(properties.status)) return false;
  if (properties.deprecated) return false;
  return true;
}

/**
 * Index the active source segments with just the geometry facts the panel
 * needs. Deliberately hash-free and cheap enough to rebuild whenever the
 * source document is replaced.
 */
export function buildGeometryIndex(source) {
  const index = new Map();
  for (const feature of source?.features || []) {
    if (!isActiveFeature(feature)) continue;
    const properties = feature.properties || {};
    const segmentId = Number(properties.id);
    if (!Number.isSafeInteger(segmentId) || segmentId <= 0) continue;
    const coordinates = feature.geometry.coordinates || [];
    if (coordinates.length < 2) continue;
    index.set(segmentId, {
      segmentId,
      name: properties.name || "",
      roadType: properties.roadType || null,
      guidance: properties.guidance ?? null,
      coordinates,
      endpoints: [coordinates[0], coordinates[coordinates.length - 1]],
      lengthMeters: lineLengthMeters(coordinates),
    });
  }
  return index;
}

function closestEndpointDistance(left, right) {
  if (!left?.endpoints?.length || !right?.endpoints?.length) return Infinity;
  let closest = Infinity;
  for (const a of left.endpoints) {
    for (const b of right.endpoints) {
      closest = Math.min(closest, distanceMeters(a, b));
    }
  }
  return closest;
}

function adjacencyFor(ids, index) {
  const adjacency = new Map(ids.map((id) => [id, new Set()]));
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const gap = closestEndpointDistance(index.get(ids[i]), index.get(ids[j]));
      if (gap > ENDPOINT_ADJACENCY_TOLERANCE_M) continue;
      adjacency.get(ids[i]).add(ids[j]);
      adjacency.get(ids[j]).add(ids[i]);
    }
  }
  return adjacency;
}

function connectedComponents(ids, adjacency) {
  const seen = new Set();
  const components = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const stack = [id];
    const component = [];
    seen.add(id);
    while (stack.length > 0) {
      const current = stack.pop();
      component.push(current);
      for (const neighbour of adjacency.get(current) || []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        stack.push(neighbour);
      }
    }
    components.push(component);
  }
  return components;
}

/**
 * Order one component as a walk from one of its ends. Branches are real on
 * trail networks, so this is a depth-first walk rather than a strict path: the
 * order is stable and follows the ground, and branching is reported separately
 * by the validator rather than being forced straight here.
 */
function walkComponent(component, adjacency, index) {
  const degreeOf = (id) => (adjacency.get(id) || new Set()).size;
  // Start at an end of the chain, and among ends at the western-most one, so
  // the list reads the same way every time regardless of member ids.
  const westEnd = (id) => {
    const [first, last] = index.get(id).endpoints;
    return first[0] <= last[0] ? first : last;
  };
  const start = [...component].sort((left, right) =>
    degreeOf(left) - degreeOf(right)
    || westEnd(left)[0] - westEnd(right)[0]
    || westEnd(left)[1] - westEnd(right)[1]
    || left - right)[0];
  const visited = new Set([start]);
  const order = [start];
  const stack = [start];
  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const next = [...(adjacency.get(current) || [])]
      .filter((id) => !visited.has(id))
      .sort((left, right) => degreeOf(left) - degreeOf(right) || left - right)[0];
    if (next === undefined) {
      stack.pop();
      continue;
    }
    visited.add(next);
    order.push(next);
    stack.push(next);
  }
  return order;
}

/**
 * Order a way's members along the way and report the gaps between its
 * components, so the panel can show the shape of the road top to bottom and
 * explain a multi-component warning exactly where it happens.
 */
export function orderWayMembers(memberIds, index) {
  const ids = [...new Set(memberIds.map(Number))].filter((id) => index.has(id));
  if (ids.length === 0) {
    return { rows: [], gaps: [], componentCount: 0, totalLengthMeters: 0 };
  }
  const adjacency = adjacencyFor(ids, index);
  const walked = connectedComponents(ids, adjacency).map((component) =>
    walkComponent(component, adjacency, index));

  // Chain the components west-to-east by their first coordinate, so the list
  // reads in a stable geographic order rather than in discovery order.
  walked.sort((left, right) => {
    const a = index.get(left[0]).coordinates[0];
    const b = index.get(right[0]).coordinates[0];
    return a[0] - b[0] || a[1] - b[1];
  });

  const rows = [];
  const gaps = [];
  let totalLengthMeters = 0;
  walked.forEach((component, componentIndex) => {
    if (componentIndex > 0) {
      const previous = walked[componentIndex - 1];
      const afterSegmentId = previous[previous.length - 1];
      const beforeSegmentId = component[0];
      gaps.push({
        afterSegmentId,
        beforeSegmentId,
        distanceMeters: closestEndpointDistance(
          index.get(afterSegmentId),
          index.get(beforeSegmentId),
        ),
      });
    }
    for (const segmentId of component) {
      const entry = index.get(segmentId);
      totalLengthMeters += entry.lengthMeters;
      rows.push({
        segmentId,
        componentIndex,
        lengthMeters: entry.lengthMeters,
        name: entry.name,
        sectionLabel: entry.guidance?.sectionLabel || "",
      });
    }
  });

  return { rows, gaps, componentCount: walked.length, totalLengthMeters };
}

/**
 * Active segments that touch one of this way's member endpoints and are not
 * already members — the segments the map offers as dashed ghosts.
 *
 * Segments owned by another way are included and flagged rather than hidden:
 * a curator fixing a mis-assignment needs to see them, and the click path
 * confirms before reassigning.
 */
export function wayCandidates(memberIds, index, { limit = DEFAULT_CANDIDATE_LIMIT } = {}) {
  const members = [...new Set(memberIds.map(Number))].filter((id) => index.has(id));
  if (members.length === 0) return [];
  const memberSet = new Set(members);
  const found = new Map();
  for (const [segmentId, entry] of index) {
    if (memberSet.has(segmentId)) continue;
    let best = null;
    for (const memberId of members) {
      const gap = closestEndpointDistance(index.get(memberId), entry);
      if (gap > ENDPOINT_ADJACENCY_TOLERANCE_M) continue;
      if (!best || gap < best.distanceMeters) {
        best = { anchorSegmentId: memberId, distanceMeters: gap };
      }
    }
    if (!best) continue;
    found.set(segmentId, {
      segmentId,
      anchorSegmentId: best.anchorSegmentId,
      distanceMeters: best.distanceMeters,
      lengthMeters: entry.lengthMeters,
      name: entry.name,
      occupiedByWayId:
        entry.guidance?.role === "named-way" ? entry.guidance.wayId : null,
      role: entry.guidance?.role || null,
    });
  }
  return [...found.values()]
    .sort((left, right) =>
      left.distanceMeters - right.distanceMeters || left.segmentId - right.segmentId)
    .slice(0, limit);
}

const HEBREW_SMALL_COUNTS = ["אפס", "אחד", "שני", "שלושה", "ארבעה", "חמישה"];

function componentPhrase(componentCount) {
  if (componentCount <= 1) return "רצף אחד";
  const word = HEBREW_SMALL_COUNTS[componentCount] || String(componentCount);
  return `${word} חלקים מנותקים`;
}

/** A way's traffic-light state, phrased for a human rather than by code. */
export function wayHealth(wayReport, issues = []) {
  const relevant = (issues || []).filter(
    (entry) => entry.wayId === wayReport?.wayId && !entry.acknowledged,
  );
  const blocking = relevant.filter((entry) => entry.severity === "error");
  if (blocking.length > 0) {
    return { level: "blocked", label: wayIssueSentence(blocking[0]) };
  }
  const warnings = relevant.filter((entry) => entry.severity === "warning");
  if (warnings.length > 0) {
    return { level: "warning", label: wayIssueSentence(warnings[0]) };
  }
  return { level: "ok", label: "תקין" };
}

/** `640 מ׳` / `8.4 ק״מ` — one unit switch, no false precision. */
export function formatLengthMeters(meters) {
  const value = Number(meters) || 0;
  if (value < 1000) return `${Math.round(value)} מ׳`;
  return `${(value / 1000).toFixed(1)} ק״מ`;
}

/** The one-line fact sheet under a way's name. */
export function waySummary(way, wayReport) {
  const parts = [];
  if (way?.ref) parts.push(String(way.ref));
  parts.push(guidanceClassLabel(way?.kind));
  parts.push(`${wayReport?.memberCount ?? 0} מקטעים`);
  parts.push(formatLengthMeters(wayReport?.totalLengthMeters ?? 0));
  parts.push(componentPhrase(wayReport?.componentCount ?? 0));
  return parts.join(" · ");
}

/**
 * One validator finding as a sentence. Unknown codes degrade to their raw
 * identity: inventing friendly copy for a finding we do not understand would
 * hide it.
 */
export function wayIssueSentence(entry) {
  switch (entry?.code) {
    case "way-structure-multi-component":
      return `${componentPhrase(entry.componentCount ?? 2)} — תקין אם זו אותה דרך במציאות`;
    case "way-structure-branching":
      return `הסתעפות בדרך (דרגה ${entry.maxDegree}) — תקין ברשת שבילים או בדרך היקפית`;
    case "parallel-facility-risk":
      return `מקטעים מקבילים באותה דרך (${(entry.segmentIds || []).join(", ")}) — הסירו את המתקן השונה או אשרו כדרך אחת`;
    case "facility-class-conflict":
      return `סוג המתקן של מקטע ${entry.segmentId} אינו תואם לדרך`;
    case "segment-unreviewed":
      return "המקטע לא סווג עדיין";
    case "structure-acknowledgement-unmatched":
      return "אישור מבנה ישן אינו תואם עוד למקטעי הדרך";
    default:
      return `${entry?.code}${entry?.segmentId ? ` (#${entry.segmentId})` : ""}`;
  }
}

function segmentSubtitle(entry, registry) {
  const guidance = entry.guidance;
  if (guidance?.role === "named-way") {
    const way = (registry?.ways || {})[guidance.wayId];
    return `משויך ל־${way?.name || guidance.wayId}`;
  }
  if (guidance?.role === "standalone") return `מאפיין עצמאי · ${guidance.name}`;
  if (guidance?.role === "unnamed") return `ללא שם · ${guidanceClassLabel(guidance.kind)}`;
  return "לא סווג";
}

/**
 * One search box over both the registry and the network. Ways rank first so
 * the library stays the default target; segments follow in id order.
 */
export function searchWorkspace(query, { registry, index, limit = DEFAULT_SEARCH_LIMIT } = {}) {
  const needle = String(query || "").trim().toLocaleLowerCase("he");
  if (!needle) return [];
  const results = [];
  for (const [wayId, way] of Object.entries(registry?.ways || {})) {
    const haystack = [wayId, way.name, way.ref, way.spokenName, ...(way.aliases || [])]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("he");
    if (!haystack.includes(needle)) continue;
    results.push({
      type: "way",
      id: wayId,
      title: way.name || wayId,
      subtitle: `דרך · ${guidanceClassLabel(way.kind)}${way.ref ? ` · ${way.ref}` : ""}`,
    });
  }
  results.sort((left, right) => String(left.title).localeCompare(String(right.title), "he"));

  const segments = [];
  for (const [segmentId, entry] of index || new Map()) {
    const haystack = `${segmentId} ${entry.name}`.toLocaleLowerCase("he");
    if (!haystack.includes(needle)) continue;
    segments.push({
      type: "segment",
      id: segmentId,
      title: `#${segmentId} · ${entry.name || "מקטע"}`,
      subtitle: segmentSubtitle(entry, registry),
    });
  }
  segments.sort((left, right) => left.id - right.id);
  return [...results, ...segments].slice(0, limit);
}

function suggestionIsFlagged(group) {
  return (group?.validator?.verdict || "clear") !== "clear";
}

/**
 * The single work list behind the review inbox: pending suggestions for
 * unreviewed segments first, then every unreviewed segment no suggestion
 * covers. Without this merge the majority of the classification gap is
 * invisible, because only segments that made it into the artifact can be
 * reached.
 */
export function buildWorkQueue({ suggestions, index, filter = "all" } = {}) {
  const unreviewed = new Set();
  for (const [segmentId, entry] of index || new Map()) {
    if (!entry.guidance) unreviewed.add(segmentId);
  }

  const items = [];
  const covered = new Set();
  for (const group of suggestions?.groups || []) {
    const segmentIds = (group.segmentIds || []).map(Number);
    const open = segmentIds.filter((segmentId) => unreviewed.has(segmentId));
    if (group.decision !== "pending" || open.length === 0) continue;
    for (const segmentId of open) covered.add(segmentId);
    items.push({
      kind: "suggestion",
      key: `suggestion:${group.id}`,
      group,
      segmentIds: open,
      flagged: suggestionIsFlagged(group),
    });
  }

  for (const segmentId of [...unreviewed].sort((a, b) => a - b)) {
    if (covered.has(segmentId)) continue;
    items.push({
      kind: "segment",
      key: `segment:${segmentId}`,
      segmentId,
      segmentIds: [segmentId],
      flagged: false,
      entry: index.get(segmentId),
    });
  }

  if (filter === "warning") return items.filter((item) => item.flagged);
  if (filter === "no-suggestion") return items.filter((item) => item.kind === "segment");
  return items;
}
