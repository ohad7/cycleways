import json
import unittest
from pathlib import Path

from processing.build_map import (
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
