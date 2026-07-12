"""Pure roundabout candidate/review normalization and join helpers."""

from __future__ import annotations

import math
from typing import Any

SCHEMA_VERSION = 1
VALID_STATUSES = {"accepted", "rejected"}


def valid_candidate_geometry(candidate: dict[str, Any]) -> bool:
    center = candidate.get("center") or {}
    lat = center.get("lat")
    lng = center.get("lng")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return False
    if not math.isfinite(lat) or not math.isfinite(lng):
        return False
    classification = candidate.get("classification")
    if classification == "mini_roundabout":
        return isinstance(candidate.get("radiusM"), (int, float)) and candidate["radiusM"] > 0
    paths = candidate.get("paths")
    if not isinstance(paths, list) or not paths:
        return False
    for path in paths:
        if not isinstance(path, list) or len(path) < 2:
            continue
        if all(
            isinstance(coord, list)
            and len(coord) >= 2
            and isinstance(coord[0], (int, float))
            and isinstance(coord[1], (int, float))
            and math.isfinite(coord[0])
            and math.isfinite(coord[1])
            for coord in path
        ):
            return True
    return False


def join_roundabout_reviews(
    candidates_payload: dict[str, Any],
    review_data: dict[str, Any] | None,
) -> dict[str, Any]:
    blocking_issues: list[dict[str, Any]] = []
    if candidates_payload.get("schemaVersion") != SCHEMA_VERSION:
        blocking_issues.append({"code": "invalid_candidate_schema"})
    reviews_payload = review_data if isinstance(review_data, dict) else {}
    if reviews_payload.get("schemaVersion") != SCHEMA_VERSION:
        blocking_issues.append({"code": "invalid_review_schema"})
    reviews = reviews_payload.get("reviews")
    if not isinstance(reviews, dict):
        reviews = {}
        blocking_issues.append({"code": "invalid_reviews_map"})

    candidates = candidates_payload.get("roundabouts")
    if not isinstance(candidates, list):
        candidates = []
        blocking_issues.append({"code": "invalid_candidates_list"})

    seen: set[str] = set()
    accepted = []
    rejected = []
    pending = []
    stale = []
    items = []

    for candidate in candidates:
        if not isinstance(candidate, dict):
            blocking_issues.append({"code": "invalid_candidate"})
            continue
        candidate_id = candidate.get("id")
        fingerprint = candidate.get("fingerprint")
        if not isinstance(candidate_id, str) or not candidate_id or not isinstance(fingerprint, str):
            blocking_issues.append({"code": "invalid_candidate_identity", "id": candidate_id})
            continue
        if candidate_id in seen:
            blocking_issues.append({"code": "duplicate_candidate_id", "id": candidate_id})
            continue
        seen.add(candidate_id)
        review = reviews.get(candidate_id)
        state = "pending"
        if review is not None:
            if not isinstance(review, dict) or review.get("status") not in VALID_STATUSES:
                blocking_issues.append({"code": "invalid_review", "id": candidate_id})
            elif review.get("fingerprint") != fingerprint:
                state = "stale"
            else:
                state = review["status"]
        item = {"candidate": candidate, "review": review, "state": state}
        items.append(item)
        if state == "accepted":
            if not valid_candidate_geometry(candidate):
                blocking_issues.append({"code": "invalid_accepted_geometry", "id": candidate_id})
            accepted.append(candidate)
        elif state == "rejected":
            rejected.append(candidate)
        elif state == "stale":
            stale.append(candidate)
        else:
            pending.append(candidate)

    orphaned = [
        {"id": key, "review": value}
        for key, value in sorted(reviews.items())
        if key not in seen
    ]
    warnings = []
    coverage = candidates_payload.get("coverage") or {}
    if coverage.get("miniRoundaboutNodes") != "available":
        warnings.append({"code": "mini_roundabout_coverage_incomplete"})
    for candidate in candidates:
        if isinstance(candidate, dict) and candidate.get("warnings"):
            warnings.append({"code": "candidate_warnings", "id": candidate.get("id")})

    if pending:
        blocking_issues.append({"code": "pending_reviews", "count": len(pending)})
    if stale:
        blocking_issues.append({"code": "stale_reviews", "count": len(stale)})

    return {
        "accepted": accepted,
        "rejected": rejected,
        "pending": pending,
        "stale": stale,
        "orphaned": orphaned,
        "items": items,
        "warnings": warnings,
        "blockingIssues": blocking_issues,
        "summary": {
            "total": len(items),
            "accepted": len(accepted),
            "rejected": len(rejected),
            "pending": len(pending),
            "stale": len(stale),
            "orphaned": len(orphaned),
            "warnings": len(warnings),
        },
        "coverage": coverage,
    }
