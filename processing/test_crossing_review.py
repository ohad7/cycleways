import json
import unittest
from pathlib import Path

from crossing_review import crossing_issue, join_crossing_reviews


class CrossingReviewTests(unittest.TestCase):
    def test_fixture_states_and_runtime(self):
        fixture = json.loads(
            (Path(__file__).parents[1] / "tests/fixtures/crossing-review-cases.json").read_text()
        )
        joined = join_crossing_reviews(fixture["candidates"], fixture["reviews"])
        self.assertEqual(joined["summary"], {
            "total": 3, "accepted": 1, "rejected": 0, "pending": 1,
            "staleAccepted": 0, "staleRejected": 1, "manual": 1,
            "invalid": 0, "orphaned": 1, "warnings": 3,
        })
        self.assertEqual(
            [crossing["id"] for crossing in joined["runtimeCrossings"]],
            ["crossing-accepted", "manual-crossing-1"],
        )
        self.assertEqual(joined["blockingIssues"], [])

    def test_junction_transition_requires_empty_action_and_continuation(self):
        crossing = {
            "id": "manual-crossing-transition",
            "kind": "side-change",
            "representation": "junction-transition",
            "guidancePolicy": "user-option",
            "center": {"lat": 33.2, "lng": 35.5},
            "mappings": [{
                "id": "mapping-transition",
                "match": {
                    "before": [{"edgeShareId": 1, "fromFractionQ": 1_000_000, "toFractionQ": 0}],
                    "action": [],
                    "after": [{"edgeShareId": 2, "fromFractionQ": 1_000_000, "toFractionQ": 0}],
                },
                "entry": {"lat": 33.2, "lng": 35.5},
                "exit": {"lat": 33.2, "lng": 35.5},
                "continuation": {"type": "turn", "direction": "left"},
            }],
        }
        self.assertIsNone(crossing_issue(crossing, require_fingerprint=False))
        crossing["mappings"][0]["match"]["action"] = [
            {"edgeShareId": 3, "fromFractionQ": 0, "toFractionQ": 1_000_000}
        ]
        self.assertEqual(
            crossing_issue(crossing, require_fingerprint=False),
            "invalid_transition_action",
        )
        crossing["mappings"][0]["match"]["action"] = []
        del crossing["mappings"][0]["continuation"]
        self.assertEqual(
            crossing_issue(crossing, require_fingerprint=False),
            "invalid_transition_continuation",
        )


if __name__ == "__main__":
    unittest.main()
