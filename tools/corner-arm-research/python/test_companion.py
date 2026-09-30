"""Independent analytic tests, not comparisons with copied implementation values."""
import math
import unittest

from companion import frame, oracle, pose_clearance, reference_checks, sampled_objective


def example():
    return {
        "schemaVersion": "cplayout-corner-research-v1", "id": "python-analytic",
        "model": {"pivot": [0, 0], "mainRadiusM": 30, "armLengthM": 10,
                  "overhangM": 3, "bodyHalfWidthM": 0.25,
                  "antennaOffsetM": [1, 2], "wheelOffsetsM": [[0, -1], [0, 1]],
                  "towerRadiiM": [10, 20, 30]},
        "limits": {"articulationRad": [-1.4, 1.4], "maxArticulationSlope": 1.5},
        "field": {"outer": [[-60, -60], [60, -60], [60, 60], [-60, 60]], "holes": []},
        "obstacles": [], "sweep": {"startRad": 0, "endRad": 2 * math.pi, "fullCircle": True},
        "clearanceM": 0.5, "maxDepth": 18, "toleranceM": 1e-6,
        "trajectory": {"interpolation": "linear", "knots": [
            {"thetaRad": 0, "alphaRad": 0}, {"thetaRad": 2 * math.pi, "alphaRad": 0}]},
    }


class CompanionTests(unittest.TestCase):
    def test_quarter_turn_rotates_antenna_offset(self):
        p = frame(example(), math.pi / 2, 0)
        self.assertAlmostEqual(p["antenna"][0], -2)
        self.assertAlmostEqual(p["antenna"][1], 41)
        self.assertAlmostEqual(p["wheels"][0][0], 1)
        self.assertAlmostEqual(p["wheels"][0][1], 40)

    def test_constant_articulation_radius_by_cosine_law(self):
        req = example()
        alpha = 0.7
        p = frame(req, 1.3, alpha)
        self.assertAlmostEqual(math.hypot(*p["end"]) ** 2, 30**2 + 13**2 + 2*30*13*math.cos(alpha))
        self.assertAlmostEqual(math.dist(p["hinge"], p["sdu"]), 10)

    def test_whole_member_crossing_obstacle_with_clear_endpoints(self):
        req = example()
        req["obstacles"] = [[[34, -1], [36, -1], [36, 1], [34, 1]]]
        self.assertLess(pose_clearance(req, frame(req, 0, 0)), 0)

    def test_field_hole_blocks_member(self):
        req = example()
        req["field"]["holes"] = [[[34, -1], [36, -1], [36, 1], [34, 1]]]
        self.assertLess(pose_clearance(req, frame(req, 0, 0)), 0)

    def test_large_translation_preserves_clearance(self):
        req = example()
        base = pose_clearance(req, frame(req, 0.3, 0.7))
        dx, dy = 500000, 4400000
        req["model"]["pivot"] = [dx, dy]
        req["field"]["outer"] = [[x+dx, y+dy] for x, y in req["field"]["outer"]]
        self.assertAlmostEqual(pose_clearance(req, frame(req, 0.3, 0.7)), base, places=8)

    def test_sampled_result_cannot_be_continuous_proof(self):
        report = oracle(example())
        self.assertFalse(report["continuousClearanceProved"])
        self.assertLess(report["maximumRigidLengthResidualM"], 1e-12)

    def test_objective_has_analytic_constant_value(self):
        req = example()
        for knot in req["trajectory"]["knots"]:
            knot["alphaRad"] = 0.7
        self.assertAlmostEqual(sampled_objective(req), 1 - math.cos(0.7))

    def test_boolean_crs_and_invalid_clipping_oracles(self):
        checks = reference_checks()
        self.assertEqual(checks["polygonMaxErrorM2"], 0)
        self.assertLess(checks["utmCentralMeridianErrorM"], 1e-7)
        self.assertLess(checks["crsRoundTripErrorDeg"], 1e-12)
        self.assertEqual(checks["clippedEndpointNegativeControlLengthErrorM"], 5)

    def test_negative_clearance_cannot_hide_an_obstacle(self):
        req = example()
        req["clearanceM"] = -100
        req["obstacles"] = [[[34, -1], [36, -1], [36, 1], [34, 1]]]
        with self.assertRaisesRegex(ValueError, "clearanceM"):
            oracle(req)

    def test_partial_knots_cannot_claim_full_sweep_sampling(self):
        req = example()
        req["trajectory"]["knots"][-1]["thetaRad"] = 0.01
        with self.assertRaisesRegex(ValueError, "endpoints"):
            oracle(req)

    def test_negative_body_width_rejected(self):
        req = example()
        req["model"]["bodyHalfWidthM"] = -1
        with self.assertRaisesRegex(ValueError, "bodyHalfWidthM"):
            oracle(req)


if __name__ == "__main__":
    unittest.main()
