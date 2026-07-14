import unittest

from processing.match_cycleways_to_osm_graph import (
    EdgeConnectivityIndex,
    directed_ownership_conflicts,
    exact_reverse_alignment,
    propose_opposite_alignment,
)


def edge(edge_id, start, end, start_coord, end_coord, **tags):
    return {
        "type": "Feature",
        "id": edge_id,
        "geometry": {"type": "LineString", "coordinates": [start_coord, end_coord]},
        "properties": {
            "edgeId": edge_id,
            "fromNodeId": start,
            "toNodeId": end,
            "distanceMeters": 100,
            "source": "osm",
            "highway": "trunk",
            **tags,
        },
    }


class DirectionalCyclewaysMatchTests(unittest.TestCase):
    def test_connectivity_contains_allowed_directions_only(self):
        features = [edge("oneway", "a", "b", [35, 33], [35.001, 33], oneway="yes")]
        index = EdgeConnectivityIndex(features)
        self.assertEqual([item["direction"] for item in index.adjacency["a"]], ["forward"])
        self.assertEqual(index.adjacency["b"], [])

    def test_exact_reverse_requires_every_traversal_allowed(self):
        two_way = [edge("two-way", "a", "b", [35, 33], [35.001, 33])]
        valid = exact_reverse_alignment(
            [{"edgeId": "two-way", "direction": "forward", "sequenceIndex": 0}],
            two_way,
        )
        self.assertEqual(valid["status"], "valid")
        one_way = [edge("one-way", "a", "b", [35, 33], [35.001, 33], oneway="yes")]
        invalid = exact_reverse_alignment(
            [{"edgeId": "one-way", "direction": "forward", "sequenceIndex": 0}],
            one_way,
        )
        self.assertEqual(invalid["status"], "invalid")
        self.assertEqual(invalid["reasons"][0]["state"], "prohibited")

    def test_divided_road_uses_complete_parallel_alignment(self):
        # Accepted west-to-east carriageway is one-way. The opposite proposal
        # must use both east-to-west parallel edges; substituting one edge into
        # the accepted sequence cannot satisfy terminal connectivity.
        features = [
            edge("accepted-1", "w", "m", [35.0000, 33.0000], [35.0010, 33.0000], oneway="yes"),
            edge("accepted-2", "m", "e", [35.0010, 33.0000], [35.0020, 33.0000], oneway="yes"),
            edge("parallel-1", "e", "p", [35.0020, 33.00008], [35.0010, 33.00008], oneway="yes"),
            edge("parallel-2", "p", "w", [35.0010, 33.00008], [35.0000, 33.00008], oneway="yes"),
        ]
        proposal = propose_opposite_alignment(
            [
                {"edgeId": "accepted-1", "direction": "forward", "sequenceIndex": 0},
                {"edgeId": "accepted-2", "direction": "forward", "sequenceIndex": 1},
            ],
            features,
            [[35.0000, 33.00004], [35.0020, 33.00004]],
            max_lateral_offset_m=20,
        )
        self.assertEqual(proposal["classification"], "alternate_candidate")
        self.assertEqual(
            [ref["edgeId"] for ref in proposal["edgeRefs"]],
            ["parallel-1", "parallel-2"],
        )
        self.assertTrue(all(ref["direction"] == "forward" for ref in proposal["edgeRefs"]))

    def test_no_corridor_candidate_stays_review_item(self):
        features = [edge("accepted", "w", "e", [35, 33], [35.001, 33], oneway="yes")]
        proposal = propose_opposite_alignment(
            [{"edgeId": "accepted", "direction": "forward", "sequenceIndex": 0}],
            features,
            [[35, 33], [35.001, 33]],
            max_lateral_offset_m=20,
        )
        self.assertEqual(proposal["status"], "no_candidate")
        self.assertEqual(proposal["classification"], "single_direction_candidate")

    def test_active_directed_ownership_is_exclusive_but_archives_do_not_count(self):
        conflicts = directed_ownership_conflicts(
            [
                {"segmentId": 1, "alignmentKey": "aToB", "edgeRefs": [{"edgeId": "x", "direction": "forward"}]},
                {"segmentId": 2, "alignmentKey": "aToB", "edgeRefs": [{"edgeId": "x", "direction": "forward"}]},
                {"segmentId": 3, "alignmentKey": "aToB", "archived": True, "edgeRefs": [{"edgeId": "x", "direction": "forward"}]},
                {"segmentId": 1, "alignmentKey": "bToA", "edgeRefs": [{"edgeId": "x", "direction": "reverse"}]},
            ]
        )
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["directedInterval"][:2], ["x", "forward"])


if __name__ == "__main__":
    unittest.main()
