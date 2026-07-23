import json
import unittest
from pathlib import Path

from processing import navigation_ways as nav_ways
from processing.build_map import (
    is_active_source_feature,
    resolve_navigation_guidance,
    source_segments_from_geojson,
)


ROOT = Path(__file__).resolve().parents[1]


class NavigationWaysBuildTest(unittest.TestCase):
    def test_reference_ride_memberships_resolve_without_name_inference(self):
        source = json.loads((ROOT / "data/map-source.geojson").read_text())
        registry = json.loads((ROOT / "data/navigation-ways.json").read_text())
        segments = resolve_navigation_guidance(
            source_segments_from_geojson(source),
            registry,
        )

        self.assertEqual(
            segments["שביל תל חי"]["guidance"]["guidanceIdentity"],
            "way:tel-hai-trail",
        )
        self.assertEqual(
            segments["כביש 9974"]["guidance"]["guidanceIdentity"],
            segments["כביש 9974 כפר יובל"]["guidance"]["guidanceIdentity"],
        )
        self.assertEqual(
            segments["שביל אופניים 99 כפר יובל"]["guidance"]["guidanceIdentity"],
            segments["שביל אופניים 99 מעיין ברוך"]["guidance"]["guidanceIdentity"],
        )
        self.assertNotEqual(
            segments["כביש 99 קריית שמונה"]["guidance"]["guidanceIdentity"],
            segments["שביל אופניים 99 כפר יובל"]["guidance"]["guidanceIdentity"],
        )

    def test_unknown_way_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "unknown way"):
            resolve_navigation_guidance(
                {"Broken": {"id": 1, "guidance": {"role": "named-way", "wayId": "missing"}}},
                {"schemaVersion": 1, "enforcement": "migration", "ways": {}},
            )


if __name__ == "__main__":
    unittest.main()


class NavigationWaysSharedFixtureTest(unittest.TestCase):
    """Parity with packages/core/src/data/navigationWayValidation.js.

    Both implementations run the same fixture file, so editor validation and
    build validation cannot drift.
    """

    @classmethod
    def setUpClass(cls):
        cls.fixtures = json.loads(
            (ROOT / "tests/fixtures/navigation-way-names/schema-cases.json").read_text()
        )

    def _assert_issues(self, actual, expected, label):
        self.assertEqual(
            sorted(entry["code"] for entry in actual),
            sorted(entry["code"] for entry in expected),
            label,
        )
        for want in expected:
            found = next(entry for entry in actual if entry["code"] == want["code"])
            for key, value in want.items():
                if key == "code":
                    continue
                self.assertEqual(found.get(key), value, f"{label}: {want['code']}.{key}")

    def test_registry_cases(self):
        for case in self.fixtures["registryCases"]:
            with self.subTest(case["name"]):
                issues, _ = nav_ways.validate_registry(case["registry"])
                self._assert_issues(issues, case["expectedIssues"], case["name"])

    def test_segment_cases(self):
        for case in self.fixtures["segmentCases"]:
            with self.subTest(case["name"]):
                ways = {way_id: {"wayId": way_id} for way_id in case.get("knownWayIds", [])}
                issues, _, reviewed = nav_ways.validate_segment_guidance(
                    case["guidance"],
                    segment_id=case["segmentId"],
                    internal_name=case["internalName"],
                    ways=ways,
                )
                self._assert_issues(issues, case["expectedIssues"], case["name"])
                self.assertEqual(reviewed, case["expectedReviewed"], case["name"])

    def test_structure_cases(self):
        for case in self.fixtures["structureCases"]:
            with self.subTest(case["name"]):
                adjacency = {
                    int(key): {int(value) for value in values}
                    for key, values in (case.get("adjacency") or {}).items()
                }
                evidence = {
                    int(key): value
                    for key, value in (case.get("memberEvidence") or {}).items()
                }
                result = nav_ways.review_way_structure(
                    way_id=case["wayId"],
                    way_kind=case["wayKind"],
                    member_ids=case["memberIds"],
                    adjacency=adjacency,
                    member_evidence=evidence,
                    acknowledged_issue_fingerprints=case.get(
                        "acknowledgedIssueFingerprints", []
                    ),
                    parallel_pairs=case.get("parallelPairs", []),
                )
                self._assert_issues(result["issues"], case["expectedIssues"], case["name"])
                self.assertEqual(len(result["components"]), case["expectedComponentCount"])
                self.assertEqual(result["maxDegree"], case["expectedMaxDegree"])

    def test_fingerprints_match_javascript_format(self):
        self.assertEqual(
            nav_ways.structure_issue_fingerprint(
                "way-structure-branching", "x", {"branchNodes": [2, 1], "maxDegree": 3}
            ),
            "way-structure-branching|x|branchNodes=1,2|maxDegree=3",
        )

    def test_material_parallel_detector(self):
        road = [[35.6 + i * 0.0003, 33.2] for i in range(21)]
        cycleway = [[35.6 + i * 0.0003, 33.200135] for i in range(21)]
        parallel = nav_ways.detect_material_parallel(road, cycleway)
        self.assertIsNotNone(parallel)
        self.assertGreater(parallel["overlapMeters"], 400)

        crossing = [[35.603, 33.19 + i * 0.001] for i in range(21)]
        self.assertIsNone(nav_ways.detect_material_parallel(road, crossing))

        continuation = [[35.606 + i * 0.0003, 33.2] for i in range(21)]
        self.assertIsNone(nav_ways.detect_material_parallel(road, continuation))


class NavigationWaysReportTest(unittest.TestCase):
    def test_current_network_report_shape(self):
        source = json.loads((ROOT / "data/map-source.geojson").read_text())
        registry = json.loads((ROOT / "data/navigation-ways.json").read_text())
        report = nav_ways.build_navigation_ways_report(
            source, registry, is_active=is_active_source_feature
        )
        self.assertEqual(report["schemaVersion"], 1)
        self.assertGreater(report["activeSegments"], 0)
        self.assertEqual(
            report["activeSegments"],
            report["reviewedSegments"] + report["unreviewedSegments"],
        )
        # Migration mode: unreviewed segments are reported, never blocking.
        self.assertEqual(report["blockingCount"], 0)
        self.assertFalse(report["coverageComplete"])

        summary = nav_ways.manifest_guidance_summary(report)
        self.assertEqual(
            set(summary),
            {
                "schemaVersion",
                "enforcement",
                "activeSegments",
                "reviewedSegments",
                "coverageComplete",
                "conflictCount",
            },
        )

    def test_required_mode_blocks_unclassified_segments(self):
        source = json.loads((ROOT / "data/map-source.geojson").read_text())
        registry = json.loads((ROOT / "data/navigation-ways.json").read_text())
        report = nav_ways.build_navigation_ways_report(
            source,
            {**registry, "enforcement": "required"},
            is_active=is_active_source_feature,
        )
        self.assertGreater(report["blockingCount"], 0)


if __name__ == "__main__":
    unittest.main()
