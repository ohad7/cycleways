import tempfile
import unittest
from pathlib import Path

from processing.bootstrap_base_edge_share_registry import (
    build_registry,
    canonical_edge_descriptor,
    fnv1a_32,
    write_or_check,
)


class BaseEdgeShareRegistryTests(unittest.TestCase):
    def graph(self):
        return {
            "metadata": {"schemaVersion": 2},
            "edges": [
                {
                    "id": "edge-a",
                    "fromNodeId": "n1",
                    "toNodeId": "n2",
                    "source": "osm",
                    "osmWayId": 42,
                    "sliceIndex": 1,
                    "distanceMeters": 93.1234,
                    "coordinates": [[35.0, 33.0], [35.001, 33.0]],
                }
            ],
        }

    def test_descriptor_binds_orientation_geometry_and_fraction_basis(self):
        descriptor = canonical_edge_descriptor(self.graph()["edges"][0], 7)
        self.assertEqual(descriptor["shareId"], 7)
        self.assertEqual(descriptor["fromNodeId"], "n1")
        self.assertEqual(descriptor["toNodeId"], "n2")
        self.assertEqual(descriptor["coordinates"], [[35.0, 33.0], [35.001, 33.0]])
        self.assertEqual(descriptor["fractionBasis"], "oriented_polyline_length")
        self.assertEqual(len(descriptor["descriptorDigest"]), 64)

    def test_build_is_deterministic_and_tombstones_missing_edges(self):
        legacy = {"schemaVersion": 1, "nextShareId": 9, "edges": {"edge-a": 7, "gone": 8}}
        first = build_registry(
            self.graph(), legacy, release_id="test", graph_version="2026-07-10T20:28:11.541285Z"
        )
        second = build_registry(
            self.graph(), legacy, release_id="test", graph_version="2026-07-10T20:28:11.541285Z"
        )
        self.assertEqual(first, second)
        self.assertEqual(first["summary"], {"entries": 2, "descriptors": 1, "tombstones": 1})
        self.assertTrue(first["entries"]["8"]["tombstone"])
        self.assertEqual(
            first["legacyGraphVersionHashes"],
            {f"{fnv1a_32(first['graphVersion']):08x}": first["registryDigest"]},
        )

    def test_rejects_numeric_id_collisions(self):
        with self.assertRaisesRegex(ValueError, "share ID collision"):
            build_registry(
                self.graph(),
                {"edges": {"edge-a": 7, "gone": 7}},
                release_id="test",
                graph_version="v1",
            )

    def test_check_requires_byte_identical_output(self):
        registry = build_registry(
            self.graph(), {"edges": {"edge-a": 7}}, release_id="test", graph_version="v1"
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "registry.json"
            write_or_check(path, registry, False)
            write_or_check(path, registry, True)
            path.write_text("{}\n", encoding="utf-8")
            with self.assertRaises(SystemExit):
                write_or_check(path, registry, True)


if __name__ == "__main__":
    unittest.main()
