import json
import tempfile
import unittest
from pathlib import Path

from processing.sample_base_graph_elevation import (
    build_parser,
    run_sampling_lab,
    sample_edge,
    simplify_elevation_profile,
)


BASE_LNG = 35.0
BASE_LAT = 33.0
METERS_PER_DEG_LNG = 93_000.0


def coord(x_m):
    return [BASE_LNG + x_m / METERS_PER_DEG_LNG, BASE_LAT]


def graph_edge(edge_id, coordinates, distance_m):
    return {
        "id": edge_id,
        "source": "osm",
        "distanceMeters": distance_m,
        "coordinates": coordinates,
    }


class BaseGraphElevationSamplingTests(unittest.TestCase):
    def test_sample_edge_preserves_geometry_vertices_with_interval_samples(self):
        samples = sample_edge(
            graph_edge("edge-1", [coord(0), coord(30), coord(100)], 100),
            25,
        )
        offsets = [sample["offsetMeters"] for sample in samples]

        self.assertAlmostEqual(offsets[0], 0, delta=0.5)
        self.assertTrue(any(abs(offset - 25) < 0.5 for offset in offsets))
        self.assertTrue(any(abs(offset - 30) < 0.5 for offset in offsets))
        self.assertTrue(any(abs(offset - 50) < 0.5 for offset in offsets))
        self.assertTrue(any(abs(offset - 75) < 0.5 for offset in offsets))
        self.assertAlmostEqual(offsets[-1], 100, delta=0.5)

        vertex_offsets = [
            sample["offsetMeters"] for sample in samples if sample["geometryVertex"]
        ]
        self.assertTrue(any(abs(offset - 30) < 0.5 for offset in vertex_offsets))

    def test_simplify_profile_keeps_peak_and_gap_anchors(self):
        samples = [
            {
                "offsetMeters": offset,
                "coordinate": coord(offset),
                "geometryVertex": offset in {0, 100},
                "elevationMeters": elevation,
            }
            for offset, elevation in [
                (0, 100),
                (10, 100),
                (20, 106),
                (30, 100),
                (40, 100),
                (60, 100),
                (80, 100),
                (100, 100),
            ]
        ]

        retained = simplify_elevation_profile(
            samples,
            vertical_tolerance_m=1,
            max_retained_gap_m=35,
        )
        retained_offsets = [sample["offsetMeters"] for sample in retained]

        self.assertIn(20, retained_offsets)
        self.assertIn(40, retained_offsets)
        self.assertIn(80, retained_offsets)
        self.assertEqual(retained_offsets[0], 0)
        self.assertEqual(retained_offsets[-1], 100)

    def test_sampling_lab_writes_report_without_fetching_elevation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            graph_path = root / "osm-base-graph.json"
            edge_set_path = root / "study-edges.json"
            out_dir = root / "lab"
            graph_path.write_text(
                json.dumps(
                    {
                        "nodes": [],
                        "edges": [
                            graph_edge("short-edge", [coord(0), coord(20)], 20),
                            graph_edge("long-edge", [coord(0), coord(100)], 100),
                        ],
                    }
                ),
                encoding="utf-8",
            )
            edge_set_path.write_text(
                json.dumps(
                    {
                        "edges": [
                            {
                                "id": "long-edge",
                                "label": "long preview",
                                "terrain": "test",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            parser = build_parser()
            args = parser.parse_args(
                [
                    "--graph",
                    str(graph_path),
                    "--out-dir",
                    str(out_dir),
                    "--sample-spacings",
                    "10,25",
                    "--edge-set-file",
                    str(edge_set_path),
                ]
            )
            report = run_sampling_lab(args)

            self.assertEqual(report["graph"]["edges"], 2)
            self.assertEqual(report["settings"]["previewEdgeIds"], ["long-edge"])
            self.assertEqual(
                report["preview"]["profiles"][0]["studyCase"]["label"],
                "long preview",
            )
            self.assertFalse(report["elevation"]["fetched"])
            self.assertTrue((out_dir / "sampling-report.json").exists())
            self.assertTrue((out_dir / "sampling-preview.geojson").exists())


if __name__ == "__main__":
    unittest.main()
