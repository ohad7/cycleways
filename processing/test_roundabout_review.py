#!/usr/bin/env python3
"""Plain-assert conformance tests for roundabout_review.py."""

import json
from pathlib import Path

from roundabout_review import join_roundabout_reviews


fixture_path = Path(__file__).parent.parent / "tests/fixtures/roundabout-review-cases.json"
fixture = json.loads(fixture_path.read_text())
for case in fixture["cases"]:
    result = join_roundabout_reviews(case["candidates"], case["reviews"])
    expected = case["expected"]
    for key in ("total", "accepted", "rejected", "pending", "stale", "orphaned"):
        assert result["summary"][key] == expected[key], (case["name"], key, result["summary"])
    codes = [issue["code"] for issue in result["blockingIssues"]]
    assert codes == expected["blockingCodes"], (case["name"], codes)

print("roundabout_review tests passed")
