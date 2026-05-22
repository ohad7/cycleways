import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from processing.build_map import (
    build_base_routing_asset,
    build_public_cycleways_display_geojson,
    write_versioned_outputs,
)


def write_json(path: Path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


class BaseRoutingAssetTests(unittest.TestCase):
    def test_runtime_asset_uses_accepted_overlay_membership(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph_path = root / "osm-base-graph.json"
            overlay_path = root / "cw-base-overlay.json"
            manual_edges_path = root / "manual-base-edges.geojson"
            write_json(
                graph_path,
                {
                    "nodes": [
                        {"id": "n1", "coord": [35, 33]},
                        {"id": "n2", "coord": [35.001, 33]},
                    ],
                    "edges": [
                        {
                            "id": "edge-1",
                            "fromNodeId": "n1",
                            "toNodeId": "n2",
                            "distanceMeters": 93,
                            "coordinates": [[35, 33], [35.001, 33]],
                            "tags": {"osmRouteClass": "path_track"},
                        }
                    ],
                },
            )
            write_json(manual_edges_path, {"type": "FeatureCollection", "features": []})
            write_json(
                overlay_path,
                {
                    "segments": {
                        "7": {
                            "segmentId": 7,
                            "status": "accepted_auto_match",
                            "edgeRefs": [
                                {
                                    "edgeId": "edge-1",
                                    "direction": "forward",
                                    "sequenceIndex": 0,
                                }
                            ],
                        }
                    }
                },
            )

            asset, validation = build_base_routing_asset(
                graph_path,
                overlay_path,
                manual_edges_path,
                {"segment 7": {"id": 7, "status": "active"}},
            )

            self.assertEqual(asset["edges"][0]["cwSegmentIds"], [7])
            self.assertEqual(asset["edges"][0]["routeClass"], "path_track")
            self.assertEqual(validation["graphEdges"], 1)
            self.assertEqual(validation["unresolvedSegments"], 0)

    def test_runtime_asset_compacts_fresh_elevated_endpoint_metrics(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph_path = root / "osm-base-graph-elevated.json"
            base_graph_path = root / "osm-base-graph.json"
            overlay_path = root / "cw-base-overlay.json"
            manual_edges_path = root / "manual-base-edges.geojson"
            base_graph = {
                "nodes": [{"id": "n1", "coord": [35, 33]}, {"id": "n2", "coord": [35.001, 33]}],
                "edges": [],
            }
            write_json(base_graph_path, base_graph)
            write_json(
                graph_path,
                {
                    "metadata": {
                        "elevation": {
                            "sourceGraphDigest": hashlib.sha256(base_graph_path.read_bytes()).hexdigest()
                        }
                    },
                    "nodes": base_graph["nodes"],
                    "edges": [
                        {
                            "id": "edge-1",
                            "fromNodeId": "n1",
                            "toNodeId": "n2",
                            "distanceMeters": 93,
                            "coordinates": [[35, 33], [35.001, 33]],
                            "elevation": {
                                "status": "ready",
                                "profile": [[0, 100], [93, 112.4]],
                            },
                        }
                    ],
                },
            )
            write_json(overlay_path, {"segments": {}})
            write_json(manual_edges_path, {"type": "FeatureCollection", "features": []})

            asset, validation = build_base_routing_asset(
                graph_path,
                overlay_path,
                manual_edges_path,
                {},
                base_graph_path,
            )

            self.assertEqual(asset["schemaVersion"], 2)
            self.assertEqual(
                asset["edges"][0]["elevation"],
                {"fromMeters": 100, "toMeters": 112.4, "netMeters": 12.4},
            )
            self.assertEqual(validation["elevationEdges"], 1)

    def test_public_cycleways_geometry_uses_directed_overlay_edges_and_fallbacks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            overlay_path = root / "cw-base-overlay.json"
            write_json(
                overlay_path,
                {
                    "segments": {
                        "7": {
                            "segmentId": 7,
                            "status": "accepted_auto_match",
                            "edgeRefs": [
                                {
                                    "edgeId": "edge-b",
                                    "direction": "reverse",
                                    "sequenceIndex": 0,
                                },
                                {
                                    "edgeId": "edge-a",
                                    "direction": "reverse",
                                    "sequenceIndex": 1,
                                },
                            ],
                        }
                    }
                },
            )
            source_geojson = {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"id": 7, "name": "accepted segment"},
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [
                                [35, 33, 10],
                                [35.001, 33, 11],
                                [35.002, 33, 12],
                            ],
                        },
                    },
                    {
                        "type": "Feature",
                        "properties": {"id": 8, "name": "fallback segment"},
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[35.3, 33.3, 30], [35.4, 33.4, 31]],
                        },
                    },
                ],
            }
            routing_asset = {
                "edges": [
                    {
                        "id": "edge-a",
                        "coordinates": [[35, 33], [35.001, 33]],
                    },
                    {
                        "id": "edge-b",
                        "coordinates": [[35.001, 33], [35.002, 33]],
                    },
                ]
            }

            public_geojson, validation = build_public_cycleways_display_geojson(
                source_geojson,
                routing_asset,
                overlay_path,
                {
                    "accepted segment": {"id": 7, "status": "active"},
                    "fallback segment": {"id": 8, "status": "active"},
                },
            )

            self.assertEqual(
                public_geojson["features"][0]["geometry"]["coordinates"],
                [[35.002, 33, 12], [35.001, 33, 11], [35, 33, 10]],
            )
            self.assertEqual(
                public_geojson["features"][1]["geometry"]["coordinates"],
                [[35.3, 33.3, 30], [35.4, 33.4, 31]],
            )
            self.assertEqual(validation["derivedSegmentIds"], [7])
            self.assertEqual(validation["sourceFallbackSegmentIds"], [8])

    def test_versioned_manifest_includes_routing_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            out_dir = Path(directory)
            output_geojson = out_dir / "bike_roads.geojson"
            output_segments = out_dir / "segments.json"
            output_kml = out_dir / "map.kml"
            output_routing = out_dir / "base-routing-network.json"
            output_geojson.write_text("{}\n", encoding="utf-8")
            output_segments.write_text("{}\n", encoding="utf-8")
            output_kml.write_text("<kml />\n", encoding="utf-8")
            output_routing.write_text('{"nodes":[],"edges":[]}\n', encoding="utf-8")

            versioned, manifest_path = write_versioned_outputs(
                out_dir,
                output_geojson,
                output_segments,
                output_kml,
                output_routing,
                {"skipElevation": True, "failures": 0},
                {
                    "featureCount": 0,
                    "segmentsCount": 0,
                    "newSegments": [],
                    "baseRouting": {},
                    "cyclewaysDisplayGeometry": {
                        "derivedSegments": 2,
                        "sourceFallbackSegments": 1,
                    },
                },
            )
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

            self.assertIn("baseRoutingNetwork", manifest)
            self.assertEqual(manifest["baseRoutingNetwork"], Path(versioned["baseRoutingNetwork"]).name)
            self.assertTrue((out_dir / manifest["baseRoutingNetwork"]).exists())
            self.assertEqual(manifest["validation"]["overlayDisplaySegments"], 2)
            self.assertEqual(manifest["validation"]["sourceDisplayFallbackSegments"], 1)


if __name__ == "__main__":
    unittest.main()
