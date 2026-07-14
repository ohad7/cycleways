import json
import tempfile
import unittest
from pathlib import Path

from bicycle_traversal_policy import POLICY_DIGEST
from build_map import build_reviewed_crossings, file_digest


def write(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


class CrossingPublicationTests(unittest.TestCase):
    def test_only_confirmed_allowed_mapping_is_published(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph_path = root / "graph.json"
            registry_path = root / "registry.json"
            candidates_path = root / "candidates.json"
            reviews_path = root / "reviews.json"
            output_path = root / "crossings.json"
            graph = {
                "edges": [
                    {
                        "id": f"edge-{share_id}",
                        "fromNodeId": f"node-{share_id - 1}",
                        "toNodeId": f"node-{share_id}",
                        "bicycleTraversalShadow": {
                            "policyDigest": POLICY_DIGEST,
                            "forward": "allowed",
                            "reverse": "allowed",
                        },
                    }
                    for share_id in (1, 2, 3)
                ]
            }
            registry = {"schemaVersion": 1, "nextShareId": 4, "edges": {f"edge-{value}": value for value in (1, 2, 3)}}
            write(graph_path, graph)
            write(registry_path, registry)
            mapping = {
                "id": "mapping-1",
                "match": {
                    "before": [{"edgeShareId": 1, "fromFractionQ": 0, "toFractionQ": 1_000_000}],
                    "action": [{"edgeShareId": 2, "fromFractionQ": 0, "toFractionQ": 1_000_000}],
                    "after": [{"edgeShareId": 3, "fromFractionQ": 0, "toFractionQ": 1_000_000}],
                },
                "entry": {"lat": 33.0, "lng": 35.0},
                "exit": {"lat": 33.0001, "lng": 35.0001},
            }
            candidates = {
                "schemaVersion": 1,
                "sourceGraphDigest": f"sha256:{file_digest(graph_path)}",
                "edgeShareRegistryDigest": f"sha256:{file_digest(registry_path)}",
                "traversalPolicyDigest": POLICY_DIGEST,
                "crossings": [{
                    "id": "crossing-1", "fingerprint": "sha256:one", "kind": "side-change",
                    "center": {"lat": 33.0, "lng": 35.0}, "mappings": [mapping],
                }],
            }
            reviews = {
                "schemaVersion": 1,
                "reviews": {"crossing-1": {
                    "candidateFingerprint": "sha256:one", "status": "accepted",
                    "acceptedMappingIds": ["mapping-1"], "mappingOverrides": [],
                }},
                "manualCrossings": [],
            }
            write(candidates_path, candidates)
            write(reviews_path, reviews)
            validation, result = build_reviewed_crossings(
                candidates_path, reviews_path, graph_path, registry_path, "graph-v3", output_path
            )
            self.assertEqual(result, output_path)
            self.assertEqual(validation["blockingIssues"], [])
            payload = json.loads(output_path.read_text())
            self.assertEqual(payload["graphVersion"], "graph-v3")
            self.assertEqual([value["id"] for value in payload["crossings"]], ["crossing-1"])

            graph["edges"][1]["bicycleTraversalShadow"]["forward"] = "prohibited"
            write(graph_path, graph)
            candidates["sourceGraphDigest"] = f"sha256:{file_digest(graph_path)}"
            write(candidates_path, candidates)
            with self.assertRaisesRegex(ValueError, "not_allowed"):
                build_reviewed_crossings(
                    candidates_path, reviews_path, graph_path, registry_path, "graph-v3", output_path
                )

    def test_zero_confirmed_crossings_omits_runtime_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph_path = root / "graph.json"
            registry_path = root / "registry.json"
            candidates_path = root / "candidates.json"
            reviews_path = root / "reviews.json"
            output_path = root / "crossings.json"
            write(graph_path, {"edges": []})
            write(registry_path, {"schemaVersion": 1, "edges": {}})
            write(candidates_path, {
                "schemaVersion": 1,
                "sourceGraphDigest": f"sha256:{file_digest(graph_path)}",
                "edgeShareRegistryDigest": f"sha256:{file_digest(registry_path)}",
                "traversalPolicyDigest": POLICY_DIGEST,
                "crossings": [],
            })
            write(reviews_path, {"schemaVersion": 1, "reviews": {}, "manualCrossings": []})
            output_path.write_text("stale", encoding="utf-8")
            validation, result = build_reviewed_crossings(
                candidates_path, reviews_path, graph_path, registry_path, "graph-v3", output_path
            )
            self.assertIsNone(result)
            self.assertFalse(output_path.exists())
            self.assertIn("no_confirmed_crossings", [item["code"] for item in validation["warnings"]])


if __name__ == "__main__":
    unittest.main()
