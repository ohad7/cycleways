import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from processing.build_map import build_reviewed_roundabouts, write_runtime_manifest


def digest(path):
    return f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"


class RoundaboutBuildTests(unittest.TestCase):
    def test_reviewed_runtime_output_and_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            response = root / "response.json"
            query = root / "query.ql"
            response.write_text('{"elements":[]}', encoding="utf-8")
            query.write_text('way["highway"];', encoding="utf-8")
            candidates = root / "candidates.json"
            reviews = root / "reviews.json"
            output = root / "public/roundabouts.json"
            candidate = {
                "id": "r1",
                "fingerprint": "f1",
                "classification": "roundabout",
                "center": {"lat": 33, "lng": 35},
                "radiusM": 20,
                "bbox": [34.9, 32.9, 35.1, 33.1],
                "paths": [[[33, 35], [33.001, 35.001]]],
                "sourceTags": [{"osmWayId": 1}],
                "warnings": [],
            }
            candidates.write_text(json.dumps({
                "schemaVersion": 1,
                "sourceDigest": digest(response),
                "queryDigest": digest(query),
                "coverage": {"miniRoundaboutNodes": "not-requested-by-source"},
                "roundabouts": [candidate],
            }), encoding="utf-8")
            reviews.write_text(json.dumps({
                "schemaVersion": 1,
                "reviews": {"r1": {"fingerprint": "f1", "status": "accepted"}},
            }), encoding="utf-8")

            validation, output_path = build_reviewed_roundabouts(
                candidates, reviews, response, query, output,
            )
            self.assertTrue(validation["sourceFresh"])
            self.assertEqual(validation["summary"]["accepted"], 1)
            self.assertEqual(validation["blockingIssues"], [])
            runtime = json.loads(output_path.read_text())
            self.assertEqual(len(runtime["roundabouts"]), 1)
            self.assertNotIn("sourceTags", runtime["roundabouts"][0])
            self.assertEqual(runtime["coverage"]["miniRoundaboutNodes"], "not-requested-by-source")

            response.write_text('{"elements":[1]}', encoding="utf-8")
            stale, _ = build_reviewed_roundabouts(candidates, reviews, response, query, output)
            self.assertIn("stale_roundabout_candidates", [issue["code"] for issue in stale["blockingIssues"]])

    def test_runtime_manifest_versions_roundabouts(self):
        with tempfile.TemporaryDirectory() as tmp:
            public = Path(tmp) / "public-data"
            files = [
                public / "bike.geojson",
                public / "segments.json",
                public / "cw.json",
                public / "exports/map.kml",
                public / "base-routing-shards/manifest.json",
                public / "roundabouts.json",
            ]
            for path in files:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("{}", encoding="utf-8")
            runtime, manifest_path = write_runtime_manifest(
                public,
                files[0], files[1], files[2], files[3],
                public / "base-routing-shards",
                {"skipElevation": True, "failures": 0},
                {"baseRouting": {}, "cyclewaysDisplayGeometry": {}, "cwBaseIndex": {}},
                files[5],
            )
            manifest = json.loads(manifest_path.read_text())
            self.assertEqual(manifest["roundabouts"], "roundabouts.json")
            self.assertIn("roundabouts", manifest["hashes"])
            self.assertEqual(runtime["roundabouts"], str(files[5]))


if __name__ == "__main__":
    unittest.main()
