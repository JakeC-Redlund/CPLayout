import json
import unittest
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import cv2
import numpy as np

from cplayout_ml.cli import (
    DEFAULT_VISION_THRESHOLDS,
    best_boundary_candidate,
    boundary_improvement_acceptance,
    boundary_improvement_failure_mode,
    build_obstruction_masks,
    circle_obstruction_conflicts,
    detect_imagery_field_boundary,
    detect_pivot_candidates,
    design_hard_failures,
    evaluate_vision_fixtures,
    extract_named_polygon_from_kml,
    extract_named_point_from_kml,
    field_boundary_from_hough_lines,
    improve_boundary_detector,
    load_operator_truth_labels,
    operator_comparison_metrics,
    pivot_truth_metrics,
    project_image_boundary_to_xy,
    score_boundary_candidate,
    read_kml_or_kmz_text,
    read_operator_kml_source,
    run_boundary_improvement_iterations,
    run_pivot_locator_iterations,
    run_pivot_locator_loop,
    synthetic_pivot_fixture,
    truth_labels_from_operator_boundary,
    validate_project,
    vision_recommendation_geometry,
)


def pivot_ring() -> dict:
    return {"center": {"x": 250.0, "y": 250.0}, "radius": 95.0, "confidence": 0.72}


def polygon_kml(name: str, coordinates: str, geometry: str = "Polygon") -> str:
    if geometry == "LineString":
        body = f"<LineString><coordinates>{coordinates}</coordinates></LineString>"
    else:
        body = f"""
        <Polygon><outerBoundaryIs><LinearRing>
          <coordinates>{coordinates}</coordinates>
        </LinearRing></outerBoundaryIs></Polygon>
        """
    return f"""<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>{name}</name>{body}</Placemark>
    </Document></kml>"""


TARGET_FIELD_BOUNDARY = "-104.0748668576167,39.89927718177743,0 -104.0748003065396,39.8991358739091,0 -104.074557674454,39.89916189917877,0 -104.0683361072595,39.89912667267359,0 -104.0682509986798,39.89929867389615,0 -104.0682557581712,39.89943674492907,0 -104.0681205294466,39.89949594403656,0 -104.0677859296929,39.89961546897757,0 -104.067494069811,39.89975702666375,0 -104.0671600654333,39.89993675632151,0 -104.0668098105665,39.90019192015236,0 -104.0665851825506,39.90037554859754,0 -104.0662883345574,39.90018017265919,0 -104.0661526426344,39.90008321388978,0 -104.0660965520057,39.90014630420742,0 -104.0661019491623,39.90066551543062,0 -104.065331187446,39.90176190656482,0 -104.0653673382966,39.90624908884386,0 -104.074689890918,39.90630137543089,0 -104.0748668576167,39.89927718177743,0"


def target_field_boundary_kml() -> str:
    return polygon_kml("TARGET_FIELD_BOUNDARY", TARGET_FIELD_BOUNDARY)


def fixed_label_kml() -> str:
    return """<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>TRUE_PIVOT_CENTER</name><Point><coordinates>-104.5,40.5,0</coordinates></Point></Placemark>
      <Placemark><name>TARGET_FIELD_BOUNDARY</name><Polygon><outerBoundaryIs><LinearRing><coordinates>""" + TARGET_FIELD_BOUNDARY + """</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
      <Placemark><name>SOUTH_ROAD_EXCLUSION</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-104.8,40.1,0 -104.2,40.1,0 -104.2,40.2,0 -104.8,40.2,0 -104.8,40.1,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
      <Placemark><name>SE_BUILDING_TREE_EXCLUSION</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-104.2,40.2,0 -104.1,40.2,0 -104.1,40.3,0 -104.2,40.3,0 -104.2,40.2,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
    </Document></kml>"""


def target_field_boundary_image_polygon() -> list[dict[str, float]]:
    return [
        {"x": 52.0, "y": 950.0},
        {"x": 58.0, "y": 968.0},
        {"x": 82.0, "y": 964.0},
        {"x": 694.0, "y": 969.0},
        {"x": 704.0, "y": 946.0},
        {"x": 704.0, "y": 928.0},
        {"x": 718.0, "y": 920.0},
        {"x": 751.0, "y": 904.0},
        {"x": 780.0, "y": 886.0},
        {"x": 813.0, "y": 862.0},
        {"x": 848.0, "y": 828.0},
        {"x": 870.0, "y": 804.0},
        {"x": 899.0, "y": 830.0},
        {"x": 913.0, "y": 843.0},
        {"x": 918.0, "y": 835.0},
        {"x": 918.0, "y": 766.0},
        {"x": 994.0, "y": 622.0},
        {"x": 990.0, "y": 32.0},
        {"x": 70.0, "y": 25.0},
    ]


GOOGLE_EARTH_TEMPORARY_PLACES_OPERATOR_KML = """<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:atom="http://www.w3.org/2005/Atom">
<Document>
  <name>KmlFile</name>
  <StyleMap id="m_ylw-pushpin"><Pair><key>normal</key><styleUrl>#s_ylw-pushpin</styleUrl></Pair></StyleMap>
  <Style id="s_ylw-pushpin">
    <IconStyle><Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon></IconStyle>
    <LineStyle><color>ff0000aa</color><width>2</width></LineStyle>
    <PolyStyle><fill>0</fill></PolyStyle>
  </Style>
  <Placemark>
    <name>USER DRAWN FIELD BOUNDARY</name>
    <styleUrl>#m_ylw-pushpin</styleUrl>
    <Polygon>
      <tessellate>1</tessellate>
      <outerBoundaryIs>
        <LinearRing>
          <coordinates>
            """ + TARGET_FIELD_BOUNDARY + """
          </coordinates>
        </LinearRing>
      </outerBoundaryIs>
    </Polygon>
    <atom:link rel="app" href="https://www.google.com/earth/about/versions/#earth-pro" title="Google Earth Pro 7.3.7.1155"></atom:link>
  </Placemark>
</Document>
</kml>"""


class BoundaryDetectorTests(unittest.TestCase):
    def test_rectangle_field_with_crop_circle_selects_rectangle(self) -> None:
        image = np.full((500, 500, 3), (80, 122, 74), dtype=np.uint8)
        cv2.rectangle(image, (80, 95), (420, 405), (35, 35, 35), 5)
        cv2.circle(image, (250, 250), 95, (105, 150, 100), 3)

        result = detect_imagery_field_boundary(cv2, image, pivot_ring())

        self.assertIsNotNone(result)
        assert result is not None
        self.assertFalse(result["rejected"])
        self.assertEqual(result["source"], "opencv")
        self.assertGreaterEqual(result["confidence"], DEFAULT_VISION_THRESHOLDS["minFieldBoundaryConfidence"])
        self.assertLess(result["circularity"], 0.86)
        self.assertGreaterEqual(len(result["imagePolygon"]), 4)

    def test_crop_circle_only_does_not_accept_boundary(self) -> None:
        image = np.full((500, 500, 3), (80, 122, 74), dtype=np.uint8)
        cv2.circle(image, (250, 250), 95, (35, 35, 35), 4)

        result = detect_imagery_field_boundary(cv2, image, pivot_ring())

        self.assertTrue(result is None or result["rejected"])

    def test_partial_hough_extent_is_rejected_when_boundary_is_clipped_by_screenshot(self) -> None:
        image = np.full((500, 500, 3), (80, 122, 74), dtype=np.uint8)
        cv2.line(image, (70, 0), (70, 440), (35, 35, 35), 4)
        cv2.line(image, (430, 0), (430, 440), (35, 35, 35), 4)
        cv2.line(image, (70, 440), (430, 440), (35, 35, 35), 4)

        result = detect_imagery_field_boundary(cv2, image, pivot_ring(), None)

        self.assertIsNotNone(result)
        assert result is not None
        self.assertTrue(result["rejected"])
        self.assertIn(
            "candidate is clipped by the screenshot edge and cannot be accepted as a complete imagery field boundary",
            result["rejectionReasons"],
        )
        self.assertNotIn("projectedPolygon", result)

    def test_box_around_circle_candidate_is_rejected(self) -> None:
        edges = np.zeros((500, 500), dtype=np.uint8)
        candidate = {
            "source": "opencv",
            "method": "unit_test_extent_box",
            "polygon": [
                {"x": 155.0, "y": 155.0},
                {"x": 345.0, "y": 155.0},
                {"x": 345.0, "y": 345.0},
                {"x": 155.0, "y": 345.0},
            ],
        }

        scored = score_boundary_candidate(cv2, edges, candidate, 500, 500, pivot_ring())

        self.assertTrue(scored["rejected"])
        self.assertIn("candidate resembles an extent box around the pivot ring rather than imagery edges", scored["rejectionReasons"])

    def test_screenshot_extent_candidate_is_rejected(self) -> None:
        edges = np.zeros((500, 500), dtype=np.uint8)
        cv2.rectangle(edges, (1, 1), (499, 499), 255, 2)
        candidate = {
            "source": "opencv",
            "method": "unit_test_screenshot_extent",
            "polygon": [
                {"x": 1.0, "y": 1.0},
                {"x": 499.0, "y": 1.0},
                {"x": 499.0, "y": 499.0},
                {"x": 1.0, "y": 499.0},
            ],
        }

        scored = score_boundary_candidate(cv2, edges, candidate, 500, 500, pivot_ring())

        self.assertTrue(scored["rejected"])
        self.assertIn("candidate resembles the screenshot extent rather than the target field boundary", scored["rejectionReasons"])

    def test_operator_label_false_positive_and_distance_reject_boundary(self) -> None:
        edges = np.zeros((500, 500), dtype=np.uint8)
        cv2.rectangle(edges, (40, 40), (460, 460), 255, 4)
        operator = [
            {"x": 120.0, "y": 120.0},
            {"x": 380.0, "y": 120.0},
            {"x": 380.0, "y": 380.0},
            {"x": 120.0, "y": 380.0},
        ]
        candidate = {
            "source": "opencv",
            "method": "unit_test_adjacent_field_and_road_inclusion",
            "polygon": [
                {"x": 40.0, "y": 40.0},
                {"x": 460.0, "y": 40.0},
                {"x": 460.0, "y": 460.0},
                {"x": 40.0, "y": 460.0},
            ],
        }

        scored = score_boundary_candidate(cv2, edges, candidate, 500, 500, pivot_ring(), operator)

        self.assertTrue(scored["rejected"])
        self.assertGreater(scored["operatorFalsePositiveAreaRatio"], DEFAULT_VISION_THRESHOLDS["maxBoundaryFalsePositiveRatio"])
        self.assertIn("candidate includes too much area outside the operator TARGET_FIELD_BOUNDARY label", scored["rejectionReasons"])

    def test_boundary_candidate_requires_edge_support(self) -> None:
        edges = np.zeros((500, 500), dtype=np.uint8)
        candidate = {
            "source": "opencv",
            "method": "unit_test_no_edge_support",
            "polygon": [
                {"x": 70.0, "y": 80.0},
                {"x": 430.0, "y": 80.0},
                {"x": 430.0, "y": 420.0},
                {"x": 70.0, "y": 420.0},
            ],
        }

        scored = score_boundary_candidate(cv2, edges, candidate, 500, 500, pivot_ring())

        self.assertTrue(scored["rejected"])
        self.assertIn("candidate lacks edge support along road, fenceline, or treeline cues", scored["rejectionReasons"])

    def test_road_fenceline_edges_score_rectangular_field(self) -> None:
        edges = np.zeros((500, 500), dtype=np.uint8)
        cv2.rectangle(edges, (70, 80), (430, 420), 255, 3)
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=80, minLineLength=80, maxLineGap=12)

        polygon = field_boundary_from_hough_lines(lines, 500, 500, pivot_ring())

        self.assertIsNotNone(polygon)
        assert polygon is not None
        scored = score_boundary_candidate(
            cv2,
            edges,
            {"source": "opencv", "method": "unit_test_edges", "polygon": polygon},
            500,
            500,
            pivot_ring(),
        )
        self.assertFalse(scored["rejected"])
        self.assertGreaterEqual(scored["confidence"], DEFAULT_VISION_THRESHOLDS["minFieldBoundaryConfidence"])

    def test_mocked_sam2_mask_can_export_projected_boundary(self) -> None:
        class FakeSam2Adapter:
            def propose_masks(self, _image):
                mask = np.zeros((500, 500), dtype=np.uint8)
                cv2.rectangle(mask, (75, 85), (425, 415), 255, -1)
                return [mask]

        image = np.full((500, 500, 3), (90, 110, 92), dtype=np.uint8)
        cv2.rectangle(image, (75, 85), (425, 415), (35, 35, 35), 4)
        result = detect_imagery_field_boundary(cv2, image, pivot_ring(), FakeSam2Adapter())

        self.assertIsNotNone(result)
        assert result is not None
        self.assertFalse(result["rejected"])
        self.assertEqual(result["source"], "sam2")
        projected = project_image_boundary_to_xy(
            result,
            {"center": {"x": 250.0, "y": 250.0}, "radius": 100.0, "confidence": 0.8},
            {
                "machine": {"spanLengthsMeters": [100.0], "overhangMeters": 0.0, "endGunThrowMeters": 0.0},
                "pivotCenter": {"x": 1000.0, "y": 2000.0},
            },
        )
        self.assertIsNotNone(projected)
        assert projected is not None
        self.assertEqual(len(projected), len(result["imagePolygon"]))

    def test_operator_kml_exact_named_polygon_is_extracted(self) -> None:
        parsed = extract_named_polygon_from_kml(
            polygon_kml("USER DRAWN FIELD BOUNDARY", "-104,40,0 -103,40,0 -103,41,0 -104,40,0"),
            "USER DRAWN FIELD BOUNDARY",
        )

        self.assertEqual(parsed["warnings"], [])
        self.assertIsNotNone(parsed["polygon"])
        assert parsed["polygon"] is not None
        self.assertEqual(len(parsed["polygon"]), 3)
        self.assertEqual(parsed["polygon"][0], {"longitude": -104.0, "latitude": 40.0})

    def test_google_earth_temporary_places_operator_polygon_is_extracted(self) -> None:
        parsed = extract_named_polygon_from_kml(
            GOOGLE_EARTH_TEMPORARY_PLACES_OPERATOR_KML,
            "USER DRAWN FIELD BOUNDARY",
        )

        self.assertEqual(parsed["warnings"], [])
        self.assertIsNotNone(parsed["polygon"])
        assert parsed["polygon"] is not None
        self.assertEqual(len(parsed["polygon"]), 19)
        self.assertEqual(parsed["polygon"][0], {"longitude": -104.0748668576167, "latitude": 39.89927718177743})
        self.assertEqual(parsed["polygon"][-1], {"longitude": -104.074689890918, "latitude": 39.90630137543089})

    def test_fixed_truth_labels_are_ingested_by_name(self) -> None:
        labels = load_operator_truth_labels(None, fixed_label_kml(), "", None, None)

        self.assertEqual(labels["truePivotCenter"]["wgs84Point"], {"longitude": -104.5, "latitude": 40.5})
        self.assertEqual(len(labels["targetFieldBoundary"]["wgs84Polygon"]), 19)
        self.assertEqual(len(labels["southRoadExclusion"]["wgs84Polygon"]), 4)
        self.assertEqual(len(labels["seBuildingTreeExclusion"]["wgs84Polygon"]), 4)
        self.assertIn("TRUE_PIVOT_CENTER parsed but cannot be rasterized", labels["truePivotCenter"]["warnings"][0])

    def test_fixed_truth_label_point_rejects_missing_name(self) -> None:
        parsed = extract_named_point_from_kml(fixed_label_kml(), "MISSING_CENTER")

        self.assertIsNone(parsed["point"])
        self.assertIn('No valid Point Placemark named "MISSING_CENTER" was found.', parsed["warnings"])

    def test_raw_operator_kml_text_source_records_hash_and_remote_icon(self) -> None:
        text, artifact = read_operator_kml_source(None, GOOGLE_EARTH_TEMPORARY_PLACES_OPERATOR_KML)

        self.assertEqual(text, GOOGLE_EARTH_TEMPORARY_PLACES_OPERATOR_KML)
        self.assertEqual(artifact["source"], "operatorBoundaryKmlText")
        self.assertEqual(artifact["kml"]["placemarkCount"], 1)
        self.assertTrue(artifact["kml"]["hasRemoteIconHref"])

    def test_operator_kml_missing_name_fails_softly(self) -> None:
        parsed = extract_named_polygon_from_kml(
            polygon_kml("Other boundary", "-104,40,0 -103,40,0 -103,41,0 -104,40,0"),
            "USER DRAWN FIELD BOUNDARY",
        )

        self.assertIsNone(parsed["polygon"])
        self.assertIn('No valid Polygon Placemark named "USER DRAWN FIELD BOUNDARY" was found.', parsed["warnings"])

    def test_operator_kml_line_only_fails_softly(self) -> None:
        parsed = extract_named_polygon_from_kml(
            polygon_kml("USER DRAWN FIELD BOUNDARY", "-104,40,0 -103,40,0", "LineString"),
            "USER DRAWN FIELD BOUNDARY",
        )

        self.assertIsNone(parsed["polygon"])
        self.assertIn('Placemark "USER DRAWN FIELD BOUNDARY" must contain exactly one Polygon; found 0.', parsed["warnings"])

    def test_operator_kml_unclosed_ring_fails_softly(self) -> None:
        parsed = extract_named_polygon_from_kml(
            polygon_kml("USER DRAWN FIELD BOUNDARY", "-104,40,0 -103,40,0 -103,41,0"),
            "USER DRAWN FIELD BOUNDARY",
        )

        self.assertIsNone(parsed["polygon"])
        self.assertIn('Placemark "USER DRAWN FIELD BOUNDARY" polygon outer ring is not closed.', parsed["warnings"])

    def test_operator_kml_multiple_matching_polygons_fail_softly(self) -> None:
        kml = """<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
          <Placemark><name>USER DRAWN FIELD BOUNDARY</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-104,40,0 -103,40,0 -103,41,0 -104,40,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
          <Placemark><name>USER DRAWN FIELD BOUNDARY</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-105,40,0 -104,40,0 -104,41,0 -105,40,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
        </Document></kml>"""

        parsed = extract_named_polygon_from_kml(kml, "USER DRAWN FIELD BOUNDARY")

        self.assertIsNone(parsed["polygon"])
        self.assertIn('Expected one Placemark named "USER DRAWN FIELD BOUNDARY" but found 2 valid matching Polygons.', parsed["warnings"])

    def test_operator_kmz_doc_kml_is_read(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "operator.kmz"
            kml = polygon_kml("USER DRAWN FIELD BOUNDARY", "-104,40,0 -103,40,0 -103,41,0 -104,40,0")
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("doc.kml", kml)

            self.assertEqual(read_kml_or_kmz_text(path), kml)

    def test_operator_comparison_metrics_distinguish_boundary_from_crop_ring(self) -> None:
        image = np.zeros((500, 500, 3), dtype=np.uint8)
        operator = [
            {"x": 80.0, "y": 90.0},
            {"x": 420.0, "y": 90.0},
            {"x": 420.0, "y": 410.0},
            {"x": 80.0, "y": 410.0},
        ]
        good = [
            {"x": 84.0, "y": 94.0},
            {"x": 416.0, "y": 94.0},
            {"x": 416.0, "y": 406.0},
            {"x": 84.0, "y": 406.0},
        ]
        crop_ring_box = [
            {"x": 155.0, "y": 155.0},
            {"x": 345.0, "y": 155.0},
            {"x": 345.0, "y": 345.0},
            {"x": 155.0, "y": 345.0},
        ]

        good_metrics = operator_comparison_metrics(cv2, image, operator, good)
        crop_metrics = operator_comparison_metrics(cv2, image, operator, crop_ring_box)

        self.assertGreater(good_metrics["iou"], crop_metrics["iou"])
        self.assertLess(good_metrics["boundaryMeanDistancePixels"], crop_metrics["boundaryMeanDistancePixels"])

    def test_old_large_rectangle_is_rejected_despite_high_operator_iou(self) -> None:
        edges = np.zeros((1000, 1000), dtype=np.uint8)
        cv2.rectangle(edges, (0, 0), (999, 999), 255, 4)
        candidate = {
            "source": "opencv",
            "method": "unit_test_old_large_extent_rectangle",
            "polygon": [
                {"x": 0.0, "y": 0.0},
                {"x": 999.0, "y": 0.0},
                {"x": 999.0, "y": 999.0},
                {"x": 0.0, "y": 999.0},
            ],
        }
        operator = [
            {"x": 40.0, "y": 40.0},
            {"x": 959.0, "y": 40.0},
            {"x": 959.0, "y": 959.0},
            {"x": 500.0, "y": 930.0},
            {"x": 40.0, "y": 959.0},
        ]

        scored = score_boundary_candidate(cv2, edges, candidate, 1000, 1000, {"center": {"x": 500.0, "y": 500.0}, "radius": 95.0}, operator)

        self.assertGreater(scored["operatorLabelAlignment"], DEFAULT_VISION_THRESHOLDS["minOperatorBoundaryIoU"])
        self.assertGreater(scored["operatorFalsePositiveAreaRatio"], 0.16)
        self.assertLess(scored["operatorFalsePositiveAreaRatio"], 0.18)
        self.assertTrue(scored["rejected"])
        self.assertIn("candidate resembles the screenshot extent rather than the target field boundary", scored["rejectionReasons"])
        self.assertIn("candidate includes too much area outside the operator TARGET_FIELD_BOUNDARY label", scored["rejectionReasons"])
        self.assertIn(
            "candidate is a 4-point axis-aligned rectangle and does not preserve irregular south/southeast TARGET_FIELD_BOUNDARY features",
            scored["rejectionReasons"],
        )

    def test_19_point_target_boundary_rejects_rectangular_distractor(self) -> None:
        edges = np.zeros((1000, 1000), dtype=np.uint8)
        cv2.rectangle(edges, (40, 20), (999, 980), 255, 4)
        operator = target_field_boundary_image_polygon()
        candidate = {
            "source": "opencv",
            "method": "unit_test_adams_clipped_axis_aligned_extent_box",
            "polygon": [
                {"x": 40.0, "y": 20.0},
                {"x": 999.0, "y": 20.0},
                {"x": 999.0, "y": 980.0},
                {"x": 40.0, "y": 980.0},
            ],
            "candidateWarnings": ["candidate is clipped by the screenshot edge and cannot be accepted as a complete imagery field boundary"],
        }

        scored = score_boundary_candidate(cv2, edges, candidate, 1000, 1000, {"center": {"x": 500.0, "y": 500.0}, "radius": 95.0}, operator)

        self.assertEqual(len(operator), 19)
        self.assertGreater(scored["operatorLabelAlignment"], DEFAULT_VISION_THRESHOLDS["minOperatorBoundaryIoU"])
        self.assertTrue(scored["rejected"])
        self.assertIn("candidate is a 4-point axis-aligned rectangle and does not preserve irregular south/southeast TARGET_FIELD_BOUNDARY features", scored["rejectionReasons"])
        self.assertIn("candidate is clipped by the screenshot edge and cannot be accepted as a complete imagery field boundary", scored["rejectionReasons"])

    def test_rejected_high_iou_rectangle_is_learning_evidence_not_cv_candidate(self) -> None:
        rejected_rectangle = {
            "source": "opencv",
            "cues": ["unit_test_adams_clipped_axis_aligned_extent_box"],
            "confidence": 0.771,
            "rejected": True,
            "rejectionReasons": [
                "candidate is clipped by the screenshot edge and cannot be accepted as a complete imagery field boundary",
                "candidate is a 4-point axis-aligned rectangle and does not preserve irregular south/southeast TARGET_FIELD_BOUNDARY features",
            ],
            "operatorLabelAlignment": 0.8358,
            "operatorFalsePositiveAreaRatio": 0.1636,
            "operatorBoundaryMeanDistancePixels": 110.5,
            "imagePolygon": [
                {"x": 40.0, "y": 20.0},
                {"x": 999.0, "y": 20.0},
                {"x": 999.0, "y": 980.0},
                {"x": 40.0, "y": 980.0},
            ],
        }
        accepted_irregular = {
            "source": "opencv",
            "cues": ["unit_test_irregular_edge_candidate"],
            "confidence": 0.61,
            "rejected": False,
            "rejectionReasons": [],
            "operatorLabelAlignment": 0.74,
            "imagePolygon": target_field_boundary_image_polygon(),
        }
        iterations = [{
            "iteration": 1,
            "bestCandidate": accepted_irregular,
            "bestAcceptedCandidate": accepted_irregular,
            "bestRejectedCandidate": rejected_rectangle,
            "operatorComparison": [],
        }]

        self.assertIs(best_boundary_candidate(iterations, rejected=False), accepted_irregular)
        self.assertIs(best_boundary_candidate(iterations, rejected=True), rejected_rectangle)
        self.assertIsNone(boundary_improvement_failure_mode(accepted_irregular, rejected_rectangle, iterations))

        no_cv_failure = boundary_improvement_failure_mode(None, rejected_rectangle, iterations)
        self.assertIsNotNone(no_cv_failure)
        assert no_cv_failure is not None
        self.assertEqual(no_cv_failure["code"], "clipped_axis_aligned_extent_box")

    def test_mean_boundary_distance_above_gate_rejects_candidate(self) -> None:
        edges = np.zeros((1000, 1000), dtype=np.uint8)
        cv2.rectangle(edges, (100, 100), (900, 900), 255, 4)
        operator = [
            {"x": 220.0, "y": 220.0},
            {"x": 780.0, "y": 220.0},
            {"x": 780.0, "y": 780.0},
            {"x": 220.0, "y": 780.0},
            {"x": 340.0, "y": 720.0},
            {"x": 300.0, "y": 620.0},
        ]
        candidate = {
            "source": "opencv",
            "method": "unit_test_far_rectangle",
            "polygon": [
                {"x": 100.0, "y": 100.0},
                {"x": 900.0, "y": 100.0},
                {"x": 900.0, "y": 900.0},
                {"x": 100.0, "y": 900.0},
            ],
        }

        scored = score_boundary_candidate(cv2, edges, candidate, 1000, 1000, {"center": {"x": 500.0, "y": 500.0}, "radius": 95.0}, operator)

        self.assertGreater(scored["operatorBoundaryMeanDistancePixels"], DEFAULT_VISION_THRESHOLDS["maxBoundaryMeanDistancePx"])
        self.assertTrue(scored["rejected"])
        self.assertIn("candidate boundary is too far from the operator TARGET_FIELD_BOUNDARY label", scored["rejectionReasons"])

    def test_target_field_boundary_fixture_is_operator_truth_not_cv_prediction(self) -> None:
        parsed = extract_named_polygon_from_kml(target_field_boundary_kml(), "TARGET_FIELD_BOUNDARY")

        self.assertEqual(parsed["warnings"], [])
        self.assertIsNotNone(parsed["polygon"])
        assert parsed["polygon"] is not None
        self.assertEqual(len(parsed["polygon"]), 19)
        truth = truth_labels_from_operator_boundary({
            "source": "operator_kml",
            "name": "TARGET_FIELD_BOUNDARY",
            "wgs84Polygon": parsed["polygon"],
            "projectedPolygon": [{"x": index, "y": index * 2.0} for index, _ in enumerate(parsed["polygon"])],
            "imagePolygon": None,
            "warnings": [],
        })

        self.assertIsNotNone(truth)
        assert truth is not None
        self.assertEqual(truth["targetFieldBoundary"]["name"], "TARGET_FIELD_BOUNDARY")
        self.assertEqual(truth["targetFieldBoundary"]["wgs84Polygon"], parsed["polygon"])

    def test_pivot_truth_offset_radius_mismatch_and_obstruction_conflict_are_hard_failures(self) -> None:
        image = np.zeros((500, 500, 3), dtype=np.uint8)
        truth_labels = {
            "truePivotCenter": {"imagePoint": {"x": 280.0, "y": 250.0}},
            "southRoadExclusion": {"name": "SOUTH_ROAD_EXCLUSION", "imagePolygon": [
                {"x": 220.0, "y": 320.0},
                {"x": 320.0, "y": 320.0},
                {"x": 320.0, "y": 350.0},
                {"x": 220.0, "y": 350.0},
            ]},
            "seBuildingTreeExclusion": {"name": "SE_BUILDING_TREE_EXCLUSION", "imagePolygon": [
                {"x": 310.0, "y": 250.0},
                {"x": 340.0, "y": 250.0},
                {"x": 340.0, "y": 280.0},
                {"x": 310.0, "y": 280.0},
            ]},
        }
        overlay_circle = {"center": {"x": 250.0, "y": 250.0}, "radius": 105.0}

        truth = pivot_truth_metrics(pivot_ring(), overlay_circle, truth_labels)
        masks = build_obstruction_masks(cv2, image, truth_labels)
        conflicts = circle_obstruction_conflicts(cv2, image, overlay_circle, masks)
        failures = design_hard_failures(None, [], truth, conflicts)

        self.assertGreater(truth["centerTruthOffsetPx"], DEFAULT_VISION_THRESHOLDS["maxCenterTruthOffsetPx"])
        self.assertGreater(truth["radiusTruthMismatchRatio"], DEFAULT_VISION_THRESHOLDS["maxRadiusMismatchRatio"])
        self.assertTrue(conflicts["southRoad"])
        self.assertTrue(conflicts["seBuildingTree"])
        self.assertIn("CPLayout wet circle crosses SOUTH_ROAD_EXCLUSION.", failures)
        self.assertIn("CPLayout wet circle crosses SE_BUILDING_TREE_EXCLUSION.", failures)

    def test_project_reference_obstacles_are_not_reemitted_as_untrusted_vision_obstacles(self) -> None:
        geometry = vision_recommendation_geometry(
            "LOCAL:TEST",
            {
                "projectCrs": "LOCAL:TEST",
                "pivotCenter": {"x": 250.0, "y": 250.0},
                "machine": {"spanLengthsMeters": [95.0], "overhangMeters": 0.0, "endGunThrowMeters": 0.0},
                "obstacles": [{
                    "id": "odd-center-square",
                    "polygon": [
                        {"x": 240.0, "y": 240.0},
                        {"x": 260.0, "y": 240.0},
                        {"x": 260.0, "y": 260.0},
                    ],
                }],
            },
            None,
            [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}, {"x": 1.0, "y": 1.0}],
        )

        self.assertNotIn("obstaclePolygons", geometry)

    def test_evaluate_vision_fixtures_writes_deterministic_metrics(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image = np.full((500, 500, 3), (80, 122, 74), dtype=np.uint8)
            cv2.rectangle(image, (80, 95), (420, 405), (35, 35, 35), 5)
            cv2.circle(image, (250, 250), 95, (105, 150, 100), 3)
            map_canvas = root / "map.png"
            full_window = root / "full.png"
            cv2.imwrite(str(map_canvas), image)
            cv2.imwrite(str(full_window), image)
            manifest = root / "fixtures.json"
            manifest.write_text(
                """{
                  "schemaVersion": "cplayout-vision-fixtures-v1",
                  "fixtures": [{
                    "id": "rectangular-field",
                    "fullWindowScreenshot": "full.png",
                    "mapCanvasCrop": "map.png",
                    "expected": {
                      "boundaryPresent": true,
                      "overlayPresent": false,
                      "blackCanvas": false
                    }
                  }]
                }""",
                encoding="utf-8",
            )
            output_dir = root / "out"

            self.assertEqual(evaluate_vision_fixtures(manifest, output_dir), 0)

            summary = (output_dir / "vision-evaluation-summary.json").read_text(encoding="utf-8")
            cases = (output_dir / "vision-evaluation-cases.jsonl").read_text(encoding="utf-8")
            self.assertIn('"caseCount": 1', summary)
            self.assertIn('"canonicalGeometryMutation": false', summary)
            self.assertIn('"rectangular-field"', cases)

    def test_improvement_loop_runs_minimum_five_iterations_and_rejects_weakless_than_label_gate(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image = np.full((500, 500, 3), (82, 120, 74), dtype=np.uint8)
            cv2.rectangle(image, (72, 84), (428, 416), (35, 35, 35), 4)
            cv2.line(image, (80, 84), (420, 416), (70, 70, 70), 2)
            cv2.circle(image, (250, 250), 95, (105, 150, 100), 3)
            map_canvas = root / "map.png"
            full_window = root / "full.png"
            proof_kml = root / "proof.kml"
            cv2.imwrite(str(map_canvas), image)
            cv2.imwrite(str(full_window), image)
            proof_kml.write_text("<kml xmlns=\"http://www.opengis.net/kml/2.2\"><Document /></kml>", encoding="utf-8")
            output_dir = root / "loop"

            self.assertEqual(
                improve_boundary_detector(
                    map_canvas,
                    full_window,
                    proof_kml,
                    None,
                    None,
                    target_field_boundary_kml(),
                    "TARGET_FIELD_BOUNDARY",
                    output_dir,
                    2,
                    "2026-05-30T00:00:00.000Z",
                ),
                0,
            )

            report = json.loads((output_dir / "boundary-improvement-loop.json").read_text(encoding="utf-8"))
            self.assertEqual(report["iterationCount"], 5)
            self.assertFalse(report["canonicalGeometryMutation"])
            self.assertFalse(report["acceptance"]["accepted"])
            self.assertIn("targetFieldBoundary", report["detections"]["truthLabels"])
            self.assertEqual(report["detections"]["truthBoundary"]["name"], "TARGET_FIELD_BOUNDARY")
            self.assertIn("cvCandidateBoundary", report["detections"])
            self.assertIn("bestAcceptedCandidate", report["detections"])
            self.assertIn("bestRejectedCandidate", report["detections"])
            self.assertEqual(report["operatorGuidedLearning"]["role"], "training_and_scoring_evidence_only")
            if report["detections"]["cvCandidateBoundary"] is None:
                self.assertIsNotNone(report["failureMode"])
            else:
                self.assertFalse(report["detections"]["cvCandidateBoundary"]["rejected"])
            self.assertIn("surface_color_variation", [iteration["config"]["name"] for iteration in report["iterations"]])
            self.assertTrue((output_dir / "boundary-improvement-annotated.png").exists())

    def test_improvement_iteration_runner_records_requested_100_iterations(self) -> None:
        image = np.full((500, 500, 3), (82, 120, 74), dtype=np.uint8)
        cv2.rectangle(image, (72, 84), (428, 416), (35, 35, 35), 4)
        cv2.line(image, (95, 410), (210, 450), (35, 35, 35), 3)
        cv2.circle(image, (250, 250), 95, (105, 150, 100), 3)

        iterations = run_boundary_improvement_iterations(cv2, image, pivot_ring(), None, 100)

        self.assertEqual(len(iterations), 100)
        self.assertEqual(iterations[-1]["iteration"], 100)
        self.assertIn("bestRejectedCandidate", iterations[0])
        self.assertIn("bestAcceptedCandidate", iterations[0])

    def test_boundary_quality_is_independent_of_cuda_and_requires_review(self) -> None:
        candidate = {
            "rejected": False,
            "confidence": DEFAULT_VISION_THRESHOLDS["minFieldBoundaryConfidence"] + 0.05,
        }
        accepted = boundary_improvement_acceptance(
            candidate,
            {"bestOperatorIoU": None},
            None,
            {"cudaAvailable": True},
            [{"x": 1.0, "y": 1.0}, {"x": 2.0, "y": 1.0}, {"x": 2.0, "y": 2.0}],
        )
        self.assertTrue(accepted["accepted"])
        self.assertEqual(accepted["status"], "accepted")
        self.assertFalse(accepted["gpuBacked"])
        self.assertFalse(accepted["autoApplyEligible"])
        self.assertTrue(accepted["operatorReviewRequired"])

        no_gpu = boundary_improvement_acceptance(
            candidate,
            {"bestOperatorIoU": None},
            None,
            {"cudaAvailable": False},
            [{"x": 1.0, "y": 1.0}, {"x": 2.0, "y": 1.0}, {"x": 2.0, "y": 2.0}],
        )
        self.assertTrue(no_gpu["accepted"])
        self.assertFalse(no_gpu["gpuBacked"])
        self.assertEqual(no_gpu["reasons"], accepted["reasons"])

    def test_improvement_loop_records_mocked_gpu_preflight_metadata(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image = np.full((500, 500, 3), (82, 120, 74), dtype=np.uint8)
            cv2.rectangle(image, (72, 84), (428, 416), (35, 35, 35), 4)
            cv2.circle(image, (250, 250), 95, (105, 150, 100), 3)
            map_canvas = root / "map.png"
            cv2.imwrite(str(map_canvas), image)
            output_dir = root / "loop"

            with patch("cplayout_ml.cli.probe_cuda", return_value={
                "torchAvailable": True,
                "cudaAvailable": True,
                "deviceCount": 1,
                "devices": ["NVIDIA GeForce RTX 4070 Laptop GPU"],
            }), patch("cplayout_ml.cli.torch_gpu_image_preflight", return_value={
                "device": "NVIDIA GeForce RTX 4070 Laptop GPU",
                "shape": [500, 500, 3],
                "meanAbsGradient": 0.1,
            }):
                self.assertEqual(
                    improve_boundary_detector(
                        map_canvas,
                        None,
                        None,
                        None,
                        None,
                        None,
                        "USER DRAWN FIELD BOUNDARY",
                        output_dir,
                        5,
                        "2026-05-30T00:00:00.000Z",
                    ),
                    0,
                )

            report = json.loads((output_dir / "boundary-improvement-loop.json").read_text(encoding="utf-8"))
            self.assertEqual(report["schemaVersion"], "cplayout-boundary-improvement-loop-v2")
            self.assertTrue(report["gpu"]["cudaAvailable"])
            self.assertTrue(report["gpu"]["usedForTorchTensorPreflight"])
            self.assertEqual(report["gpu"]["tensorPreflight"]["device"], "NVIDIA GeForce RTX 4070 Laptop GPU")
            self.assertEqual(report["acceptance"]["gpuBacked"], False)
            self.assertEqual(report["stageObservations"][0]["observedDevice"], "cpu")
            self.assertFalse(report["stageObservations"][0]["accelerated"])
            self.assertEqual(report["stageObservations"][1]["observedDevice"], "cuda")
            self.assertTrue(report["stageObservations"][1]["diagnosticOnly"])

    def test_failed_cuda_preflight_does_not_block_cpu_boundary_report(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image = np.full((300, 300, 3), (82, 120, 74), dtype=np.uint8)
            cv2.rectangle(image, (35, 40), (265, 260), (35, 35, 35), 4)
            map_canvas = root / "map.png"
            cv2.imwrite(str(map_canvas), image)
            output_dir = root / "loop"
            with patch("cplayout_ml.cli.probe_cuda", return_value={"cudaAvailable": True}), \
                 patch("cplayout_ml.cli.torch_gpu_image_preflight", side_effect=RuntimeError("unavailable")):
                code = improve_boundary_detector(map_canvas, None, None, None, None, None,
                    "USER DRAWN FIELD BOUNDARY", output_dir, 5, "2026-05-30T00:00:00.000Z")
            self.assertEqual(code, 0)
            report = json.loads((output_dir / "boundary-improvement-loop.json").read_text(encoding="utf-8"))
            self.assertEqual(report["gpu"]["tensorPreflightError"], "RuntimeError")
            self.assertEqual(report["stageObservations"][0]["observedDevice"], "cpu")
            self.assertEqual(report["stageObservations"][1]["observedDevice"], "failed")
            self.assertFalse(report["acceptance"]["gpuBacked"])

    def test_pivot_locator_iteration_runner_records_requested_100_iterations(self) -> None:
        image, truth = synthetic_pivot_fixture(cv2)

        iterations = run_pivot_locator_iterations(cv2, image, truth, 100)

        self.assertEqual(len(iterations), 100)
        self.assertEqual(iterations[-1]["iteration"], 100)
        self.assertTrue(any(iteration["decision"] == "pass_synthetic" for iteration in iterations))
        best = sorted(
            [iteration for iteration in iterations if iteration["bestCandidate"] is not None],
            key=lambda iteration: iteration["metrics"]["centerErrorPx"],
        )[0]
        self.assertLessEqual(best["metrics"]["centerErrorPx"], DEFAULT_VISION_THRESHOLDS["maxCenterTruthOffsetPx"])
        self.assertFalse(best["canonicalGeometryMutation"])
        self.assertFalse(best["networkRequired"])
        self.assertFalse(best["hiddenKeysAllowed"])
        self.assertFalse(best["weightedVote"]["realWorldAccepted"])

    def test_pivot_locator_loop_writes_100_iteration_artifacts(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "pivot-loop"

            self.assertEqual(
                run_pivot_locator_loop(
                    None,
                    output_dir,
                    100,
                    True,
                    None,
                    None,
                    None,
                    "2026-06-01T00:00:00.000Z",
                ),
                0,
            )

            report = json.loads((output_dir / "pivot-locator-loop.json").read_text(encoding="utf-8"))
            iterations = (output_dir / "pivot-locator-iterations.jsonl").read_text(encoding="utf-8").strip().splitlines()
            self.assertEqual(report["schemaVersion"], "cplayout-pivot-locator-loop-v1")
            self.assertEqual(report["iterationCount"], 100)
            self.assertEqual(len(iterations), 100)
            self.assertEqual(report["fixtureKind"], "synthetic_generated")
            self.assertGreater(report["metrics"]["syntheticPasses"], 0)
            self.assertFalse(report["canonicalGeometryMutation"])
            self.assertFalse(report["networkRequired"])
            self.assertFalse(report["hiddenKeysAllowed"])
            self.assertFalse(report["realWorldAcceptance"]["accepted"])
            self.assertTrue((output_dir / "pivot-locator-annotated.png").exists())
            self.assertTrue((output_dir / "pivot-locator-synthetic-fixture.png").exists())

    def test_detect_pivot_candidates_writes_metadata_only_companion_report_output(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "pivot-candidates"

            self.assertEqual(
                detect_pivot_candidates(
                    None,
                    True,
                    output_dir,
                    "project-a",
                    "LOCAL:IMAGE",
                    100,
                    None,
                    None,
                    None,
                    "2026-06-01T00:00:00.000Z",
                ),
                0,
            )

            report = json.loads((output_dir / "pivot-candidates-report.json").read_text(encoding="utf-8"))
            geojson = json.loads((output_dir / "pivot-candidates-candidates.geojson").read_text(encoding="utf-8"))
            iterations = (output_dir / "pivot-candidates-iterations.jsonl").read_text(encoding="utf-8").strip().splitlines()
            recommendation = report["candidateReports"][0]
            evidence = report["evidenceRecords"][0]

            self.assertEqual(report["schemaVersion"], "cplayout-pivot-candidates-v1")
            self.assertEqual(len(iterations), 100)
            self.assertEqual(report["projectCrs"], "LOCAL:IMAGE")
            self.assertFalse(report["canonicalGeometryMutation"])
            self.assertFalse(report["networkRequired"])
            self.assertFalse(report["hiddenKeysAllowed"])
            self.assertFalse(report["acceptance"]["accepted"])
            self.assertFalse(report["acceptance"]["autoApplyEligible"])
            self.assertIn("projected XY calibration absent", report["acceptance"]["hardFailures"])
            self.assertEqual(evidence["sourceKind"], "model_output")
            self.assertEqual(evidence["metrics"]["iterationCount"], 100)
            self.assertIn("bestCandidate", evidence["metrics"])
            self.assertNotIn("pivotCenter", recommendation["proposedGeometry"])
            self.assertEqual(recommendation["proposedGeometry"]["projectCrs"], "LOCAL:IMAGE")
            self.assertEqual(recommendation["metadata"]["schemaVersion"], "cplayout-pivot-candidates-v1")
            self.assertFalse(recommendation["metadata"]["feasible"])
            self.assertIn("projected XY calibration absent", recommendation["metadata"]["hardFailures"])
            self.assertEqual(geojson["features"][0]["properties"]["geometryRole"], "metadata_only")
            self.assertIsNone(geojson["features"][0]["geometry"])
            self.assertTrue((output_dir / "pivot-candidates-annotated.png").exists())
            self.assertTrue((output_dir / "pivot-candidates-synthetic-fixture.png").exists())

    def test_detect_pivot_candidates_rejects_wgs84_project_crs(self) -> None:
        with TemporaryDirectory() as temp_dir:
            with self.assertRaises(SystemExit):
                detect_pivot_candidates(
                    None,
                    True,
                    Path(temp_dir) / "pivot-candidates",
                    "project-a",
                    "EPSG:4326",
                    1,
                    None,
                    None,
                    None,
                    "2026-06-01T00:00:00.000Z",
                )

    def test_validate_project_rejects_geographic_crs_aliases(self) -> None:
        base_project = {
            "id": "project-a",
            "projectCrs": "LOCAL:TEST",
            "fieldBoundary": [{"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 0, "y": 10}],
            "pivotCenter": {"x": 1, "y": 1},
            "machine": {"spanLengthsMeters": [10]},
        }
        validate_project(base_project)

        for crs in ["EPSG:4326", "CRS:84", "OGC:CRS84", "WGS84", "longitude latitude geographic"]:
            with self.subTest(crs=crs):
                with self.assertRaises(SystemExit):
                    validate_project({**base_project, "projectCrs": crs})


if __name__ == "__main__":
    unittest.main()
