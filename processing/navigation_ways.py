"""Build-side navigation-way (guidance) validation, structure review, and reporting.

This mirrors ``packages/core/src/data/navigationWays.js`` and
``packages/core/src/data/navigationWayValidation.js``. The editor and the build
must produce the same structured issue set, so shared fixtures under
``tests/fixtures/navigation-way-names/`` are run through both implementations.

Structure philosophy (see plans/navigation-way-names/design.md):

* multi-component and branching are WARNINGS a curator acknowledges by exact
  issue fingerprint -- a real facility is often mapped in disjoint pieces and a
  named trail network legitimately branches. Forcing a split into several way
  IDs would manufacture the false transitions this feature exists to remove;
* a material parallel pair BLOCKS until reassigned or its exact fingerprint is
  approved as one facility (dual carriageways are legitimate);
* a facility-class conflict BLOCKS and can never be approved.

No rule here may be resolved by splitting one facility into several way IDs.
"""

from __future__ import annotations

import math
import re
import hashlib
import json
from typing import Any, Iterable

GUIDANCE_SCHEMA_VERSION = 1
GUIDANCE_ENFORCEMENT_MODES = ("migration", "required")
GUIDANCE_ROLES = ("named-way", "standalone", "unnamed")

GUIDANCE_KINDS = (
    "road",
    "cycleway",
    "dirt-road",
    "trail",
    "promenade",
    "bridge",
    "connector",
    "path",
    "other",
)

# Material-parallel detector constants. Kept identical to the JavaScript module.
WAY_PARALLEL_CORRIDOR_M = 40.0
WAY_PARALLEL_MIN_OVERLAP_M = 150.0
WAY_PARALLEL_HEADING_TOLERANCE_DEG = 25.0

SEVERITY_ERROR = "error"
SEVERITY_WARNING = "warning"


class Code:
    REGISTRY_SCHEMA = "registry-schema-unsupported"
    REGISTRY_ENFORCEMENT = "registry-enforcement-invalid"
    WAY_ID_INVALID = "way-id-invalid"
    WAY_NAME_INVALID = "way-name-invalid"
    WAY_KIND_INVALID = "way-kind-invalid"
    WAY_REF_INVALID = "way-ref-invalid"
    WAY_ALIAS_DUPLICATE = "way-alias-duplicate"
    WAY_SPOKEN_INVALID = "way-spoken-name-invalid"
    WAY_DISPLAY_HAS_PRONUNCIATION = "way-display-name-has-pronunciation-marks"
    WAY_SPOKEN_REDUNDANT = "way-spoken-name-redundant"
    WAY_STRUCTURE_REVIEW_INVALID = "way-structure-review-invalid"
    WAY_STRUCTURE_REVIEW_BROAD_WAIVER = "way-structure-review-broad-waiver"
    WAY_EMPTY = "way-empty"
    WAY_UNKNOWN = "way-unknown"
    ROLE_INVALID = "segment-role-invalid"
    ROLE_FIELD_INVALID = "segment-role-field-invalid"
    SEGMENT_UNREVIEWED = "segment-unreviewed"
    SECTION_LABEL_NEEDS_REVIEW = "way-member-section-label-needs-review"
    STRUCTURE_MULTI_COMPONENT = "way-structure-multi-component"
    STRUCTURE_BRANCHING = "way-structure-branching"
    PARALLEL_FACILITY_RISK = "parallel-facility-risk"
    FACILITY_CLASS_CONFLICT = "facility-class-conflict"
    ACK_UNMATCHED = "structure-acknowledgement-unmatched"


# Hebrew niqqud/cantillation plus maqaf and geresh/gershayim: pronunciation-only
# marks that belong in ``spokenName``, never in a display name.
PRONUNCIATION_MARK_RE = re.compile("[֑-ׇ־׳״]")
CONTROL_CHAR_RE = re.compile("[\x00-\x1f\x7f]")

KIND_FACILITY_CLASS = {
    "road": "roadway",
    "dirt-road": "roadway",
    "cycleway": "cycleway",
    "trail": "trail-path",
    "path": "trail-path",
    "promenade": "trail-path",
    "bridge": "neutral",
    "connector": "neutral",
    "other": "neutral",
}

ROUTE_CLASS_FACILITY_CLASS = {
    "motorway": "roadway",
    "trunk": "roadway",
    "primary": "roadway",
    "secondary": "roadway",
    "tertiary": "roadway",
    "unclassified": "roadway",
    "residential": "roadway",
    "living_street": "roadway",
    "service": "roadway",
    "track": "roadway",
    "road": "roadway",
    "local_road": "roadway",
    "cycleway": "cycleway",
    "cycle": "cycleway",
    "path": "trail-path",
    "footway": "trail-path",
    "pedestrian": "trail-path",
    "bridleway": "trail-path",
    "steps": "trail-path",
    "path_track": "trail-path",
}


def facility_class_for_kind(kind: str | None) -> str:
    return KIND_FACILITY_CLASS.get(kind or "", "neutral")


def facility_class_from_route_class(route_class: str | None) -> str:
    if not route_class:
        return "neutral"
    return ROUTE_CLASS_FACILITY_CLASS.get(str(route_class), "neutral")


def facility_classes_compatible(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return True
    if a == "neutral" or b == "neutral":
        return True
    return a == b


def issue(code: str, severity: str, **fields: Any) -> dict[str, Any]:
    return {"code": code, "severity": severity, **fields}


def canonical_sha256(value: Any) -> str:
    """SHA-256 over the same key-sorted JSON shape used by the JS validator."""
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _normalized_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value).strip()


def structure_issue_fingerprint(code: str, way_id: str, evidence: dict[str, Any]) -> str:
    """Bind an acknowledgement to the exact evidence that produced the finding.

    Any material change -- membership, geometry, component set, branch set, or
    the suspicious pair itself -- yields a different fingerprint and re-raises
    review. That is why broad ``allowBranching``/``allowParallel`` booleans are
    rejected outright.
    """
    parts = [code, way_id]
    for key in sorted(k for k, v in evidence.items() if v is not None):
        value = evidence[key]
        if isinstance(value, (list, tuple)):
            rendered = ",".join(sorted(str(item) for item in value))
        else:
            rendered = str(value)
        parts.append(f"{key}={rendered}")
    return "|".join(parts)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


def validate_registry(registry: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    schema_version = registry.get("schemaVersion")
    try:
        schema_int = int(schema_version)
    except (TypeError, ValueError):
        schema_int = None
    if schema_int != GUIDANCE_SCHEMA_VERSION:
        issues.append(issue(Code.REGISTRY_SCHEMA, SEVERITY_ERROR, schemaVersion=schema_version))
        return issues, {}

    enforcement = registry.get("enforcement")
    if enforcement not in GUIDANCE_ENFORCEMENT_MODES:
        issues.append(issue(Code.REGISTRY_ENFORCEMENT, SEVERITY_ERROR, enforcement=enforcement))

    ways: dict[str, Any] = {}
    raw_ways = registry.get("ways")
    if not isinstance(raw_ways, dict):
        raw_ways = {}

    for way_id, raw in raw_ways.items():
        if not isinstance(way_id, str) or not way_id.strip() or CONTROL_CHAR_RE.search(way_id):
            issues.append(issue(Code.WAY_ID_INVALID, SEVERITY_ERROR, wayId=way_id))
            continue
        if not isinstance(raw, dict):
            issues.append(issue(Code.WAY_ID_INVALID, SEVERITY_ERROR, wayId=way_id))
            continue

        name = _normalized_text(raw.get("name"))
        if not name:
            issues.append(issue(Code.WAY_NAME_INVALID, SEVERITY_ERROR, wayId=way_id))
        elif PRONUNCIATION_MARK_RE.search(name):
            issues.append(
                issue(Code.WAY_DISPLAY_HAS_PRONUNCIATION, SEVERITY_ERROR, wayId=way_id, name=name)
            )
        if raw.get("kind") not in GUIDANCE_KINDS:
            issues.append(
                issue(Code.WAY_KIND_INVALID, SEVERITY_ERROR, wayId=way_id, kind=raw.get("kind"))
            )
        ref = raw.get("ref")
        if ref is not None and not isinstance(ref, str):
            issues.append(issue(Code.WAY_REF_INVALID, SEVERITY_ERROR, wayId=way_id))

        aliases_seen: list[str] = []
        for alias in raw.get("aliases") or []:
            normalized = _normalized_text(alias)
            if not normalized or normalized in aliases_seen:
                issues.append(
                    issue(Code.WAY_ALIAS_DUPLICATE, SEVERITY_ERROR, wayId=way_id, alias=alias)
                )
                continue
            aliases_seen.append(normalized)

        # `spokenName` is preserved byte-for-byte: combining marks and
        # punctuation are the whole point, so it is never normalized.
        spoken_name = raw.get("spokenName")
        if spoken_name is not None:
            if (
                not isinstance(spoken_name, str)
                or not spoken_name.strip()
                or CONTROL_CHAR_RE.search(spoken_name)
            ):
                issues.append(issue(Code.WAY_SPOKEN_INVALID, SEVERITY_ERROR, wayId=way_id))
                spoken_name = None
            elif spoken_name == name:
                issues.append(issue(Code.WAY_SPOKEN_REDUNDANT, SEVERITY_WARNING, wayId=way_id))

        acknowledged = _validate_structure_review(raw.get("structureReview"), way_id, issues)

        ways[way_id] = {
            "wayId": way_id,
            "name": name,
            "kind": raw.get("kind"),
            "ref": ref,
            "aliases": aliases_seen,
            "spokenName": spoken_name if isinstance(spoken_name, str) and spoken_name.strip() else None,
            "acknowledgedIssueFingerprints": acknowledged,
        }

    return issues, ways


def _validate_structure_review(
    structure_review: Any, way_id: str, issues: list[dict[str, Any]]
) -> list[str]:
    if structure_review is None:
        return []
    if not isinstance(structure_review, dict):
        issues.append(issue(Code.WAY_STRUCTURE_REVIEW_INVALID, SEVERITY_ERROR, wayId=way_id))
        return []
    # Broad waivers are rejected by design: an acknowledgement must name the
    # exact finding it forgives, so unrelated later damage still surfaces.
    for forbidden in ("allowBranching", "allowParallel", "allowMultiComponent"):
        if forbidden in structure_review:
            issues.append(
                issue(
                    Code.WAY_STRUCTURE_REVIEW_BROAD_WAIVER,
                    SEVERITY_ERROR,
                    wayId=way_id,
                    field=forbidden,
                )
            )
    raw = structure_review.get("acknowledgedIssueFingerprints")
    if raw is None:
        return []
    if not isinstance(raw, list) or any(
        not isinstance(value, str) or not value.strip() for value in raw
    ):
        issues.append(issue(Code.WAY_STRUCTURE_REVIEW_INVALID, SEVERITY_ERROR, wayId=way_id))
        return []
    seen: list[str] = []
    for value in raw:
        trimmed = value.strip()
        if trimmed not in seen:
            seen.append(trimmed)
    return seen


# ---------------------------------------------------------------------------
# Per-segment source records
# ---------------------------------------------------------------------------

NAMED_WAY_ALLOWED = {"role", "wayId", "sectionLabel", "sectionLabelNeedsReview", "spokenName"}
STANDALONE_ALLOWED = {"role", "name", "spokenName", "kind"}
UNNAMED_ALLOWED = {"role", "kind"}


def validate_segment_guidance(
    guidance: Any,
    *,
    segment_id: int | None,
    internal_name: str,
    ways: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, bool]:
    """Validate one authored ``properties.guidance`` record.

    Returns ``(issues, record, reviewed)``. ``record`` is None when the record is
    absent or invalid; ``reviewed`` distinguishes "not authored yet" from
    "authored but wrong".
    """
    issues: list[dict[str, Any]] = []
    context = {"segmentId": segment_id, "internalName": internal_name}
    if guidance is None:
        return issues, None, False
    if not isinstance(guidance, dict):
        issues.append(issue(Code.ROLE_INVALID, SEVERITY_ERROR, **context))
        return issues, None, False

    role = guidance.get("role")
    if role not in GUIDANCE_ROLES:
        issues.append(issue(Code.ROLE_INVALID, SEVERITY_ERROR, role=role, **context))
        return issues, None, False

    allowed = (
        NAMED_WAY_ALLOWED
        if role == "named-way"
        else STANDALONE_ALLOWED
        if role == "standalone"
        else UNNAMED_ALLOWED
    )
    for key in guidance:
        if key not in allowed:
            issues.append(
                issue(Code.ROLE_FIELD_INVALID, SEVERITY_ERROR, role=role, field=key, **context)
            )

    if role == "named-way":
        way_id = guidance.get("wayId")
        if not isinstance(way_id, str) or not way_id.strip():
            issues.append(
                issue(Code.ROLE_FIELD_INVALID, SEVERITY_ERROR, role=role, field="wayId", **context)
            )
            return issues, None, True
        if ways is not None and way_id not in ways:
            issues.append(issue(Code.WAY_UNKNOWN, SEVERITY_ERROR, wayId=way_id, **context))
            return issues, None, True
        section_label = guidance.get("sectionLabel")
        normalized_label = _normalized_text(section_label) if section_label is not None else None
        if section_label is not None and not normalized_label:
            issues.append(
                issue(
                    Code.ROLE_FIELD_INVALID,
                    SEVERITY_ERROR,
                    role=role,
                    field="sectionLabel",
                    **context,
                )
            )
        if guidance.get("sectionLabelNeedsReview") is True:
            issues.append(
                issue(Code.SECTION_LABEL_NEEDS_REVIEW, SEVERITY_WARNING, wayId=way_id, **context)
            )
        spoken = guidance.get("spokenName")
        return (
            issues,
            {
                "role": role,
                "wayId": way_id,
                "sectionLabel": normalized_label or None,
                "spokenName": spoken if isinstance(spoken, str) and spoken.strip() else None,
            },
            True,
        )

    if role == "standalone":
        name = _normalized_text(guidance.get("name"))
        if not name:
            issues.append(
                issue(Code.ROLE_FIELD_INVALID, SEVERITY_ERROR, role=role, field="name", **context)
            )
        elif PRONUNCIATION_MARK_RE.search(name):
            issues.append(
                issue(Code.WAY_DISPLAY_HAS_PRONUNCIATION, SEVERITY_ERROR, name=name, **context)
            )
        if guidance.get("kind") not in GUIDANCE_KINDS:
            issues.append(
                issue(Code.ROLE_FIELD_INVALID, SEVERITY_ERROR, role=role, field="kind", **context)
            )
        spoken = guidance.get("spokenName")
        if spoken is not None and (
            not isinstance(spoken, str) or not spoken.strip() or CONTROL_CHAR_RE.search(spoken)
        ):
            issues.append(issue(Code.WAY_SPOKEN_INVALID, SEVERITY_ERROR, **context))
        if any(entry["severity"] == SEVERITY_ERROR for entry in issues):
            return issues, None, True
        return (
            issues,
            {
                "role": role,
                "name": name,
                "kind": guidance.get("kind"),
                "spokenName": spoken if isinstance(spoken, str) and spoken.strip() else None,
            },
            True,
        )

    if guidance.get("kind") not in GUIDANCE_KINDS:
        issues.append(
            issue(Code.ROLE_FIELD_INVALID, SEVERITY_ERROR, role=role, field="kind", **context)
        )
        return issues, None, True
    return issues, {"role": role, "kind": guidance.get("kind")}, True


# ---------------------------------------------------------------------------
# Structure review
# ---------------------------------------------------------------------------


def _connected_components(
    member_ids: Iterable[int], adjacency: dict[int, set[int]]
) -> list[list[int]]:
    seen: set[int] = set()
    components: list[list[int]] = []
    for member in member_ids:
        if member in seen:
            continue
        stack = [member]
        component: list[int] = []
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            component.append(current)
            for neighbour in adjacency.get(current, set()):
                if neighbour not in seen:
                    stack.append(neighbour)
        components.append(sorted(component))
    return sorted(components, key=lambda component: component[0])


def review_way_structure(
    *,
    way_id: str,
    way_kind: str | None,
    member_ids: Iterable[int],
    adjacency: dict[int, set[int]] | None = None,
    member_evidence: dict[int, dict[str, Any]] | None = None,
    acknowledged_issue_fingerprints: Iterable[str] = (),
    parallel_pairs: Iterable[dict[str, Any]] = (),
) -> dict[str, Any]:
    adjacency = adjacency or {}
    member_evidence = member_evidence or {}
    issues: list[dict[str, Any]] = []
    members = sorted(member_ids)
    acknowledged = set(acknowledged_issue_fingerprints)
    used: set[str] = set()
    member_evidence_digests = [
        f"{member}:"
        + str(
            (member_evidence.get(member) or {}).get("evidenceDigest")
            or canonical_sha256(member_evidence.get(member) or {})
        )
        for member in members
        if member_evidence.get(member)
    ]

    if not members:
        issues.append(issue(Code.WAY_EMPTY, SEVERITY_ERROR, wayId=way_id))
        return {
            "issues": issues,
            "components": [],
            "maxDegree": 0,
            "unusedAcknowledgements": sorted(acknowledged),
        }

    components = _connected_components(members, adjacency)
    max_degree = 0
    branch_nodes: list[int] = []
    for member in members:
        degree = len(adjacency.get(member, set()))
        max_degree = max(max_degree, degree)
        if degree > 2:
            branch_nodes.append(member)

    # Multi-component: a warning. A real road mapped as two disjoint CycleWays
    # stretches is still one road.
    if len(components) > 1:
        fingerprint = structure_issue_fingerprint(
            Code.STRUCTURE_MULTI_COMPONENT,
            way_id,
            dict({
                "components": [".".join(str(item) for item in component) for component in components],
            }, **(
                {"memberEvidenceDigests": member_evidence_digests}
                if member_evidence_digests else {}
            )),
        )
        is_acknowledged = fingerprint in acknowledged
        if is_acknowledged:
            used.add(fingerprint)
        issues.append(
            issue(
                Code.STRUCTURE_MULTI_COMPONENT,
                SEVERITY_WARNING,
                wayId=way_id,
                fingerprint=fingerprint,
                acknowledged=is_acknowledged,
                componentCount=len(components),
                components=components,
            )
        )

    # Branching: also a warning. Named trail networks and perimeter roads
    # legitimately exceed degree two.
    if branch_nodes:
        fingerprint = structure_issue_fingerprint(
            Code.STRUCTURE_BRANCHING,
            way_id,
            dict({
                "branchNodes": branch_nodes,
                "maxDegree": max_degree,
            }, **(
                {"memberEvidenceDigests": member_evidence_digests}
                if member_evidence_digests else {}
            )),
        )
        is_acknowledged = fingerprint in acknowledged
        if is_acknowledged:
            used.add(fingerprint)
        issues.append(
            issue(
                Code.STRUCTURE_BRANCHING,
                SEVERITY_WARNING,
                wayId=way_id,
                fingerprint=fingerprint,
                acknowledged=is_acknowledged,
                maxDegree=max_degree,
                branchNodes=branch_nodes,
            )
        )

    # Facility-class conflict: non-waivable. This is the rule that actually
    # prevents a roadway being absorbed into a cycleway way.
    way_class = facility_class_for_kind(way_kind)
    for member in members:
        evidence = member_evidence.get(member)
        if not evidence:
            continue
        member_class = evidence.get("facilityClass") or facility_class_from_route_class(
            evidence.get("routeClass")
        )
        if facility_classes_compatible(way_class, member_class):
            continue
        issues.append(
            issue(
                Code.FACILITY_CLASS_CONFLICT,
                SEVERITY_ERROR,
                wayId=way_id,
                segmentId=member,
                wayKind=way_kind,
                wayFacilityClass=way_class,
                memberFacilityClass=member_class,
                waivable=False,
            )
        )

    # Material parallel pair: blocks until reassigned or the exact pair is
    # approved. Geometry raises the question; it does not decide identity, so a
    # dual carriageway can be approved as one facility.
    for pair in parallel_pairs:
        ids = sorted([int(pair["a"]), int(pair["b"])])
        fingerprint = structure_issue_fingerprint(
            Code.PARALLEL_FACILITY_RISK,
            way_id,
            dict({
                "pair": ids,
                "overlapMeters": round(float(pair.get("overlapMeters") or 0)),
            }, **(
                {
                    "evidenceDigest": pair.get("evidenceDigest")
                    or canonical_sha256(
                    {
                        "segmentIds": ids,
                        "geometryDigests": [
                            (member_evidence.get(member) or {}).get("geometryDigest")
                            or (member_evidence.get(member) or {}).get("evidenceDigest")
                            for member in ids
                        ],
                        "overlapMeters": float(pair.get("overlapMeters") or 0),
                        "separationMeters": float(pair.get("separationMeters") or 0),
                    }
                    )
                }
                if pair.get("evidenceDigest")
                or any((member_evidence.get(member) or {}).get("geometryDigest") for member in ids)
                else {}
            )),
        )
        is_acknowledged = fingerprint in acknowledged
        if is_acknowledged:
            used.add(fingerprint)
        issues.append(
            issue(
                Code.PARALLEL_FACILITY_RISK,
                SEVERITY_WARNING if is_acknowledged else SEVERITY_ERROR,
                wayId=way_id,
                fingerprint=fingerprint,
                acknowledged=is_acknowledged,
                segmentIds=ids,
                overlapMeters=float(pair.get("overlapMeters") or 0),
                separationMeters=float(pair.get("separationMeters") or 0),
            )
        )

    unused = sorted(acknowledged - used)
    for fingerprint in unused:
        # A stale acknowledgement means the evidence changed under it. Reporting
        # it keeps "any material change re-raises review" visible.
        issues.append(
            issue(Code.ACK_UNMATCHED, SEVERITY_WARNING, wayId=way_id, fingerprint=fingerprint)
        )

    return {
        "issues": issues,
        "components": components,
        "maxDegree": max_degree,
        "unusedAcknowledgements": unused,
    }


# ---------------------------------------------------------------------------
# Material-parallel geometry detector
# ---------------------------------------------------------------------------

EARTH_M_PER_DEG_LAT = 111320.0


def _to_local(point: Iterable[float], origin: Iterable[float]) -> tuple[float, float]:
    origin_lng, origin_lat = origin[0], origin[1]
    meters_per_deg_lng = EARTH_M_PER_DEG_LAT * math.cos(math.radians(origin_lat))
    return (
        (point[0] - origin_lng) * meters_per_deg_lng,
        (point[1] - origin_lat) * EARTH_M_PER_DEG_LAT,
    )


def _segment_distance_and_heading(
    point: tuple[float, float], a: tuple[float, float], b: tuple[float, float]
) -> tuple[float, float | None]:
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    length_sq = dx * dx + dy * dy
    if length_sq <= 0:
        return math.hypot(point[0] - a[0], point[1] - a[1]), None
    t = max(0.0, min(1.0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length_sq))
    proj_x = a[0] + t * dx
    proj_y = a[1] + t * dy
    return math.hypot(point[0] - proj_x, point[1] - proj_y), math.atan2(dy, dx)


def _heading_delta_degrees(a: float | None, b: float | None) -> float:
    if a is None or b is None:
        return 180.0
    delta = abs(math.degrees(a - b))
    while delta > 180:
        delta -= 360
    delta = abs(delta)
    # Anti-parallel counts as parallel: a cycleway beside a road is often
    # digitized in the opposite direction.
    return 180 - delta if delta > 90 else delta


def detect_material_parallel(
    a: list[list[float]],
    b: list[list[float]],
    *,
    corridor_meters: float = WAY_PARALLEL_CORRIDOR_M,
    min_overlap_meters: float = WAY_PARALLEL_MIN_OVERLAP_M,
    heading_tolerance_degrees: float = WAY_PARALLEL_HEADING_TOLERANCE_DEG,
) -> dict[str, float] | None:
    """Detect a materially parallel pair of member geometries.

    Deliberately conservative: it requires sustained proximity along a real
    length with matching heading, so two lines that merely cross, or touch at a
    shared endpoint, do not fire it.
    """
    if not a or not b or len(a) < 2 or len(b) < 2:
        return None
    origin = a[0]
    local_a = [_to_local(point, origin) for point in a]
    local_b = [_to_local(point, origin) for point in b]

    overlap_meters = 0.0
    separation_sum = 0.0
    separation_count = 0

    for index in range(len(local_a) - 1):
        start = local_a[index]
        end = local_a[index + 1]
        step_length = math.hypot(end[0] - start[0], end[1] - start[1])
        if step_length <= 0:
            continue
        heading = math.atan2(end[1] - start[1], end[0] - start[0])
        midpoint = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)

        best_distance = float("inf")
        best_heading: float | None = None
        for other in range(len(local_b) - 1):
            distance, candidate_heading = _segment_distance_and_heading(
                midpoint, local_b[other], local_b[other + 1]
            )
            if distance < best_distance:
                best_distance = distance
                best_heading = candidate_heading
        if best_distance > corridor_meters:
            continue
        if _heading_delta_degrees(heading, best_heading) > heading_tolerance_degrees:
            continue
        overlap_meters += step_length
        separation_sum += best_distance
        separation_count += 1

    if overlap_meters < min_overlap_meters or separation_count == 0:
        return None
    return {
        "overlapMeters": overlap_meters,
        "separationMeters": separation_sum / separation_count,
    }


# ---------------------------------------------------------------------------
# Whole-network report
# ---------------------------------------------------------------------------


def _member_adjacency(
    member_ids: list[int],
    endpoints_by_id: dict[int, tuple[tuple[float, float], tuple[float, float]]],
    tolerance_m: float = 25.0,
) -> tuple[dict[int, set[int]], set[tuple[int, int]]]:
    """Adjacency between members of one way.

    Reviewed alignment terminals and published junction arms are the preferred
    authority; source endpoint equality is the documented migration fallback for
    a legacy or unmatched member, and every link derived that way is reported so
    a curator can see which links are weakly evidenced.
    """
    adjacency: dict[int, set[int]] = {member: set() for member in member_ids}
    endpoint_only: set[tuple[int, int]] = set()
    for i, left in enumerate(member_ids):
        for right in member_ids[i + 1 :]:
            left_ends = endpoints_by_id.get(left)
            right_ends = endpoints_by_id.get(right)
            if not left_ends or not right_ends:
                continue
            closest = min(
                _endpoint_distance_m(a, b) for a in left_ends for b in right_ends
            )
            if closest <= tolerance_m:
                adjacency[left].add(right)
                adjacency[right].add(left)
                endpoint_only.add((min(left, right), max(left, right)))
    return adjacency, endpoint_only


def _endpoint_distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    mean_lat = math.radians((a[1] + b[1]) / 2)
    dx = (a[0] - b[0]) * EARTH_M_PER_DEG_LAT * math.cos(mean_lat)
    dy = (a[1] - b[1]) * EARTH_M_PER_DEG_LAT
    return math.hypot(dx, dy)


def build_routing_evidence_by_segment_id(
    overlay: dict[str, Any] | None,
    routing_graph: dict[str, Any] | None,
) -> dict[int, dict[str, Any]]:
    """Derive facility evidence from accepted alignments and base edges."""
    edges_by_id = {
        str(edge.get("id")): edge
        for edge in (routing_graph or {}).get("edges", [])
        if edge.get("id") is not None
    }
    result: dict[int, dict[str, Any]] = {}
    for raw_segment_id, segment in ((overlay or {}).get("segments") or {}).items():
        try:
            segment_id = int(raw_segment_id)
        except (TypeError, ValueError):
            continue
        class_counts: dict[str, int] = {}
        evidence: list[dict[str, Any]] = []
        for alignment_key, alignment in (segment.get("alignments") or {}).items():
            published = (alignment or {}).get("published") or {}
            if published.get("disposition") != "accepted":
                continue
            realization = published.get("realization") or {}
            for ref in realization.get("edgeRefs") or []:
                edge = edges_by_id.get(str(ref.get("edgeId")))
                if not edge:
                    continue
                route_class = edge.get("routeClass") or edge.get("highway")
                facility_class = facility_class_from_route_class(route_class)
                if facility_class != "neutral":
                    class_counts[facility_class] = class_counts.get(facility_class, 0) + 1
                evidence.append(
                    {
                        "alignmentKey": alignment_key,
                        "mappingDigest": published.get("mappingDigest"),
                        "edgeId": str(ref.get("edgeId")),
                        "routeClass": route_class,
                        "facilityClass": facility_class,
                    }
                )
        ranked = sorted(class_counts.items(), key=lambda item: (-item[1], item[0]))
        result[segment_id] = {
            "facilityClass": ranked[0][0] if ranked else "neutral",
            "routeClass": ranked[0][0] if ranked else None,
            "classCounts": dict(ranked),
            "evidenceDigest": canonical_sha256(evidence),
        }
    return result


def build_navigation_ways_report(
    source_geojson: dict[str, Any],
    registry: dict[str, Any],
    *,
    is_active,
    routing_evidence_by_segment_id: dict[int, dict[str, Any]] | None = None,
    previous_reviewed_count: int | None = None,
    max_examples: int = 25,
) -> dict[str, Any]:
    """Validate the whole network and produce ``report.navigationWays``.

    Draft/deprecated/legacy segments are excluded from coverage and structure
    review while keeping their authored metadata for diagnostics.
    """
    issues, ways = validate_registry(registry)
    enforcement = registry.get("enforcement")

    active_total = 0
    reviewed = 0
    unreviewed_ids: list[int] = []
    by_role: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    members_by_way: dict[str, list[int]] = {way_id: [] for way_id in ways}
    geometry_by_id: dict[int, list[list[float]]] = {}
    endpoints_by_id: dict[int, tuple[tuple[float, float], tuple[float, float]]] = {}
    evidence_by_id: dict[int, dict[str, Any]] = {}
    routing_evidence_by_segment_id = routing_evidence_by_segment_id or {}

    for feature in source_geojson.get("features", []):
        properties = feature.get("properties") or {}
        if not is_active(feature):
            continue
        active_total += 1
        segment_id = properties.get("id")
        internal_name = properties.get("name") or ""
        coordinates = ((feature.get("geometry") or {}).get("coordinates")) or []
        if isinstance(segment_id, int) and coordinates:
            geometry_by_id[segment_id] = coordinates
            endpoints_by_id[segment_id] = (
                (coordinates[0][0], coordinates[0][1]),
                (coordinates[-1][0], coordinates[-1][1]),
            )
            routing_evidence = routing_evidence_by_segment_id.get(segment_id) or {}
            geometry_digest = canonical_sha256(coordinates)
            fallback_facility_class = (
                "roadway" if properties.get("roadType") == "road" else "neutral"
            )
            evidence_by_id[segment_id] = {
                "routeClass": routing_evidence.get("routeClass"),
                "facilityClass": routing_evidence.get("facilityClass")
                or fallback_facility_class,
                "geometryDigest": geometry_digest,
                "evidenceDigest": canonical_sha256(
                    {
                        "geometryDigest": geometry_digest,
                        "routingEvidence": routing_evidence or None,
                    }
                ),
            }

        record_issues, record, was_reviewed = validate_segment_guidance(
            properties.get("guidance"),
            segment_id=segment_id if isinstance(segment_id, int) else None,
            internal_name=internal_name,
            ways=ways,
        )
        issues.extend(record_issues)
        if not was_reviewed:
            if isinstance(segment_id, int):
                unreviewed_ids.append(segment_id)
            # Missing classification is a warning during migration and a blocker
            # in required mode. It never changes rider-facing behavior: an
            # unreviewed span reads as its facility class.
            issues.append(
                issue(
                    Code.SEGMENT_UNREVIEWED,
                    SEVERITY_ERROR if enforcement == "required" else SEVERITY_WARNING,
                    segmentId=segment_id,
                    internalName=internal_name,
                )
            )
            continue
        reviewed += 1
        if record:
            by_role[record["role"]] = by_role.get(record["role"], 0) + 1
            if record["role"] == "named-way":
                members_by_way.setdefault(record["wayId"], []).append(segment_id)
                kind = ways.get(record["wayId"], {}).get("kind")
            else:
                kind = record.get("kind")
            if kind:
                by_kind[kind] = by_kind.get(kind, 0) + 1

    way_reports: list[dict[str, Any]] = []
    for way_id, way in ways.items():
        member_ids = sorted(member for member in members_by_way.get(way_id, []) if member is not None)
        adjacency, endpoint_only = _member_adjacency(member_ids, endpoints_by_id)
        parallel_pairs = []
        for i, left in enumerate(member_ids):
            for right in member_ids[i + 1 :]:
                left_geometry = geometry_by_id.get(left)
                right_geometry = geometry_by_id.get(right)
                if not left_geometry or not right_geometry:
                    continue
                match = detect_material_parallel(left_geometry, right_geometry)
                if match:
                    pair = {"a": left, "b": right, **match}
                    pair["evidenceDigest"] = canonical_sha256(
                        {
                            "a": evidence_by_id.get(left, {}).get("evidenceDigest"),
                            "b": evidence_by_id.get(right, {}).get("evidenceDigest"),
                            "match": match,
                        }
                    )
                    parallel_pairs.append(pair)

        review = review_way_structure(
            way_id=way_id,
            way_kind=way.get("kind"),
            member_ids=member_ids,
            adjacency=adjacency,
            member_evidence=evidence_by_id,
            acknowledged_issue_fingerprints=way.get("acknowledgedIssueFingerprints") or [],
            parallel_pairs=parallel_pairs,
        )
        issues.extend(review["issues"])
        way_reports.append(
            {
                "wayId": way_id,
                "name": way.get("name"),
                "kind": way.get("kind"),
                "memberCount": len(member_ids),
                "memberIds": member_ids,
                "componentCount": len(review["components"]),
                "maxDegree": review["maxDegree"],
                "legacyEndpointOnlyLinks": sorted(list(pair) for pair in endpoint_only),
                "structureIssues": [
                    {
                        "code": entry["code"],
                        "severity": entry["severity"],
                        "fingerprint": entry.get("fingerprint"),
                        "acknowledged": entry.get("acknowledged", False),
                    }
                    for entry in review["issues"]
                ],
            }
        )

    blocking = [entry for entry in issues if entry["severity"] == SEVERITY_ERROR]
    warnings = [entry for entry in issues if entry["severity"] == SEVERITY_WARNING]

    return {
        "schemaVersion": GUIDANCE_SCHEMA_VERSION,
        "enforcement": enforcement,
        "activeSegments": active_total,
        "reviewedSegments": reviewed,
        "unreviewedSegments": active_total - reviewed,
        "reviewedDelta": (
            reviewed - previous_reviewed_count if previous_reviewed_count is not None else None
        ),
        "coverageComplete": active_total > 0 and reviewed == active_total,
        "countsByRole": dict(sorted(by_role.items())),
        "countsByKind": dict(sorted(by_kind.items())),
        "wayCount": len(ways),
        "ways": sorted(way_reports, key=lambda entry: entry["wayId"]),
        "unreviewedSegmentIds": sorted(unreviewed_ids)[:max_examples],
        "unreviewedSegmentIdsTruncated": len(unreviewed_ids) > max_examples,
        "blockingCount": len(blocking),
        "warningCount": len(warnings),
        "issues": issues,
    }


def manifest_guidance_summary(report: dict[str, Any]) -> dict[str, Any]:
    """Non-path release diagnostics for ``map-manifest.json``.

    ``hashes.segments`` remains the guidance-data integrity authority; this is
    an activation assertion and a coverage readout, not a second naming source.
    """
    conflict_codes = {Code.PARALLEL_FACILITY_RISK, Code.FACILITY_CLASS_CONFLICT}
    return {
        "schemaVersion": report["schemaVersion"],
        "enforcement": report["enforcement"],
        "activeSegments": report["activeSegments"],
        "reviewedSegments": report["reviewedSegments"],
        "coverageComplete": report["coverageComplete"],
        "conflictCount": sum(
            1
            for entry in report["issues"]
            if entry["code"] in conflict_codes and entry["severity"] == SEVERITY_ERROR
        ),
    }
