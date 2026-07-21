import json
import tempfile
import unittest
from pathlib import Path

from processing.build_map import build_network_junctions


class NetworkJunctionBuildTests(unittest.TestCase):
    def test_compiles_directional_membership_and_runtime_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            candidates = root / "candidates.json"
            reviews = root / "reviews.json"
            output = root / "network-junctions.json"
            candidates.write_text(json.dumps({
                "schemaVersion": 1,
                "junctions": [{
                    "id": "junction-1",
                    "fingerprint": "sha256:j1",
                    "kind": "derived_roundabout",
                    "roundaboutId": "osm-ways:1",
                    "classification": "roundabout",
                    "segmentIds": [10, 11],
                    "ports": [],
                    "movements": [{
                        "id": "a->b",
                        "entryPortId": "a",
                        "exitPortId": "b",
                        "status": "unique",
                        "distanceMeters": 12,
                        "edgeRefs": [{"edgeId": "e1", "direction": "forward"}],
                    }],
                }],
            }), encoding="utf-8")
            reviews.write_text('{"schemaVersion":1,"reviews":{}}', encoding="utf-8")
            asset = {
                "graphVersion": "g1",
                "edges": [{
                    "id": "e1",
                    "shareId": 99,
                    "bicycleTraversal": {"forward": "allowed", "reverse": "prohibited"},
                }],
            }
            validation, result = build_network_junctions(candidates, reviews, asset, output)
            self.assertEqual(result, output)
            self.assertEqual(validation["summary"]["compiledDirectedEdges"], 1)
            self.assertEqual(asset["edges"][0]["cwJunctions"]["forward"][0]["junctionId"], "junction-1")
            self.assertEqual(asset["edges"][0]["cwJunctions"]["reverse"], [])
            runtime = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(runtime["junctions"][0]["movements"][0]["edgeRefs"][0]["edgeShareId"], 99)

            reviews.write_text(json.dumps({
                "schemaVersion": 1,
                "reviews": {"junction-1": {"movements": {"a->b": {
                    "status": "selected",
                    "junctionFingerprint": "sha256:stale",
                }}}},
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "stale_junction_movement_review"):
                build_network_junctions(candidates, reviews, asset, output)


if __name__ == "__main__":
    unittest.main()
