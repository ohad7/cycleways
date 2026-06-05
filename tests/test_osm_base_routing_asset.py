import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from processing.build_map import (
    build_base_routing_asset,
    build_base_routing_shards,
    build_public_cw_base_index,
    build_public_cycleways_display_geojson,
    validate_outputs,
    write_base_routing_shards,
    write_runtime_manifest,
    write_site_geojson,
)


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


class BaseRoutingAssetTests(unittest.TestCase):
    def test_validate_outputs_flags_active_placeholder_segment_names(self):
        def segment(segment_id, status="active", deprecated=False):
            return {
                "id": segment_id,
                "status": status,
                "deprecated": deprecated,
                "middle": [33.0, 35.0],
                "quality": {
                    "overall": 3,
                    "safety": 3,
                    "comfort": 3,
                    "scenery": 3,
                },
            }

        segments_data = {
            "New segment": segment(1),
            "new segment - 3": segment(2),
            "New segment - 4": segment(3, status="draft"),
            "New segment - 5": segment(4, deprecated=True),
            "שביל אופניים דפנה": segment(5),
        }
        geojson_data = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"name": name, "id": data["id"], "status": data["status"]},
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[35.0, 33.0], [35.001, 33.0]],
                    },
                }
                for name, data in segments_data.items()
            ],
        }

        validation = validate_outputs(
            geojson_data,
            segments_data,
            segments_data,
            [],
            12.0,
        )

        self.assertEqual(
            validation["placeholderSegmentNames"],
            [
                {
                    "segment": "New segment",
                    "id": 1,
                    "issue": "active segment still has a placeholder name",
                },
                {
                    "segment": "new segment - 3",
                    "id": 2,
                    "issue": "active segment still has a placeholder name",
                },
            ],
        )

    def test_site_geojson_writer_keeps_coordinate_diffs_local(self):
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "bike_roads.geojson"
            write_site_geojson(
                output_path,
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {"id": 1, "name": "segment"},
                            "geometry": {
                                "type": "LineString",
                                "coordinates": [
                                    [35.1, 33.1, 10],
                                    [35.2, 33.2, 11],
                                ],
                            },
                        }
                    ],
                },
            )

            content = output_path.read_text(encoding="utf-8")
            parsed = json.loads(content)
            self.assertEqual(parsed["features"][0]["properties"]["id"], 1)
            self.assertIn("\n      [35.1,33.1,10],\n      [35.2,33.2,11]\n", content)

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
            self.assertEqual(asset["edges"][0]["shareId"], 1)
            self.assertEqual(validation["graphEdges"], 1)
            self.assertEqual(validation["unresolvedSegments"], 0)

            public_index, index_validation = build_public_cw_base_index(
                asset,
                overlay_path,
                {"segment 7": {"id": 7, "status": "active"}},
            )
            self.assertEqual(public_index["segments"]["7"], [[1, 0]])
            self.assertEqual(index_validation["segments"], 1)
            self.assertEqual(index_validation["edgeRefs"], 1)

    def test_runtime_asset_updates_stable_share_id_registry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph_path = root / "osm-base-graph.json"
            overlay_path = root / "cw-base-overlay.json"
            manual_edges_path = root / "manual-base-edges.geojson"
            registry_path = root / "base-edge-share-ids.json"
            write_json(
                graph_path,
                {
                    "nodes": [
                        {"id": "n1", "coord": [35, 33]},
                        {"id": "n2", "coord": [35.001, 33]},
                        {"id": "n3", "coord": [35.002, 33]},
                    ],
                    "edges": [
                        {
                            "id": "edge-existing",
                            "fromNodeId": "n1",
                            "toNodeId": "n2",
                            "distanceMeters": 93,
                            "coordinates": [[35, 33], [35.001, 33]],
                        },
                        {
                            "id": "edge-new",
                            "fromNodeId": "n2",
                            "toNodeId": "n3",
                            "distanceMeters": 93,
                            "coordinates": [[35.001, 33], [35.002, 33]],
                        },
                    ],
                },
            )
            write_json(registry_path, {"schemaVersion": 1, "nextShareId": 8, "edges": {"edge-existing": 7, "retired": 3}})
            write_json(overlay_path, {"segments": {}})
            write_json(manual_edges_path, {"type": "FeatureCollection", "features": []})

            asset, validation = build_base_routing_asset(
                graph_path,
                overlay_path,
                manual_edges_path,
                {},
                base_edge_share_ids_path=registry_path,
            )

            share_ids = {edge["id"]: edge["shareId"] for edge in asset["edges"]}
            self.assertEqual(share_ids["edge-existing"], 7)
            self.assertEqual(share_ids["edge-new"], 8)
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            self.assertEqual(registry["edges"]["retired"], 3)
            self.assertEqual(registry["nextShareId"], 9)
            self.assertEqual(validation["shareIds"]["newIds"], 1)
            self.assertEqual(validation["shareIds"]["retiredIds"], 1)

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

    def test_runtime_asset_blocks_unaccepted_active_segments(self):
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
                        }
                    ],
                },
            )
            write_json(overlay_path, {"segments": {}})
            write_json(manual_edges_path, {"type": "FeatureCollection", "features": []})

            with self.assertRaisesRegex(ValueError, "no accepted base overlay mapping"):
                build_base_routing_asset(
                    graph_path,
                    overlay_path,
                    manual_edges_path,
                    {"segment 7": {"id": 7, "status": "active"}},
                )

    def test_runtime_asset_blocks_severe_accepted_length_mismatch(self):
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
                        }
                    ],
                },
            )
            write_json(
                overlay_path,
                {
                    "segments": {
                        "7": {
                            "segmentId": 7,
                            "segmentName": "short accepted mapping",
                            "status": "accepted_auto_match",
                            "edgeRefs": [{"edgeId": "edge-1", "direction": "forward", "sequenceIndex": 0}],
                        }
                    }
                },
            )
            write_json(manual_edges_path, {"type": "FeatureCollection", "features": []})
            source_geojson = {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"id": 7, "name": "long source segment", "status": "active"},
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[35, 33], [35.01, 33]],
                        },
                    }
                ],
            }

            with self.assertRaisesRegex(ValueError, "accepted mapping length differs"):
                build_base_routing_asset(
                    graph_path,
                    overlay_path,
                    manual_edges_path,
                    {"segment 7": {"id": 7, "status": "active"}},
                    source_geojson=source_geojson,
                )

    def test_runtime_asset_blocks_coordinate_touching_topology_gap(self):
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
                        {"id": "n3", "coord": [35.001, 33]},
                        {"id": "n4", "coord": [35.002, 33]},
                    ],
                    "edges": [
                        {
                            "id": "edge-1",
                            "fromNodeId": "n1",
                            "toNodeId": "n2",
                            "distanceMeters": 93,
                            "coordinates": [[35, 33], [35.001, 33]],
                        },
                        {
                            "id": "edge-2",
                            "fromNodeId": "n3",
                            "toNodeId": "n4",
                            "distanceMeters": 93,
                            "coordinates": [[35.001, 33], [35.002, 33]],
                        },
                    ],
                },
            )
            write_json(
                overlay_path,
                {
                    "segments": {
                        "7": {
                            "segmentId": 7,
                            "segmentName": "coordinate touching topology gap",
                            "status": "accepted_auto_match",
                            "edgeRefs": [
                                {"edgeId": "edge-1", "direction": "forward", "sequenceIndex": 0},
                                {"edgeId": "edge-2", "direction": "forward", "sequenceIndex": 1},
                            ],
                        }
                    }
                },
            )
            write_json(manual_edges_path, {"type": "FeatureCollection", "features": []})
            source_geojson = {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"id": 7, "name": "source segment", "status": "active"},
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[35, 33], [35.001, 33], [35.002, 33]],
                        },
                    }
                ],
            }

            with self.assertRaisesRegex(ValueError, "edge topology is disconnected"):
                build_base_routing_asset(
                    graph_path,
                    overlay_path,
                    manual_edges_path,
                    {"segment 7": {"id": 7, "status": "active"}},
                    source_geojson=source_geojson,
                )

    def test_runtime_shards_duplicate_boundary_edges_and_describe_manifest(self):
        manifest, shards, report = build_base_routing_shards(
            {
                "schemaVersion": 2,
                "generatedAt": "2026-05-22T00:00:00Z",
                "nodes": [
                    {"id": "n1", "coord": [35.049, 33]},
                    {"id": "n2", "coord": [35.051, 33]},
                ],
                "edges": [
                    {
                        "id": "edge-across-boundary",
                        "from": "n1",
                        "to": "n2",
                        "distanceMeters": 180,
                        "coordinates": [[35.049, 33], [35.051, 33]],
                    }
                ],
            },
            shard_size_degrees=0.05,
        )

        self.assertEqual(manifest["schemaVersion"], 1)
        self.assertEqual(manifest["shardSchemaVersion"], 1)
        self.assertEqual(manifest["routeShare"]["edgeShareIds"], "embedded-in-shards")
        self.assertEqual(
            manifest["scheme"]["edgeBoundaryPolicy"],
            "duplicate-edge-bbox-intersections",
        )
        self.assertEqual(manifest["summary"]["sourceEdges"], 1)
        self.assertEqual(manifest["summary"]["representedEdges"], 1)
        self.assertEqual(manifest["summary"]["duplicatedSourceEdges"], 1)
        self.assertGreater(manifest["summary"]["messagePackShardBytes"], 0)
        self.assertGreater(manifest["summary"]["compactBinaryShardBytes"], 0)
        self.assertEqual(manifest["defaultFormat"], "compact")
        self.assertEqual(len(manifest["shards"]), 2)
        self.assertEqual(len(shards), 2)
        self.assertEqual(report["duplicatedSourceEdgeExamples"], ["edge-across-boundary"])
        for manifest_shard in manifest["shards"]:
            self.assertEqual(
                manifest_shard["formats"]["compact"]["path"],
                manifest_shard["path"],
            )
            self.assertEqual(manifest_shard["format"], "compact")
            self.assertTrue(manifest_shard["path"].endswith(".cwb"))
            self.assertEqual(len(manifest_shard["formats"]["compact"]["sha256"]), 64)
            self.assertGreater(manifest_shard["messagePackBytes"], 0)
            self.assertGreater(manifest_shard["compactBinaryBytes"], 0)
        for shard in shards.values():
            self.assertEqual(shard["edges"][0]["id"], "edge-across-boundary")
            self.assertEqual([node["id"] for node in shard["nodes"]], ["n1", "n2"])

    def test_runtime_shards_write_compact_binary_files(self):
        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory) / "base-routing-shards"
            outputs, summary = write_base_routing_shards(
                output_dir,
                {
                    "schemaVersion": 2,
                    "generatedAt": "2026-05-22T00:00:00Z",
                    "nodes": [
                        {"id": "n1", "coord": [35, 33]},
                        {"id": "n2", "coord": [35.001, 33]},
                    ],
                    "edges": [
                        {
                            "id": "edge",
                            "from": "n1",
                            "to": "n2",
                            "distanceMeters": 93,
                            "coordinates": [[35, 33], [35.001, 33]],
                        }
                    ],
                },
            )
            manifest = json.loads(Path(outputs["manifest"]).read_text(encoding="utf-8"))
            shard = manifest["shards"][0]
            self.assertEqual(summary["shards"], 1)
            self.assertTrue((output_dir / shard["formats"]["compact"]["path"]).exists())
            self.assertFalse((output_dir / "shards" / f"{shard['id']}.json").exists())
            self.assertFalse((output_dir / "shards" / f"{shard['id']}.msgpack").exists())

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

    def test_runtime_manifest_uses_public_data_stable_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            out_dir = Path(directory)
            public_data_dir = out_dir / "public-data"
            output_geojson = public_data_dir / "bike_roads.geojson"
            output_segments = public_data_dir / "segments.json"
            output_cw_base_index = public_data_dir / "cw-base-index.json"
            output_kml = public_data_dir / "exports" / "map.kml"
            output_routing_shards = public_data_dir / "base-routing-shards"
            output_geojson.parent.mkdir(parents=True, exist_ok=True)
            output_geojson.write_text("{}\n", encoding="utf-8")
            output_segments.write_text("{}\n", encoding="utf-8")
            output_cw_base_index.write_text("{}\n", encoding="utf-8")
            output_kml.parent.mkdir(parents=True, exist_ok=True)
            output_kml.write_text("<kml />\n", encoding="utf-8")
            write_json(output_routing_shards / "manifest.json", {"shards": []})
            (output_routing_shards / "shards").mkdir(parents=True, exist_ok=True)
            (output_routing_shards / "shards" / "g1_1.cwb").write_bytes(b"CWBS1")

            runtime, manifest_path = write_runtime_manifest(
                public_data_dir,
                output_geojson,
                output_segments,
                output_cw_base_index,
                output_kml,
                output_routing_shards,
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

            self.assertEqual(manifest_path, public_data_dir / "map-manifest.json")
            self.assertEqual(manifest["bikeRoads"], "bike_roads.geojson")
            self.assertEqual(manifest["segments"], "segments.json")
            self.assertEqual(manifest["cwBaseIndex"], "cw-base-index.json")
            self.assertEqual(manifest["kml"], "exports/map.kml")
            self.assertNotIn("baseRoutingNetwork", manifest)
            self.assertNotIn("baseRoutingNetwork", manifest["hashes"])
            self.assertIn("cwBaseIndex", manifest["hashes"])
            self.assertIn("baseRoutingShards", manifest)
            self.assertEqual(manifest["baseRoutingShards"], "base-routing-shards/manifest.json")
            self.assertTrue((public_data_dir / manifest["baseRoutingShards"]).exists())
            self.assertTrue(
                (Path(runtime["baseRoutingShards"]).parent / "shards" / "g1_1.cwb").exists()
            )
            self.assertFalse(
                any(path.name.startswith("base-routing-shards.") for path in public_data_dir.iterdir())
            )
            self.assertEqual(manifest["validation"]["overlayDisplaySegments"], 2)
            self.assertEqual(manifest["validation"]["sourceDisplayFallbackSegments"], 1)


if __name__ == "__main__":
    unittest.main()
