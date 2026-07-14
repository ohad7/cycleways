import unittest

from bicycle_traversal_policy import POLICY_DIGEST
from build_crossing_candidates import generate_candidates


def edge(edge_id, share_id, from_node, to_node, coordinates, highway, *, crossing=False, tags=None):
    edge_tags = {"highway": highway, **(tags or {})}
    if crossing:
        edge_tags.update({"footway": "crossing", "crossing": "uncontrolled"})
    return {
        "id": edge_id,
        "fromNodeId": from_node,
        "toNodeId": to_node,
        "source": "osm",
        "osmWayId": share_id + 1000,
        "distanceMeters": 10,
        "coordinates": coordinates,
        "tags": edge_tags,
        "bicycleTraversalShadow": {
            "policyDigest": POLICY_DIGEST,
            "forward": "allowed",
            "reverse": "allowed",
        },
    }


class CrossingCandidateTests(unittest.TestCase):
    def test_directed_and_multi_edge_candidates(self):
        edges = [
            edge("before", 1, "p", "a", [[35.0, 33.0], [35.0001, 33.0]], "path"),
            edge("action-a", 2, "a", "m", [[35.0001, 33.0], [35.0002, 33.0]], "footway", crossing=True),
            edge("action-b", 3, "m", "b", [[35.0002, 33.0], [35.0003, 33.0]], "footway", crossing=True),
            edge("after", 4, "b", "q", [[35.0003, 33.0], [35.0004, 33.0]], "path"),
            edge("road", 5, "a", "r", [[35.0001, 32.9998], [35.0001, 33.0002]], "primary"),
        ]
        graph = {"edges": edges}
        registry = {"edges": {value["id"]: index + 1 for index, value in enumerate(edges)}}
        candidates, audit = generate_candidates(graph, registry)
        multi = [candidate for candidate in candidates if "multi-edge-action" in candidate["evidence"]]
        self.assertTrue(multi)
        self.assertTrue(any(len(mapping["match"]["action"]) == 2 for mapping in multi[0]["mappings"]))
        self.assertGreaterEqual(audit["directedMappings"], 1)
        self.assertEqual(candidates, sorted(candidates, key=lambda candidate: candidate["id"]))

    def test_missing_share_id_blocks_generation(self):
        value = edge("action", 1, "a", "b", [[35.0, 33.0], [35.0001, 33.0]], "footway", crossing=True)
        with self.assertRaisesRegex(ValueError, "missing"):
            generate_candidates({"edges": [value]}, {"edges": {}})

    def test_known_bridge_separation_is_not_a_candidate(self):
        edges = [
            edge("before", 1, "p", "a", [[35.0, 33.0], [35.0001, 33.0]], "path"),
            edge("action", 2, "a", "b", [[35.0001, 33.0], [35.0003, 33.0]], "footway", crossing=True),
            edge("after", 3, "b", "q", [[35.0003, 33.0], [35.0004, 33.0]], "path"),
            edge("road", 4, "r", "s", [[35.0002, 32.9998], [35.0002, 33.0002]], "primary", tags={"bridge": "yes", "layer": "1"}),
        ]
        registry = {"edges": {value["id"]: index + 1 for index, value in enumerate(edges)}}
        candidates, audit = generate_candidates({"edges": edges}, registry)
        self.assertEqual(candidates, [])
        self.assertGreaterEqual(audit.get("rejectedKnownGradeSeparation", 0), 1)


if __name__ == "__main__":
    unittest.main()
