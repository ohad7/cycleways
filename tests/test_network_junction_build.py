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
                    "name": "Test Junction",
                    "navigationKind": "intersection",
                    "publication": {"requestedStatus": "published", "status": "published", "canPublish": True, "issues": []},
                    "fingerprint": "sha256:j1",
                    "kind": "derived_roundabout",
                    "roundaboutId": "osm-ways:1",
                    "classification": "roundabout",
                    "segmentIds": [10, 11],
                    "ports": [{
                        "id": "port-a-entry",
                        "armId": "arm-a",
                        "externalNodeId": "arm-a",
                        "edgeId": "e1",
                        "usage": "entry",
                        "direction": "forward",
                    }, {
                        "id": "port-b-exit",
                        "armId": "arm-b",
                        "externalNodeId": "arm-b",
                        "edgeId": "e1",
                        "usage": "exit",
                        "direction": "forward",
                    }],
                    "armAttachments": [{
                        "segmentId": 10,
                        "endpoint": "b",
                        "armId": "arm-a",
                        "externalNodeId": "arm-a",
                    }, {
                        "segmentId": 11,
                        "endpoint": "a",
                        "armId": "arm-b",
                        "externalNodeId": "arm-b",
                    }],
                    "attachments": [{
                        "source": "arm-attachment",
                        "segmentId": 10,
                        "alignmentKey": "aToB",
                        "endpoint": "b",
                        "usage": "arrive",
                        "armId": "arm-a",
                        "portId": "port-a-entry",
                    }],
                    "movements": [{
                        "id": "a->b",
                        "entryPortId": "port-a-entry",
                        "exitPortId": "port-b-exit",
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
                    "coordinates": [[35.0, 33.0], [35.001, 33.001]],
                }],
            }
            validation, result = build_network_junctions(candidates, reviews, asset, output)
            self.assertEqual(result, output)
            self.assertEqual(validation["summary"]["compiledDirectedEdges"], 1)
            self.assertEqual(validation["summary"]["armAttachments"], 2)
            self.assertEqual(validation["summary"]["directionalAttachments"], 1)
            self.assertEqual(asset["edges"][0]["cwJunctions"]["forward"][0]["junctionId"], "junction-1")
            self.assertEqual(asset["edges"][0]["cwJunctions"]["reverse"], [])
            runtime = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(runtime["junctions"][0]["movements"][0]["edgeRefs"][0]["edgeShareId"], 99)
            self.assertEqual(runtime["junctions"][0]["armAttachments"][0]["segmentId"], 10)
            self.assertEqual(runtime["junctions"][0]["directionalAttachments"][0]["portId"], "port-a-entry")
            self.assertEqual(runtime["junctions"][0]["name"], "Test Junction")
            self.assertEqual(runtime["publicGeometry"]["features"][0]["properties"]["networkRole"], "junction")
            self.assertEqual(asset["edges"][0]["cwJunctions"]["forward"][0]["junctionName"], "Test Junction")

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
