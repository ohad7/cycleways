import unittest
from collections import Counter

from processing.match_cycleways_to_osm_graph import (
    build_edge_support_diagnostics,
    edge_continuity_diagnostics,
)


class CyclewaysOsmMatchTests(unittest.TestCase):
    def test_terminal_single_sample_edge_with_high_support_is_not_overmatched(self):
        edge_features = [
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[35, 33], [35.00018, 33]]},
                "properties": {"edgeId": "edge-terminal", "distanceMeters": 18.8},
            }
        ]
        edge_stats = {
            "edge-terminal": {
                "featureIndex": 0,
                "sampleCount": 1,
            }
        }

        diagnostics, _ratio = build_edge_support_diagnostics(
            edge_stats,
            edge_features,
            edge_sequence=["edge-terminal"],
            total_length_m=737,
            sample_spacing_m=18,
        )

        self.assertEqual(diagnostics[0]["edgeId"], "edge-terminal")
        self.assertFalse(diagnostics[0]["suspicious"])
        self.assertEqual(diagnostics[0]["suspiciousReasons"], [])

    def test_terminal_single_sample_edge_with_low_support_stays_overmatched(self):
        edge_features = [
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[35, 33], [35.0009, 33]]},
                "properties": {"edgeId": "edge-terminal", "distanceMeters": 100},
            }
        ]
        edge_stats = {
            "edge-terminal": {
                "featureIndex": 0,
                "sampleCount": 1,
            }
        }

        diagnostics, _ratio = build_edge_support_diagnostics(
            edge_stats,
            edge_features,
            edge_sequence=["edge-terminal"],
            total_length_m=737,
            sample_spacing_m=18,
        )

        self.assertTrue(diagnostics[0]["suspicious"])
        self.assertIn("terminal_single_sample_edge", diagnostics[0]["suspiciousReasons"])

    def test_continuity_detects_topology_gap_even_when_coordinates_touch(self):
        edge_features = [
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[35, 33], [35.001, 33]]},
                "properties": {
                    "edgeId": "edge-a",
                    "fromNodeId": "node-a-start",
                    "toNodeId": "node-a-end",
                },
            },
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[35.001, 33], [35.002, 33]]},
                "properties": {
                    "edgeId": "edge-b",
                    "fromNodeId": "node-b-start",
                    "toNodeId": "node-b-end",
                },
            },
        ]
        edge_stats = {
            "edge-a": {"featureIndex": 0, "directions": Counter({"forward": 1})},
            "edge-b": {"featureIndex": 1, "directions": Counter({"forward": 1})},
        }

        gaps, features = edge_continuity_diagnostics(
            ["edge-a", "edge-b"],
            edge_stats,
            edge_features,
            {"id": 10, "name": "גן הצפון"},
        )

        self.assertEqual(len(gaps), 1)
        self.assertEqual(gaps[0]["issue"], "edge topology nodes do not connect")
        self.assertEqual(gaps[0]["fromNodeId"], "node-a-end")
        self.assertEqual(gaps[0]["toNodeId"], "node-b-start")
        self.assertEqual(features[0]["properties"]["kind"], "continuityGap")


if __name__ == "__main__":
    unittest.main()
