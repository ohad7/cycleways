import json
import tempfile
import unittest
from pathlib import Path

from processing.build_osm_base_graph_elevation import (
    build_elevated_base_graph,
    build_parser,
    degree_two_edge_chains,
    fixed_window_grade_metrics,
    stitched_chain_samples,
)
from processing.sample_base_graph_elevation import coordinate_key, sample_edge


BASE_LNG = 35.0
BASE_LAT = 33.0
METERS_PER_DEG_LNG = 93_000.0


def coord(x_m):
    return [BASE_LNG + x_m / METERS_PER_DEG_LNG, BASE_LAT]


def edge(edge_id, coordinates, distance_m, source="osm"):
    return {
        "id": edge_id,
        "fromNodeId": "n1",
        "toNodeId": "n2",
        "source": source,
        "distanceMeters": distance_m,
        "coordinates": coordinates,
    }


def write_json(path: Path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


class ElevatedBaseGraphBuildTests(unittest.TestCase):
    def test_fixed_window_grade_interpolates_exact_sustained_window(self):
        metrics = fixed_window_grade_metrics(
            [
                {"offsetMeters": 0, "elevationMeters": 100},
                {"offsetMeters": 20, "elevationMeters": 102},
                {"offsetMeters": 60, "elevationMeters": 110},
            ],
            50,
        )

        self.assertEqual(metrics["windows"], 1)
        self.assertEqual(metrics["maxAbsGrade"], 0.16)
        self.assertEqual(metrics["maxUphillGrade"], 0.16)
        self.assertEqual(metrics["maxDownhillGrade"], 0)

    def test_degree_two_chain_stitches_reversed_edge_profiles_across_split(self):
        chain_edges = [
            {
                "id": "edge-1",
                "fromNodeId": "n1",
                "toNodeId": "n2",
            },
            {
                "id": "edge-2",
                "fromNodeId": "n3",
                "toNodeId": "n2",
            },
        ]
        chains = degree_two_edge_chains(chain_edges)
        profiles = {
            "edge-1": {
                "samples": [
                    {"offsetMeters": 0, "elevationMeters": 100},
                    {"offsetMeters": 30, "elevationMeters": 103},
                ],
            },
            "edge-2": {
                "samples": [
                    {"offsetMeters": 0, "elevationMeters": 110},
                    {"offsetMeters": 30, "elevationMeters": 103},
                ],
            },
        }

        samples = stitched_chain_samples(chains[0], profiles)
        metrics = fixed_window_grade_metrics(samples, 50)

        self.assertEqual(len(chains), 1)
        self.assertEqual([edge["edgeId"] for edge in chains[0]], ["edge-1", "edge-2"])
        self.assertEqual(samples[-1]["offsetMeters"], 60)
        self.assertEqual(samples[-1]["elevationMeters"], 110)
        self.assertEqual(metrics["windows"], 1)
        self.assertEqual(metrics["maxAbsGrade"], 0.1533)

    def run_build(self, root: Path, graph, cache):
        graph_path = root / "osm-base-graph.json"
        cache_path = root / "elevation-cache.json"
        output_graph = root / "osm-base-graph-elevated.json"
        report_path = root / "report.json"
        write_json(graph_path, graph)
        write_json(cache_path, cache)

        parser = build_parser()
        args = parser.parse_args(
            [
                "--graph",
                str(graph_path),
                "--output-graph",
                str(output_graph),
                "--report",
                str(report_path),
                "--cache-file",
                str(cache_path),
                "--sample-spacing",
                "25",
                "--cache-only",
            ]
        )
        report = build_elevated_base_graph(args)
        return report, json.loads(output_graph.read_text(encoding="utf-8"))

    def test_build_adds_compact_profiles_without_changing_edge_geometry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            edge_record = edge("edge-1", [coord(0), coord(30), coord(100)], 100)
            samples = sample_edge(edge_record, 25)
            cache = {
                coordinate_key(sample["coordinate"]): 100 + index * 2
                for index, sample in enumerate(samples)
            }
            graph = {
                "metadata": {"generatedAt": "2026-05-22T00:00:00Z"},
                "nodes": [{"id": "n1", "coord": coord(0)}, {"id": "n2", "coord": coord(100)}],
                "edges": [edge_record],
            }

            report, elevated_graph = self.run_build(root, graph, cache)
            output_edge = elevated_graph["edges"][0]
            elevation = output_edge["elevation"]

            self.assertEqual(output_edge["coordinates"], edge_record["coordinates"])
            self.assertEqual(elevation["status"], "ready")
            self.assertEqual(elevation["sampleSpacingMeters"], 25)
            self.assertEqual(elevation["profile"][0][0], 0)
            self.assertAlmostEqual(elevation["profile"][-1][0], 100, delta=0.5)
            self.assertEqual(elevation["metrics"]["gainMeters"], 2 * (len(samples) - 1))
            self.assertEqual(report["validation"]["readyEdges"], 1)
            self.assertEqual(report["validation"]["missingEdges"], 0)
            self.assertEqual(report["validation"]["readySampleOccurrences"], len(samples))
            self.assertEqual(report["gradeDiagnostics"]["pointToPointMaxAbsGrade"]["edges"]["count"], 1)
            self.assertEqual(
                report["gradeDiagnostics"]["edgeAggregateCandidates"]["averageAbsNetGrade"][
                    "edges"
                ]["count"],
                1,
            )
            self.assertEqual(
                elevated_graph["metadata"]["elevation"]["profileEncoding"],
                "[offsetMeters,elevationMeters]",
            )
            self.assertTrue(elevated_graph["metadata"]["elevation"]["sourceGraphDigest"])

    def test_build_reports_edges_with_incomplete_cached_profiles(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            edge_record = edge("manual-edge", [coord(0), coord(50)], 50, source="manual")
            samples = sample_edge(edge_record, 25)
            cache = {
                coordinate_key(samples[0]["coordinate"]): 90,
                coordinate_key(samples[-1]["coordinate"]): 92,
            }
            graph = {
                "nodes": [{"id": "n1", "coord": coord(0)}, {"id": "n2", "coord": coord(50)}],
                "edges": [edge_record],
            }

            report, elevated_graph = self.run_build(root, graph, cache)

            self.assertEqual(elevated_graph["edges"][0]["elevation"]["status"], "missing")
            self.assertEqual(elevated_graph["edges"][0]["elevation"]["profile"], [])
            self.assertEqual(report["validation"]["readyEdges"], 0)
            self.assertEqual(report["validation"]["missingEdges"], 1)
            self.assertEqual(report["validation"]["readySampleOccurrences"], 0)
            self.assertEqual(report["validation"]["missingEdgeIds"], ["manual-edge"])
            self.assertEqual(report["validation"]["edgeSources"]["manual"]["ready"], 0)


if __name__ == "__main__":
    unittest.main()
