import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from processing.build_osm_base_graph import build_graph, line_length_m, load_json_snapshot
from processing.bicycle_traversal_policy import POLICY_ID, source_geometry_digest
from processing.match_cycleways_to_osm_graph import (
    build_preview,
    build_single_segment_preview,
)


BASE_LNG = 35.0
BASE_LAT = 33.0
METERS_PER_DEG_LNG = 93_000.0
METERS_PER_DEG_LAT = 111_320.0


def coord(x_m, y_m=0.0):
    return [BASE_LNG + x_m / METERS_PER_DEG_LNG, BASE_LAT + y_m / METERS_PER_DEG_LAT]


def line_feature(feature_id, coordinates, properties=None):
    merged_properties = {"id": feature_id, **(properties or {})}
    return {
        "type": "Feature",
        "id": feature_id,
        "geometry": {"type": "LineString", "coordinates": coordinates},
        "properties": merged_properties,
    }


def graph_edge(edge_id, coordinates, from_node, to_node, distance_m=None, properties=None):
    edge_properties = {
        "id": edge_id,
        "edgeId": edge_id,
        "fromNodeId": from_node,
        "toNodeId": to_node,
        "distanceMeters": distance_m if distance_m is not None else len(coordinates),
        "source": "osm",
        "highway": "residential",
        **(properties or {}),
    }
    return line_feature(edge_id, coordinates, edge_properties)


def segment(segment_id, coordinates, properties=None):
    return line_feature(
        segment_id,
        coordinates,
        {"id": segment_id, "name": f"segment {segment_id}", "roadType": "road", **(properties or {})},
    )


def graph_collection(features):
    return {"type": "FeatureCollection", "features": features}


def match_segment(segment_feature, edge_features, *, sample_spacing_m=18.0, max_distance_m=8.0):
    summary, _preview_features = build_single_segment_preview(
        segment_feature,
        graph_collection(edge_features),
        sample_spacing_m=sample_spacing_m,
        max_distance_m=max_distance_m,
        direction_limit_degrees=60.0,
        direction_penalty_m=10.0,
        grid_cell_m=90.0,
    )
    return summary


class OsmMatcherRegressionTests(unittest.TestCase):
    def test_base_graph_input_snapshot_digests_the_parsed_bytes(self):
        contents = b'{"type":"FeatureCollection","features":[]}\n'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.geojson"
            path.write_bytes(contents)
            value, snapshot = load_json_snapshot(path, {})

        self.assertEqual(value["type"], "FeatureCollection")
        self.assertTrue(snapshot["exists"])
        self.assertEqual(snapshot["bytes"], len(contents))
        self.assertEqual(
            snapshot["digest"],
            f"sha256:{hashlib.sha256(contents).hexdigest()}",
        )

    def test_base_graph_reports_internal_build_phases(self):
        performance = {"schemaVersion": 1, "phasesMs": {}}
        raw_osm = graph_collection(
            [
                line_feature(
                    "osm-123",
                    [coord(0), coord(100)],
                    {"osmId": 123, "highway": "track"},
                )
            ]
        )
        _graph, _nodes, _edges, summary = build_graph(
            raw_osm,
            graph_collection([]),
            graph_collection([]),
            node_merge_tolerance_m=2.0,
            split_tolerance_m=8.0,
            min_edge_length_m=1.0,
            performance=performance,
        )

        self.assertEqual(summary["edges"], 1)
        for phase in (
            "graphSetup",
            "osmEdgeBuild",
            "manualEdgeBuild",
            "topologyFinalize",
            "summaryBuild",
        ):
            self.assertIn(phase, performance["phasesMs"])
            self.assertGreaterEqual(performance["phasesMs"][phase], 0)
        self.assertEqual(performance["counts"]["edges"], 1)

    def test_single_segment_match_reports_graph_setup_and_match_timings(self):
        performance = {"schemaVersion": 1, "phasesMs": {}}
        source_segment = segment(77, [coord(0), coord(100)])
        edges = [graph_edge("edge-1", [coord(0), coord(100)], "a", "b", 100)]

        summary, _preview_features = build_single_segment_preview(
            source_segment,
            graph_collection(edges),
            sample_spacing_m=18.0,
            max_distance_m=8.0,
            direction_limit_degrees=60.0,
            direction_penalty_m=10.0,
            grid_cell_m=90.0,
            performance=performance,
        )

        self.assertEqual(summary["segmentId"], 77)
        for phase in (
            "edgeFilter",
            "coordinateBounds",
            "projectionSetup",
            "spatialIndexBuild",
            "connectivityIndexBuild",
            "segmentMatch",
        ):
            self.assertIn(phase, performance["phasesMs"])
            self.assertGreaterEqual(performance["phasesMs"][phase], 0)
        self.assertEqual(performance["counts"]["graphEdges"], 1)
        self.assertEqual(performance["counts"]["connectivityEdges"], 1)
        self.assertGreater(performance["counts"]["segmentSamples"], 1)

    def test_closed_roundabout_with_one_attachment_keeps_the_complete_ring(self):
        a = [round(value, 7) for value in coord(0, 0)]
        b = [round(value, 7) for value in coord(100, 0)]
        c = [round(value, 7) for value in coord(100, 100)]
        d = [round(value, 7) for value in coord(0, 100)]
        ring_coordinates = [a, b, c, d, a]
        raw_osm = graph_collection(
            [
                line_feature(
                    "osm-123",
                    ring_coordinates,
                    {"osmId": 123, "highway": "residential", "junction": "roundabout"},
                ),
                line_feature(
                    "osm-456",
                    [coord(-50, 0), a],
                    {"osmId": 456, "highway": "residential"},
                ),
            ]
        )

        graph, _nodes, _edge_geojson, _summary = build_graph(
            raw_osm,
            graph_collection([]),
            graph_collection([]),
            node_merge_tolerance_m=2.0,
            split_tolerance_m=8.0,
            min_edge_length_m=1.0,
        )

        roundabout_edges = [
            edge for edge in graph["edges"] if edge.get("osmWayId") == 123
        ]
        self.assertEqual([edge["id"] for edge in roundabout_edges], ["e123_1", "e123_2"])
        self.assertEqual(roundabout_edges[0]["coordinates"][0], a)
        self.assertEqual(roundabout_edges[1]["coordinates"][-1], a)
        self.assertEqual(roundabout_edges[0]["toNodeId"], roundabout_edges[1]["fromNodeId"])
        self.assertEqual(roundabout_edges[1]["toNodeId"], roundabout_edges[0]["fromNodeId"])
        self.assertAlmostEqual(
            sum(edge["distanceMeters"] for edge in roundabout_edges),
            line_length_m(ring_coordinates),
            delta=0.2,
        )

    def test_closed_roundabout_emits_the_wrap_slice_as_a_continuous_directed_loop(self):
        a = [round(value, 7) for value in coord(0, 0)]
        b = [round(value, 7) for value in coord(100, 0)]
        c = [round(value, 7) for value in coord(100, 100)]
        d = [round(value, 7) for value in coord(0, 100)]
        raw_osm = graph_collection(
            [
                line_feature(
                    "osm-123",
                    [a, b, c, d, a],
                    {"osmId": 123, "highway": "residential", "junction": "roundabout"},
                ),
                line_feature(
                    "osm-456",
                    [coord(100, -50), b],
                    {"osmId": 456, "highway": "residential"},
                ),
                line_feature(
                    "osm-789",
                    [d, coord(-50, 100)],
                    {"osmId": 789, "highway": "residential"},
                ),
            ]
        )

        graph, _nodes, _edge_geojson, _summary = build_graph(
            raw_osm,
            graph_collection([]),
            graph_collection([]),
            node_merge_tolerance_m=2.0,
            split_tolerance_m=8.0,
            min_edge_length_m=1.0,
        )

        roundabout_edges = [
            edge for edge in graph["edges"] if edge.get("osmWayId") == 123
        ]
        self.assertEqual(
            [edge["id"] for edge in roundabout_edges],
            ["e123_1", "e123_2", "e123_3"],
        )
        self.assertEqual(roundabout_edges[0]["coordinates"], [a, b])
        self.assertEqual(roundabout_edges[1]["coordinates"], [b, c, d])
        self.assertEqual(roundabout_edges[2]["coordinates"], [d, a])
        self.assertEqual(roundabout_edges[0]["toNodeId"], roundabout_edges[1]["fromNodeId"])
        self.assertEqual(roundabout_edges[1]["toNodeId"], roundabout_edges[2]["fromNodeId"])
        self.assertEqual(roundabout_edges[2]["toNodeId"], roundabout_edges[0]["fromNodeId"])
        for edge in roundabout_edges:
            self.assertEqual(edge["bicycleTraversalShadow"]["forward"], "allowed")
            self.assertEqual(edge["bicycleTraversalShadow"]["reverse"], "prohibited")

    def test_reviewed_way_override_applies_to_every_split_and_rejects_stale_geometry(self):
        coordinates = [coord(0), coord(100), coord(200)]
        raw_osm = graph_collection(
            [
                line_feature(
                    "osm-123",
                    coordinates,
                    {"osmId": 123, "highway": "residential", "oneway": "yes"},
                )
            ]
        )
        intersections = graph_collection(
            [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": coord(100)},
                    "properties": {"wayIds": [123]},
                }
            ]
        )
        override = {
            "schemaVersion": 1,
            "policyId": POLICY_ID,
            "overrides": [
                {
                    "osmWayId": 123,
                    "sourceGeometryDigest": source_geometry_digest(coordinates),
                    "states": {"forward": "allowed", "reverse": "allowed"},
                    "rationale": "Reviewed field evidence",
                    "evidence": "survey:fixture",
                    "reviewer": "curator",
                    "reviewedAt": "2026-07-14",
                }
            ],
        }

        graph, _nodes, edge_geojson, summary = build_graph(
            raw_osm,
            intersections,
            graph_collection([]),
            override,
            node_merge_tolerance_m=2.0,
            split_tolerance_m=8.0,
            min_edge_length_m=1.0,
        )

        self.assertEqual(len(graph["edges"]), 2)
        self.assertEqual(graph["metadata"]["reviewedTraversalOverrides"], 1)
        for edge in graph["edges"]:
            self.assertEqual(edge["sourceGeometryDigest"], override["overrides"][0]["sourceGeometryDigest"])
            self.assertEqual(edge["bicycleTraversalShadow"]["reverse"], "allowed")
            self.assertEqual(edge["bicycleTraversalShadow"]["reverseReason"], "reviewed-override")
        for feature in edge_geojson["features"]:
            self.assertEqual(feature["properties"]["bicycleTraversal"]["reverse"], "allowed")
        self.assertEqual(summary["reviewedTraversalOverrides"], 1)

        changed_raw = graph_collection(
            [
                line_feature(
                    "osm-123",
                    [*coordinates, coord(210)],
                    {"osmId": 123, "highway": "residential", "oneway": "yes"},
                )
            ]
        )
        with self.assertRaisesRegex(ValueError, "stale"):
            build_graph(
                changed_raw,
                intersections,
                graph_collection([]),
                override,
                node_merge_tolerance_m=2.0,
                split_tolerance_m=8.0,
                min_edge_length_m=1.0,
            )

    def test_terminal_single_sample_boundary_edge_requires_review(self):
        """Regression for ID 204: an endpoint touching an outgoing edge must not auto-accept."""

        cw_segment = segment(204, [coord(0), coord(300)])
        summary = match_segment(
            cw_segment,
            [
                graph_edge("outgoing-after-end", [coord(300), coord(330)], "n2", "n3", 30.0),
                graph_edge("main-route", [coord(0), coord(300)], "n1", "n2", 300.0),
            ],
        )

        self.assertEqual(summary["coverageRatio"], 1.0)
        self.assertEqual(summary["edgeSequence"], ["main-route", "outgoing-after-end"])
        self.assertEqual(summary["failureClass"], "overmatched_edge")
        self.assertEqual(summary["reviewStatus"], "inspect_edge_sequence")
        self.assertIn(
            "terminal_single_sample_edge",
            summary["overmatchedEdges"][0]["suspiciousReasons"],
        )

    def test_disconnected_matched_edges_are_not_auto_accepted(self):
        """Regression for continuity holes: matched edges must form one continuous route."""

        cw_segment = segment(31, [coord(0), coord(100)])
        summary = match_segment(
            cw_segment,
            [
                graph_edge("first-half", [coord(0), coord(40)], "a", "b", 40.0),
                graph_edge("second-half", [coord(60), coord(100)], "c", "d", 40.0),
            ],
            sample_spacing_m=20.0,
            max_distance_m=5.0,
        )

        self.assertEqual(summary["failureClass"], "disconnected_edges")
        self.assertEqual(summary["reviewStatus"], "inspect_continuity")
        self.assertEqual(summary["continuityGapCount"], 1)
        self.assertEqual(summary["continuityGaps"][0]["fromEdgeId"], "first-half")
        self.assertEqual(summary["continuityGaps"][0]["toEdgeId"], "second-half")

    def test_long_boundary_edge_with_low_sample_support_requires_review(self):
        """Regression for ID 8-style edge sequences with a long first or last overmatch."""

        cw_segment = segment(8, [coord(0), coord(220)])
        summary = match_segment(
            cw_segment,
            [
                graph_edge("long-tail", [coord(220), coord(470)], "b", "c", 250.0),
                graph_edge("route-main", [coord(0), coord(220)], "a", "b", 220.0),
            ],
            sample_spacing_m=18.0,
            max_distance_m=8.0,
        )

        self.assertEqual(summary["edgeSequence"], ["route-main", "long-tail"])
        self.assertEqual(summary["failureClass"], "overmatched_edge")
        self.assertIn(
            "boundary_sliver_low_support",
            summary["overmatchedEdges"][0]["suspiciousReasons"],
        )

    def test_build_preview_ignores_deprecated_cycleways_segments(self):
        """Regression for duplicate ownership reports involving inactive/deprecated segments."""

        active = segment(147, [coord(0), coord(50)])
        deprecated = segment(148, [coord(0), coord(50)], {"status": "deprecated"})
        graph = graph_collection([graph_edge("shared-edge", [coord(0), coord(50)], "a", "b", 50.0)])

        _preview, summary, matches = build_preview(
            graph_collection([active, deprecated]),
            graph,
            sample_spacing_m=18.0,
            max_distance_m=8.0,
            direction_limit_degrees=60.0,
            direction_penalty_m=10.0,
            grid_cell_m=90.0,
        )

        self.assertEqual(summary["sourceSegments"], 1)
        self.assertEqual([item["segmentId"] for item in matches["segments"]], [147])

    def test_manual_copy_replaces_original_osm_edge_in_base_graph(self):
        """Regression for copied manual base edges still participating beside their parent."""

        raw_osm = graph_collection(
            [
                line_feature(
                    "osm-123",
                    [coord(0), coord(100)],
                    {"osmId": 123, "highway": "track"},
                )
            ]
        )
        manual_edges = graph_collection(
            [
                line_feature(
                    "manual-copy",
                    [coord(0), coord(100)],
                    {
                        "manualEdgeId": "manual-copy",
                        "source": "manual",
                        "copiedFromEdgeId": "e123_1",
                        "copiedFromOsmWayId": 123,
                    },
                )
            ]
        )

        _graph, _nodes, edge_geojson, _summary = build_graph(
            raw_osm,
            graph_collection([]),
            manual_edges,
            node_merge_tolerance_m=2.0,
            split_tolerance_m=8.0,
            min_edge_length_m=1.0,
        )

        edge_ids = [feature["properties"]["edgeId"] for feature in edge_geojson["features"]]
        self.assertNotIn("e123_1", edge_ids)
        self.assertIn("manual-copy", edge_ids)

    def test_manual_copy_does_not_renumber_unrelated_base_graph_nodes(self):
        """Replacing one base edge must not churn node ids across unrelated shards."""

        raw_osm = graph_collection(
            [
                line_feature(
                    "osm-123",
                    [coord(0), coord(100)],
                    {"osmId": 123, "highway": "track"},
                ),
                line_feature(
                    "osm-456",
                    [coord(200), coord(300)],
                    {"osmId": 456, "highway": "track"},
                ),
            ]
        )
        manual_edges = graph_collection(
            [
                line_feature(
                    "manual-copy",
                    [coord(0), coord(100)],
                    {
                        "manualEdgeId": "manual-copy",
                        "source": "manual",
                        "copiedFromEdgeId": "e123_1",
                        "copiedFromOsmWayId": 123,
                    },
                )
            ]
        )

        graph_before, _nodes_before, _edges_before, _summary_before = build_graph(
            raw_osm,
            graph_collection([]),
            graph_collection([]),
            node_merge_tolerance_m=2.0,
            split_tolerance_m=8.0,
            min_edge_length_m=1.0,
        )
        graph_after, _nodes_after, _edges_after, _summary_after = build_graph(
            raw_osm,
            graph_collection([]),
            manual_edges,
            node_merge_tolerance_m=2.0,
            split_tolerance_m=8.0,
            min_edge_length_m=1.0,
        )

        edge_before = next(edge for edge in graph_before["edges"] if edge["id"] == "e456_1")
        edge_after = next(edge for edge in graph_after["edges"] if edge["id"] == "e456_1")
        self.assertEqual(edge_after["fromNodeId"], edge_before["fromNodeId"])
        self.assertEqual(edge_after["toNodeId"], edge_before["toNodeId"])


if __name__ == "__main__":
    unittest.main()
