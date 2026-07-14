import json
import unittest
from pathlib import Path

from crossing_review import join_crossing_reviews


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


if __name__ == "__main__":
    unittest.main()
