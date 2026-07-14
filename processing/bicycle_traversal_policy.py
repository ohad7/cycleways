#!/usr/bin/env python3
"""Versioned, fail-closed bicycle traversal normalization.

This module is the only build-time interpreter of OSM direction/access tags.
Runtime assets consume its four-valued result and do not repeat OSM precedence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any


POLICY_ID = "il-bicycle-v1"
POLICY_SCHEMA_VERSION = 1
STATES = {"allowed", "prohibited", "conditional", "unknown"}
DIRECTIONS = ("forward", "reverse")

FORWARD_ONLY_VALUES = {"yes", "1", "true"}
TWO_WAY_VALUES = {"no", "0", "false"}
REVERSE_ONLY_VALUES = {"-1", "reverse", "backward"}
VARIABLE_ONEWAY_VALUES = {"reversible", "alternating"}

ACCESS_ALLOWED = {"yes", "permissive", "optional_sidepath", "discouraged"}
BICYCLE_ONLY_ALLOWED = {"designated", "official"}
ACCESS_PROHIBITED = {"no", "use_sidepath", "dismount"}
ACCESS_CONDITIONAL = {
    "private",
    "destination",
    "customers",
    "delivery",
    "agricultural",
    "forestry",
    "military",
    "permit",
}

# Ordered and intentionally explicit. An unmatched source combination is
# unknown; there is no implicit "unspecified means allowed" branch.
DEFAULT_RULES = (
    ({"highway": {"motorway", "motorway_link"}}, "prohibited", "default-motorway"),
    ({"highway": {"steps"}}, "prohibited", "default-steps-dismount-required"),
    ({"highway": {"construction", "proposed", "raceway"}}, "unknown", "default-non-operational"),
    (
        {
            "highway": {
                "cycleway",
                "path",
                "track",
                "footway",
                "pedestrian",
                "living_street",
                "residential",
                "service",
                "unclassified",
                "tertiary",
                "tertiary_link",
                "secondary",
                "secondary_link",
                "primary",
                "primary_link",
                "trunk",
                "trunk_link",
                "road",
            }
        },
        "allowed",
        "default-highway-class",
    ),
)


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def source_geometry_digest(coordinates: list[list[Any]]) -> str:
    """Cross-runtime digest for one unsplit OSM way's stored orientation."""
    normalized: list[list[str]] = []
    for coordinate in coordinates:
        if not isinstance(coordinate, list) or len(coordinate) < 2:
            continue
        values = []
        for value in coordinate[:2]:
            text = f"{float(value):.7f}".rstrip("0").rstrip(".")
            values.append("0" if text in {"", "-0"} else text)
        normalized.append(values)
    return digest_json(normalized)


def policy_definition() -> dict[str, Any]:
    return {
        "policyId": POLICY_ID,
        "schemaVersion": POLICY_SCHEMA_VERSION,
        "states": sorted(STATES),
        "directionPrecedence": ["oneway:bicycle", "oneway", "junction=roundabout", "default"],
        "accessPrecedence": [
            "bicycle:{direction}",
            "bicycle",
            "vehicle:{direction}",
            "vehicle",
            "access:{direction}",
            "access",
            "default",
        ],
        "defaultRules": [
            {"predicate": {key: sorted(values) for key, values in predicate.items()}, "state": state, "reason": reason}
            for predicate, state, reason in DEFAULT_RULES
        ],
    }


POLICY_DIGEST = digest_json(policy_definition())


def _text(value: Any) -> str | None:
    if value is None:
        return None
    result = str(value).strip().lower()
    return result or None


def _tag(tags: dict[str, Any], key: str) -> str | None:
    return _text(tags.get(key))


def _permission_for_mode(mode: str, direction: str) -> bool:
    if mode == "forward_only":
        return direction == "forward"
    if mode == "reverse_only":
        return direction == "reverse"
    return True


def _parse_oneway_value(value: str | None) -> tuple[str | None, str | None]:
    if value in FORWARD_ONLY_VALUES:
        return "forward_only", None
    if value in TWO_WAY_VALUES:
        return "two_way", None
    if value in REVERSE_ONLY_VALUES:
        return "reverse_only", None
    if value in VARIABLE_ONEWAY_VALUES:
        return "variable", None
    if value is None:
        return None, None
    return None, "unsupported-oneway-value"


def _parse_conditional_values(value: str | None, kind: str) -> tuple[list[str], str | None]:
    if value is None:
        return [], None
    modes: list[str] = []
    for clause in value.split(";"):
        clause = clause.strip()
        if "@" not in clause:
            return [], "malformed-conditional"
        raw_value, condition = clause.split("@", 1)
        if not raw_value.strip() or not condition.strip().startswith("(") or not condition.strip().endswith(")"):
            return [], "malformed-conditional"
        raw_value = raw_value.strip().lower()
        if kind == "oneway":
            mode, error = _parse_oneway_value(raw_value)
            if error or mode in (None, "variable"):
                return [], "unsupported-conditional-value"
            modes.append(mode)
        else:
            state, _reason = _parse_access_value(raw_value, bicycle_specific=kind == "bicycle")
            if state == "unknown":
                return [], "unsupported-conditional-value"
            modes.append(state)
    return modes, None


def normalize_direction(tags: dict[str, Any]) -> dict[str, dict[str, Any]]:
    trace: list[dict[str, Any]] = []
    selected_key = None
    base_value = None
    conditional_value = None
    reason = "default-two-way"

    for key in ("oneway:bicycle", "oneway"):
        unconditional = _tag(tags, key)
        conditional = _tag(tags, f"{key}:conditional")
        if unconditional is not None or conditional is not None:
            selected_key = key
            base_value = unconditional
            conditional_value = conditional
            reason = "osm-oneway-bicycle" if key == "oneway:bicycle" else "osm-oneway"
            break

    if selected_key is None and _tag(tags, "junction") == "roundabout":
        selected_key = "junction=roundabout"
        base_mode = "forward_only"
        conditional_modes: list[str] = []
        error = None
        reason = "osm-roundabout-implied-oneway"
    else:
        base_mode, error = _parse_oneway_value(base_value)
        if selected_key is None:
            base_mode = "two_way"
        conditional_modes, conditional_error = _parse_conditional_values(
            conditional_value, "oneway"
        )
        error = error or conditional_error

    trace.append(
        {
            "stage": "direction",
            "selected": selected_key or "default",
            "value": base_value,
            "conditional": conditional_value,
            "baseMode": base_mode,
            "conditionalModes": conditional_modes,
            "error": error,
        }
    )

    result: dict[str, dict[str, Any]] = {}
    for direction in DIRECTIONS:
        if error:
            state = "unknown"
            direction_reason = error
        elif base_mode == "variable":
            state = "conditional"
            direction_reason = "variable-oneway"
        else:
            fallback_allowed = _permission_for_mode(base_mode or "two_way", direction)
            conditional_changes = any(
                _permission_for_mode(mode, direction) != fallback_allowed
                for mode in conditional_modes
            )
            if conditional_changes:
                state = "conditional"
                direction_reason = "conditional-oneway"
            else:
                state = "allowed" if fallback_allowed else "prohibited"
                direction_reason = reason
        result[direction] = {
            "state": state,
            "reason": direction_reason,
            "trace": list(trace),
            "selectedKey": selected_key or "default",
        }

    # Legacy contraflow hints cannot silently override a generic one-way.
    has_bicycle_oneway = selected_key == "oneway:bicycle"
    generic_oneway = selected_key == "oneway" and base_mode in {"forward_only", "reverse_only"}
    cycleway = _tag(tags, "cycleway") or ""
    if generic_oneway and not has_bicycle_oneway and cycleway.startswith("opposite"):
        blocked_direction = "reverse" if base_mode == "forward_only" else "forward"
        result[blocked_direction] = {
            **result[blocked_direction],
            "state": "unknown",
            "reason": "legacy-contraflow-conflict",
        }
    return result


def _parse_access_value(value: str | None, *, bicycle_specific: bool) -> tuple[str, str]:
    if value is None:
        return "unknown", "missing-access-value"
    if value in ACCESS_ALLOWED or (bicycle_specific and value in BICYCLE_ONLY_ALLOWED):
        return "allowed", "explicit-access-allowed"
    if value in ACCESS_PROHIBITED:
        return "prohibited", "explicit-access-prohibited"
    if value in ACCESS_CONDITIONAL:
        return "conditional", "explicit-access-conditional"
    return "unknown", "unsupported-access-value"


def _default_access(tags: dict[str, Any]) -> tuple[str, str]:
    for predicate, state, reason in DEFAULT_RULES:
        if all(_tag(tags, key) in values for key, values in predicate.items()):
            return state, reason
    return "unknown", "default-no-matching-rule"


def normalize_access(tags: dict[str, Any], direction: str) -> dict[str, Any]:
    suffix = "forward" if direction == "forward" else "backward"
    levels = (
        (f"bicycle:{suffix}", True, True),
        ("bicycle", True, False),
        (f"vehicle:{suffix}", False, True),
        ("vehicle", False, False),
        (f"access:{suffix}", False, True),
        ("access", False, False),
    )
    for key, bicycle_specific, directional in levels:
        value = _tag(tags, key)
        conditional = _tag(tags, f"{key}:conditional")
        if value is None and conditional is None:
            continue
        if value is None:
            base_state, base_reason = "allowed", "conditional-only-fallback"
        else:
            base_state, base_reason = _parse_access_value(
                value, bicycle_specific=bicycle_specific
            )
        conditional_states, error = _parse_conditional_values(
            conditional, "bicycle" if bicycle_specific else "access"
        )
        if error or base_state == "unknown":
            state = "unknown"
            reason = error or base_reason
        elif any(candidate != base_state for candidate in conditional_states):
            state = "conditional"
            reason = "conditional-access"
        else:
            state = base_state
            reason = base_reason
        return {
            "state": state,
            "reason": reason,
            "selectedKey": key,
            "directional": directional,
            "trace": {
                "stage": "access",
                "selected": key,
                "value": value,
                "conditional": conditional,
                "conditionalStates": conditional_states,
                "error": error,
            },
        }

    state, reason = _default_access(tags)
    return {
        "state": state,
        "reason": reason,
        "selectedKey": "default",
        "directional": False,
        "trace": {"stage": "access", "selected": "default", "reason": reason},
    }


def _manual_result(manual: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    traversal = manual.get("bicycleTraversal") if isinstance(manual, dict) else None
    for direction in DIRECTIONS:
        state = traversal.get(direction) if isinstance(traversal, dict) else None
        if state not in STATES:
            state = "unknown"
        result[direction] = {
            "state": state,
            "reason": "manual-reviewed" if state != "unknown" else "manual-unreviewed",
            "trace": [{"stage": "manual", "reviewed": state != "unknown"}],
        }
    return result


def normalize_bicycle_traversal(
    tags: dict[str, Any] | None,
    *,
    source: str = "osm",
    manual: dict[str, Any] | None = None,
    override: dict[str, Any] | None = None,
) -> dict[str, Any]:
    tags = tags if isinstance(tags, dict) else {}
    if source == "manual":
        directions = _manual_result(manual or tags)
    else:
        direction_states = normalize_direction(tags)
        directions = {}
        for direction in DIRECTIONS:
            access = normalize_access(tags, direction)
            directional = direction_states[direction]
            if (
                directional["state"] == "prohibited"
                and access["state"] == "allowed"
                and access["directional"]
            ):
                state = "unknown"
                reason = "directional-access-oneway-conflict"
            elif "prohibited" in (directional["state"], access["state"]):
                state = "prohibited"
                reason = (
                    directional["reason"]
                    if directional["state"] == "prohibited"
                    else access["reason"]
                )
            elif "unknown" in (directional["state"], access["state"]):
                state = "unknown"
                reason = (
                    directional["reason"]
                    if directional["state"] == "unknown"
                    else access["reason"]
                )
            elif "conditional" in (directional["state"], access["state"]):
                state = "conditional"
                reason = (
                    directional["reason"]
                    if directional["state"] == "conditional"
                    else access["reason"]
                )
            else:
                state = "allowed"
                reason = access["reason"]
            directions[direction] = {
                "state": state,
                "reason": reason,
                "trace": [*directional["trace"], access["trace"]],
            }

    if override is not None:
        for direction in DIRECTIONS:
            directions[direction] = {
                "state": override["states"][direction],
                "reason": "reviewed-override",
                "trace": [
                    *directions[direction]["trace"],
                    {"stage": "override", "reviewer": override["reviewer"], "reviewedAt": override["reviewedAt"]},
                ],
            }

    return {
        "policyId": POLICY_ID,
        "policyDigest": POLICY_DIGEST,
        "forward": directions["forward"]["state"],
        "reverse": directions["reverse"]["state"],
        "forwardReason": directions["forward"]["reason"],
        "reverseReason": directions["reverse"]["reason"],
        "trace": {
            "forward": directions["forward"]["trace"],
            "reverse": directions["reverse"]["trace"],
        },
    }


def validate_override(record: dict[str, Any], current_source_digest: str) -> None:
    required = ("osmWayId", "sourceGeometryDigest", "states", "rationale", "evidence", "reviewer", "reviewedAt")
    missing = [key for key in required if not record.get(key)]
    if missing:
        raise ValueError(f"override is incomplete: {', '.join(missing)}")
    if record["sourceGeometryDigest"] != current_source_digest:
        raise ValueError("override source geometry digest is stale")
    if set(record["states"]) != set(DIRECTIONS):
        raise ValueError("override must provide exactly forward and reverse states")
    if any(record["states"][direction] not in STATES for direction in DIRECTIONS):
        raise ValueError("override has an invalid traversal state")


def audit_graph(
    graph: dict[str, Any],
    overlay: dict[str, Any] | None = None,
    active_segment_ids: set[int] | None = None,
) -> dict[str, Any]:
    state_counts: Counter[str] = Counter()
    reason_counts: Counter[str] = Counter()
    source_counts: Counter[str] = Counter()
    highway_counts: Counter[str] = Counter()
    queues: dict[str, list[dict[str, Any]]] = {
        "oneway": [],
        "roundabout": [],
        "restricted": [],
        "conditional": [],
        "manual": [],
        "unknown": [],
        "cyclewaysConflicts": [],
        "cyclewaysRoundabout": [],
    }
    results_by_edge_id: dict[str, dict[str, Any]] = {}
    tags_by_edge_id: dict[str, dict[str, Any]] = {}
    for edge in sorted(graph.get("edges", []), key=lambda value: str(value.get("id") or "")):
        tags = edge.get("tags") if isinstance(edge.get("tags"), dict) else {}
        source = str(edge.get("source") or "osm")
        shadow = edge.get("bicycleTraversalShadow")
        result = (
            shadow
            if isinstance(shadow, dict)
            and shadow.get("policyId") == POLICY_ID
            and shadow.get("policyDigest") == POLICY_DIGEST
            else normalize_bicycle_traversal(tags, source=source, manual=tags)
        )
        edge_id = str(edge.get("id") or "")
        results_by_edge_id[edge_id] = result
        tags_by_edge_id[edge_id] = tags
        source_counts[source] += 1
        highway_counts[str(tags.get("highway") or "missing")] += 1
        for direction in DIRECTIONS:
            state = result[direction]
            reason = result[f"{direction}Reason"]
            state_counts[f"{direction}:{state}"] += 1
            reason_counts[f"{direction}:{reason}"] += 1
            item = {"edgeId": edge.get("id"), "direction": direction, "state": state, "reason": reason}
            if state == "conditional":
                queues["conditional"].append(item)
            if state == "unknown":
                queues["unknown"].append(item)
            if state == "prohibited":
                queues["restricted"].append(item)
        if _tag(tags, "oneway") is not None or _tag(tags, "oneway:bicycle") is not None:
            queues["oneway"].append({"edgeId": edge.get("id"), "forward": result["forward"], "reverse": result["reverse"]})
        if _tag(tags, "junction") == "roundabout":
            queues["roundabout"].append({"edgeId": edge.get("id"), "forward": result["forward"], "reverse": result["reverse"]})
        if source == "manual" and "unknown" in (result["forward"], result["reverse"]):
            queues["manual"].append({"edgeId": edge.get("id"), "forward": result["forward"], "reverse": result["reverse"]})

    if isinstance(overlay, dict):
        for raw_segment_id, mapping in sorted(
            (overlay.get("segments") or {}).items(), key=lambda item: int(item[0])
        ):
            segment_id = int(raw_segment_id)
            if active_segment_ids is not None and segment_id not in active_segment_ids:
                continue
            if not isinstance(mapping, dict) or mapping.get("status") not in {
                "accepted_auto_match",
                "accepted_edge_set",
            }:
                continue
            for ref in sorted(mapping.get("edgeRefs") or [], key=lambda value: int(value.get("sequenceIndex") or 0)):
                edge_id = str(ref.get("edgeId") or "")
                direction = "reverse" if ref.get("direction") == "reverse" else "forward"
                result = results_by_edge_id.get(edge_id)
                if result is None:
                    queues["cyclewaysConflicts"].append(
                        {"segmentId": segment_id, "edgeId": edge_id, "direction": direction, "state": "unknown", "reason": "missing-edge"}
                    )
                    continue
                item = {
                    "segmentId": segment_id,
                    "edgeId": edge_id,
                    "direction": direction,
                    "state": result[direction],
                    "reason": result[f"{direction}Reason"],
                }
                if result[direction] != "allowed":
                    queues["cyclewaysConflicts"].append(item)
                if _tag(tags_by_edge_id.get(edge_id, {}), "junction") == "roundabout":
                    queues["cyclewaysRoundabout"].append(item)

    artifact = {
        "schemaVersion": POLICY_SCHEMA_VERSION,
        "policy": policy_definition(),
        "policyDigest": POLICY_DIGEST,
        "sourceGraphDigest": digest_json(graph),
        "counts": {
            "edges": len(graph.get("edges", [])),
            "states": dict(sorted(state_counts.items())),
            "reasons": dict(sorted(reason_counts.items())),
            "sources": dict(sorted(source_counts.items())),
            "highways": dict(sorted(highway_counts.items())),
        },
        "queues": queues,
    }
    artifact["auditDigest"] = digest_json(artifact)
    return artifact


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--graph", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--overlay", type=Path)
    parser.add_argument("--cw-index", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    graph = json.loads(args.graph.read_text(encoding="utf-8"))
    overlay = json.loads(args.overlay.read_text(encoding="utf-8")) if args.overlay else None
    active_segment_ids = None
    if args.cw_index:
        index = json.loads(args.cw_index.read_text(encoding="utf-8"))
        active_segment_ids = {int(value) for value in (index.get("segments") or {})}
    artifact = audit_graph(graph, overlay, active_segment_ids)
    content = json.dumps(artifact, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.check:
        if not args.output.exists() or args.output.read_text(encoding="utf-8") != content:
            raise SystemExit(f"policy audit is stale: {args.output}")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content, encoding="utf-8")
    print(f"{POLICY_ID} {POLICY_DIGEST}: {artifact['counts']['edges']} edges")


if __name__ == "__main__":
    main()
