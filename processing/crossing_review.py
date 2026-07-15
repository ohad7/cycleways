"""Pure crossing candidate/review normalization and publication helpers."""

from __future__ import annotations

import math
from typing import Any

SCHEMA_VERSION = 1
VALID_STATUSES = {"accepted", "rejected"}
FRACTION_SCALE = 1_000_000


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


def valid_coordinate(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and _finite(value.get("lat"))
        and _finite(value.get("lng"))
        and -90 <= value["lat"] <= 90
        and -180 <= value["lng"] <= 180
    )


def valid_slice(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    share_id = value.get("edgeShareId")
    start = value.get("fromFractionQ")
    end = value.get("toFractionQ")
    return (
        isinstance(share_id, int)
        and share_id > 0
        and isinstance(start, int)
        and isinstance(end, int)
        and 0 <= start <= FRACTION_SCALE
        and 0 <= end <= FRACTION_SCALE
        and start != end
    )


def mapping_issue(mapping: Any, *, representation: str = "action-path") -> str | None:
    if not isinstance(mapping, dict) or not isinstance(mapping.get("id"), str) or not mapping["id"]:
        return "invalid_mapping_identity"
    match = mapping.get("match")
    if not isinstance(match, dict):
        return "invalid_mapping_match"
    for section in ("before", "action", "after"):
        slices = match.get(section)
        allow_empty = representation == "junction-transition" and section == "action"
        if (
            not isinstance(slices, list)
            or (not slices and not allow_empty)
            or not all(valid_slice(item) for item in slices)
        ):
            return f"invalid_mapping_{section}"
        signatures = [
            (item["edgeShareId"], item["fromFractionQ"], item["toFractionQ"])
            for item in slices
        ]
        if len(set(signatures)) != len(signatures):
            return f"duplicate_mapping_{section}_slice"
    if representation == "junction-transition" and match.get("action"):
        return "invalid_transition_action"
    if not valid_coordinate(mapping.get("entry")) or not valid_coordinate(mapping.get("exit")):
        return "invalid_mapping_anchors"
    if representation == "junction-transition":
        entry = mapping["entry"]
        exit_anchor = mapping["exit"]
        if abs(entry["lat"] - exit_anchor["lat"]) > 0.000001 or abs(entry["lng"] - exit_anchor["lng"]) > 0.000001:
            return "invalid_transition_anchors"
        continuation = mapping.get("continuation")
        if (
            not isinstance(continuation, dict)
            or continuation.get("type") != "turn"
            or continuation.get("direction") not in {"left", "right"}
        ):
            return "invalid_transition_continuation"
    source_fingerprint = mapping.get("sourceEdgeFingerprint")
    if source_fingerprint is not None and (not isinstance(source_fingerprint, str) or not source_fingerprint):
        return "invalid_source_edge_fingerprint"
    return None


def crossing_issue(crossing: Any, *, require_fingerprint: bool) -> str | None:
    if not isinstance(crossing, dict) or not isinstance(crossing.get("id"), str) or not crossing["id"]:
        return "invalid_crossing_identity"
    if require_fingerprint and (not isinstance(crossing.get("fingerprint"), str) or not crossing["fingerprint"]):
        return "invalid_crossing_fingerprint"
    if crossing.get("kind") != "side-change":
        return "invalid_crossing_kind"
    representation = crossing.get("representation", "action-path")
    if representation not in {"action-path", "junction-transition"}:
        return "invalid_crossing_representation"
    guidance_policy = crossing.get("guidancePolicy", "always")
    if guidance_policy not in {"always", "user-option"}:
        return "invalid_crossing_guidance_policy"
    if guidance_policy == "user-option" and representation != "junction-transition":
        return "invalid_optional_crossing_representation"
    if not valid_coordinate(crossing.get("center")):
        return "invalid_crossing_center"
    mappings = crossing.get("mappings")
    if not isinstance(mappings, list) or not mappings:
        return "invalid_crossing_mappings"
    mapping_ids: set[str] = set()
    for mapping in mappings:
        issue = mapping_issue(mapping, representation=representation)
        if issue:
            return issue
        if mapping["id"] in mapping_ids:
            return "duplicate_mapping_id"
        mapping_ids.add(mapping["id"])
    return None


def _runtime_crossing(candidate: dict[str, Any], mappings: list[dict[str, Any]]) -> dict[str, Any]:
    result = {
        "id": candidate["id"],
        "kind": candidate["kind"],
        "representation": candidate.get("representation", "action-path"),
        "guidancePolicy": candidate.get("guidancePolicy", "always"),
        "center": candidate["center"],
        "bbox": candidate.get("bbox") or [
            candidate["center"]["lng"], candidate["center"]["lat"],
            candidate["center"]["lng"], candidate["center"]["lat"],
        ],
        "mappings": mappings,
    }
    crossed_road = candidate.get("crossedRoad")
    if isinstance(crossed_road, dict):
        result["crossedRoad"] = {
            key: crossed_road[key]
            for key in ("source", "sourceIds", "name", "highway")
            if key in crossed_road
        }
    return result


def join_crossing_reviews(
    candidates_payload: dict[str, Any],
    review_data: dict[str, Any] | None,
) -> dict[str, Any]:
    blocking: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    if candidates_payload.get("schemaVersion") != SCHEMA_VERSION:
        blocking.append({"code": "invalid_candidate_schema"})
    reviews_payload = review_data if isinstance(review_data, dict) else {}
    if reviews_payload.get("schemaVersion") != SCHEMA_VERSION:
        blocking.append({"code": "invalid_review_schema"})
    reviews = reviews_payload.get("reviews")
    if not isinstance(reviews, dict):
        reviews = {}
        blocking.append({"code": "invalid_reviews_map"})
    manual = reviews_payload.get("manualCrossings", [])
    if not isinstance(manual, list):
        manual = []
        blocking.append({"code": "invalid_manual_crossings"})
    candidates = candidates_payload.get("crossings")
    if not isinstance(candidates, list):
        candidates = []
        blocking.append({"code": "invalid_candidates_list"})

    seen: set[str] = set()
    items: list[dict[str, Any]] = []
    buckets: dict[str, list[Any]] = {
        "accepted": [], "rejected": [], "pending": [],
        "staleAccepted": [], "staleRejected": [], "invalid": [],
    }
    runtime: list[dict[str, Any]] = []

    for candidate in candidates:
        candidate_id = candidate.get("id") if isinstance(candidate, dict) else None
        issue = crossing_issue(candidate, require_fingerprint=True)
        if issue or candidate_id in seen:
            code = issue or "duplicate_crossing_id"
            blocking.append({"code": code, "id": candidate_id})
            buckets["invalid"].append(candidate)
            continue
        seen.add(candidate_id)
        review = reviews.get(candidate_id)
        state = "pending"
        selected_mappings: list[dict[str, Any]] = []
        if review is not None:
            if not isinstance(review, dict) or review.get("status") not in VALID_STATUSES:
                state = "invalid"
                blocking.append({"code": "invalid_review", "id": candidate_id})
            elif review.get("candidateFingerprint") != candidate.get("fingerprint"):
                state = "staleAccepted" if review.get("status") == "accepted" else "staleRejected"
            elif review.get("status") == "rejected":
                state = "rejected"
            else:
                accepted_ids = review.get("acceptedMappingIds")
                if not isinstance(accepted_ids, list) or not accepted_ids or not all(isinstance(value, str) for value in accepted_ids):
                    state = "invalid"
                    blocking.append({"code": "accepted_review_without_mappings", "id": candidate_id})
                else:
                    by_id = {mapping["id"]: mapping for mapping in candidate["mappings"]}
                    overrides = review.get("mappingOverrides") or []
                    if not isinstance(overrides, list):
                        overrides = []
                        state = "invalid"
                        blocking.append({"code": "invalid_mapping_overrides", "id": candidate_id})
                    for override in overrides:
                        replaced = override.get("replacesMappingId") if isinstance(override, dict) else None
                        issue_override = mapping_issue(
                            override,
                            representation=candidate.get("representation", "action-path"),
                        )
                        source_fingerprint = override.get("sourceEdgeFingerprint") if isinstance(override, dict) else None
                        if not replaced or not isinstance(source_fingerprint, str) or not source_fingerprint or issue_override:
                            state = "invalid"
                            blocking.append({"code": issue_override or "invalid_mapping_override", "id": candidate_id})
                            continue
                        by_id[replaced] = {key: value for key, value in override.items() if key != "replacesMappingId"}
                    missing = [mapping_id for mapping_id in accepted_ids if mapping_id not in by_id]
                    if missing:
                        state = "invalid"
                        blocking.append({"code": "unknown_accepted_mapping", "id": candidate_id, "mappingIds": missing})
                    elif state != "invalid":
                        state = "accepted"
                        selected_mappings = [by_id[mapping_id] for mapping_id in accepted_ids]
                        runtime.append(_runtime_crossing(candidate, selected_mappings))
        buckets[state].append(candidate)
        items.append({"candidate": candidate, "review": review, "state": state})

    manual_items: list[dict[str, Any]] = []
    for crossing in manual:
        crossing_id = crossing.get("id") if isinstance(crossing, dict) else None
        issue = crossing_issue(crossing, require_fingerprint=False)
        audit = crossing.get("audit") if isinstance(crossing, dict) else None
        source_fingerprint = crossing.get("sourceEdgeFingerprint") if isinstance(crossing, dict) else None
        manual_issue = issue
        if manual_issue is None and (not isinstance(source_fingerprint, str) or not source_fingerprint):
            manual_issue = "invalid_source_edge_fingerprint"
        if manual_issue is None and (
            not isinstance(audit, dict)
            or not isinstance(audit.get("createdAt"), str)
            or not audit.get("createdAt")
            or not isinstance(audit.get("updatedAt"), str)
            or not audit.get("updatedAt")
        ):
            manual_issue = "invalid_manual_audit"
        if manual_issue or crossing_id in seen:
            blocking.append({"code": manual_issue or "duplicate_crossing_id", "id": crossing_id})
            manual_items.append({"crossing": crossing, "state": "invalid"})
            continue
        seen.add(crossing_id)
        runtime.append(_runtime_crossing(crossing, crossing["mappings"]))
        manual_items.append({"crossing": crossing, "state": "manual"})

    orphaned = [
        {"id": key, "review": value}
        for key, value in sorted(reviews.items())
        if key not in seen
    ]
    if buckets["pending"]:
        warnings.append({"code": "pending_reviews", "count": len(buckets["pending"])})
    if buckets["staleRejected"]:
        warnings.append({"code": "stale_rejected_reviews", "count": len(buckets["staleRejected"])})
    if buckets["staleAccepted"]:
        blocking.append({"code": "stale_accepted_reviews", "count": len(buckets["staleAccepted"])})
    if orphaned:
        warnings.append({"code": "orphaned_reviews", "count": len(orphaned)})
    for candidate in candidates:
        if isinstance(candidate, dict) and candidate.get("warnings"):
            warnings.append({"code": "candidate_warnings", "id": candidate.get("id")})

    runtime.sort(key=lambda value: value["id"])
    return {
        **buckets,
        "items": items,
        "manualItems": manual_items,
        "orphaned": orphaned,
        "runtimeCrossings": runtime,
        "warnings": warnings,
        "blockingIssues": blocking,
        "coverage": candidates_payload.get("coverage") or {},
        "summary": {
            "total": len(items),
            "accepted": len(buckets["accepted"]),
            "rejected": len(buckets["rejected"]),
            "pending": len(buckets["pending"]),
            "staleAccepted": len(buckets["staleAccepted"]),
            "staleRejected": len(buckets["staleRejected"]),
            "manual": len([value for value in manual_items if value["state"] == "manual"]),
            "invalid": len(buckets["invalid"]) + len([value for value in manual_items if value["state"] == "invalid"]),
            "orphaned": len(orphaned),
            "warnings": len(warnings),
        },
    }
