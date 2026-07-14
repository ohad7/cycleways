import unittest

from processing.bicycle_traversal_policy import (
    POLICY_DIGEST,
    normalize_bicycle_traversal,
    source_geometry_digest,
    validate_override,
)


class BicycleTraversalPolicyTests(unittest.TestCase):
    def verdict(self, tags, direction):
        return normalize_bicycle_traversal(tags)[direction]

    def test_generic_oneway_and_reverse_oneway(self):
        tags = {"highway": "trunk", "oneway": "yes"}
        self.assertEqual(self.verdict(tags, "forward"), "allowed")
        self.assertEqual(self.verdict(tags, "reverse"), "prohibited")
        tags["oneway"] = "-1"
        self.assertEqual(self.verdict(tags, "forward"), "prohibited")
        self.assertEqual(self.verdict(tags, "reverse"), "allowed")

    def test_bicycle_oneway_overrides_generic(self):
        result = normalize_bicycle_traversal(
            {"highway": "residential", "oneway": "yes", "oneway:bicycle": "no"}
        )
        self.assertEqual((result["forward"], result["reverse"]), ("allowed", "allowed"))

    def test_roundabout_implication_and_explicit_override(self):
        result = normalize_bicycle_traversal({"highway": "residential", "junction": "roundabout"})
        self.assertEqual((result["forward"], result["reverse"]), ("allowed", "prohibited"))
        result = normalize_bicycle_traversal(
            {"highway": "residential", "junction": "roundabout", "oneway": "no"}
        )
        self.assertEqual((result["forward"], result["reverse"]), ("allowed", "allowed"))
        circular = normalize_bicycle_traversal({"highway": "residential", "junction": "circular"})
        self.assertEqual((circular["forward"], circular["reverse"]), ("allowed", "allowed"))

    def test_oneway_conditional_is_not_erased(self):
        result = normalize_bicycle_traversal(
            {"highway": "residential", "oneway": "yes", "oneway:conditional": "no @ (Mo-Fr)"}
        )
        self.assertEqual(result["forward"], "allowed")
        self.assertEqual(result["reverse"], "conditional")
        malformed = normalize_bicycle_traversal(
            {"highway": "residential", "oneway": "yes", "oneway:conditional": "no sometimes"}
        )
        self.assertEqual(malformed["forward"], "unknown")
        self.assertEqual(malformed["reverse"], "unknown")

    def test_access_specificity_and_conditional_composition(self):
        result = normalize_bicycle_traversal(
            {"highway": "track", "access": "no", "bicycle": "yes"}
        )
        self.assertEqual((result["forward"], result["reverse"]), ("allowed", "allowed"))
        result = normalize_bicycle_traversal(
            {"highway": "track", "bicycle": "yes", "bicycle:conditional": "no @ (wet)"}
        )
        self.assertEqual((result["forward"], result["reverse"]), ("conditional", "conditional"))
        directional = normalize_bicycle_traversal(
            {"highway": "track", "bicycle": "no", "bicycle:forward": "yes"}
        )
        self.assertEqual((directional["forward"], directional["reverse"]), ("allowed", "prohibited"))

    def test_motor_vehicle_does_not_restrict_bicycles(self):
        result = normalize_bicycle_traversal({"highway": "residential", "motor_vehicle": "no"})
        self.assertEqual((result["forward"], result["reverse"]), ("allowed", "allowed"))

    def test_directional_permission_conflict_fails_closed(self):
        result = normalize_bicycle_traversal(
            {"highway": "residential", "oneway": "yes", "bicycle:backward": "yes"}
        )
        self.assertEqual(result["reverse"], "unknown")
        self.assertEqual(result["reverseReason"], "directional-access-oneway-conflict")
        legacy = normalize_bicycle_traversal(
            {"highway": "residential", "oneway": "yes", "cycleway": "opposite_lane"}
        )
        self.assertEqual(legacy["reverse"], "unknown")

    def test_private_and_unsupported_values_fail_closed(self):
        private = normalize_bicycle_traversal({"highway": "service", "access": "private"})
        self.assertEqual((private["forward"], private["reverse"]), ("conditional", "conditional"))
        unsupported = normalize_bicycle_traversal({"highway": "service", "oneway": "maybe"})
        self.assertEqual((unsupported["forward"], unsupported["reverse"]), ("unknown", "unknown"))

    def test_unmatched_defaults_are_unknown_and_motorways_are_prohibited(self):
        unknown = normalize_bicycle_traversal({"highway": "platform"})
        self.assertEqual((unknown["forward"], unknown["reverse"]), ("unknown", "unknown"))
        motorway = normalize_bicycle_traversal({"highway": "motorway"})
        self.assertEqual((motorway["forward"], motorway["reverse"]), ("prohibited", "prohibited"))

    def test_manual_missing_is_unknown(self):
        missing = normalize_bicycle_traversal({}, source="manual", manual={})
        self.assertEqual((missing["forward"], missing["reverse"]), ("unknown", "unknown"))
        reviewed = normalize_bicycle_traversal(
            {},
            source="manual",
            manual={"bicycleTraversal": {"forward": "allowed", "reverse": "prohibited"}},
        )
        self.assertEqual((reviewed["forward"], reviewed["reverse"]), ("allowed", "prohibited"))

    def test_override_validation_and_policy_digest(self):
        record = {
            "osmWayId": 42,
            "sourceGeometryDigest": "abc",
            "states": {"forward": "allowed", "reverse": "prohibited"},
            "rationale": "survey",
            "evidence": "https://example.invalid/evidence",
            "reviewer": "curator",
            "reviewedAt": "2026-07-14",
        }
        validate_override(record, "abc")
        with self.assertRaisesRegex(ValueError, "stale"):
            validate_override(record, "changed")
        self.assertEqual(len(POLICY_DIGEST), 64)

    def test_source_geometry_digest_normalizes_numeric_spelling_but_keeps_orientation(self):
        forward = source_geometry_digest([[35, 33.0], [35.0010000, 33]])
        self.assertEqual(forward, source_geometry_digest([[35.0, 33], [35.001, 33.0000000]]))
        self.assertNotEqual(forward, source_geometry_digest([[35.001, 33], [35, 33]]))


if __name__ == "__main__":
    unittest.main()
