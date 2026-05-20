#!/usr/bin/env python3
"""Preview-match CycleWays source segments onto the generated OSM base graph.

This is an exploration artifact, not a source migration. It samples each active
CycleWays segment, finds nearby OSM graph edges, and writes visual/debug outputs
that help decide how much of the existing CycleWays network can become an
overlay on top of the OSM-derived base graph.
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_MAX_DISTANCE_M = 28.0
DEFAULT_SAMPLE_SPACING_M = 18.0
DEFAULT_DIRECTION_LIMIT_DEGREES = 60.0
DEFAULT_DIRECTION_PENALTY_M = 10.0
DEFAULT_GRID_CELL_M = 90.0
MIN_GAP_LENGTH_M = 18.0
MIN_EDGE_SUPPORT_SAMPLES = 2
MIN_EDGE_SUPPORT_RATIO = 0.12
MIN_BOUNDARY_SLIVER_EDGE_LENGTH_M = 60.0
MAX_BOUNDARY_SLIVER_SUPPORT_RATIO = 0.34
MIN_TERMINAL_SINGLE_SAMPLE_EDGE_LENGTH_M = 18.0
LONG_EDGE_THRESHOLD_M = 120.0
MAX_EDGE_LENGTH_RATIO = 0.35
MAX_EDGE_SUM_RATIO = 1.18
MAX_EDGE_CONNECTION_GAP_M = 12.0
MAX_CONNECTOR_BRIDGE_M = 45.0


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, data: Any, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        if compact:
            json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def clean_coord(coord: list[float]) -> list[float]:
    return [float(coord[0]), float(coord[1])]


def haversine_m(a: list[float], b: list[float]) -> float:
    radius_m = 6_371_000
    lng1, lat1 = a[:2]
    lng2, lat2 = b[:2]
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    value = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return radius_m * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def line_length_m(coordinates: list[list[float]]) -> float:
    return sum(
        haversine_m(coordinates[index - 1], coordinates[index])
        for index in range(1, len(coordinates))
    )


def coordinate_bounds(feature_collections: list[dict[str, Any]]) -> tuple[float, float, float, float]:
    min_lng = math.inf
    min_lat = math.inf
    max_lng = -math.inf
    max_lat = -math.inf

    for collection in feature_collections:
        for feature in collection.get("features", []):
            geometry = feature.get("geometry") or {}
            if geometry.get("type") != "LineString":
                continue
            for coord in geometry.get("coordinates", []):
                if len(coord) < 2:
                    continue
                lng = float(coord[0])
                lat = float(coord[1])
                min_lng = min(min_lng, lng)
                min_lat = min(min_lat, lat)
                max_lng = max(max_lng, lng)
                max_lat = max(max_lat, lat)

    if not all(math.isfinite(value) for value in (min_lng, min_lat, max_lng, max_lat)):
        raise ValueError("Could not compute coordinate bounds")
    return min_lng, min_lat, max_lng, max_lat


def make_projection(bounds: tuple[float, float, float, float]):
    _min_lng, min_lat, _max_lng, max_lat = bounds
    lat0 = math.radians((min_lat + max_lat) / 2)
    meters_per_deg_lat = 111_320.0
    meters_per_deg_lng = meters_per_deg_lat * math.cos(lat0)

    def project(coord: list[float]) -> tuple[float, float]:
        return float(coord[0]) * meters_per_deg_lng, float(coord[1]) * meters_per_deg_lat

    return project


def vector_length(vector: tuple[float, float]) -> float:
    return math.hypot(vector[0], vector[1])


def unit_vector(vector: tuple[float, float]) -> tuple[float, float]:
    length = vector_length(vector)
    if length == 0:
        return 0.0, 0.0
    return vector[0] / length, vector[1] / length


def undirected_angle_degrees(
    vector_a: tuple[float, float],
    vector_b: tuple[float, float],
) -> float:
    unit_a = unit_vector(vector_a)
    unit_b = unit_vector(vector_b)
    if unit_a == (0.0, 0.0) or unit_b == (0.0, 0.0):
        return 0.0
    dot = max(-1.0, min(1.0, unit_a[0] * unit_b[0] + unit_a[1] * unit_b[1]))
    angle = math.degrees(math.acos(dot))
    return min(angle, 180.0 - angle)


def direction_label(
    source_vector: tuple[float, float],
    graph_vector: tuple[float, float],
) -> str:
    unit_source = unit_vector(source_vector)
    unit_graph = unit_vector(graph_vector)
    dot = unit_source[0] * unit_graph[0] + unit_source[1] * unit_graph[1]
    return "forward" if dot >= 0 else "reverse"


def segment_projection(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> tuple[tuple[float, float], float]:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length_squared = dx * dx + dy * dy
    if length_squared == 0:
        return start, 0.0
    t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length_squared
    t = max(0.0, min(1.0, t))
    return (start[0] + t * dx, start[1] + t * dy), t


class EdgeSpatialIndex:
    def __init__(
        self,
        edge_features: list[dict[str, Any]],
        project,
        *,
        cell_size_m: float,
        max_distance_m: float,
    ) -> None:
        self.cell_size_m = cell_size_m
        self.max_distance_m = max_distance_m
        self.edge_features = edge_features
        self.segments: list[dict[str, Any]] = []
        self.grid: dict[tuple[int, int], list[int]] = defaultdict(list)
        self._build(project)

    def _cell(self, point: tuple[float, float]) -> tuple[int, int]:
        return math.floor(point[0] / self.cell_size_m), math.floor(point[1] / self.cell_size_m)

    def _cells_for_bounds(
        self,
        min_x: float,
        min_y: float,
        max_x: float,
        max_y: float,
    ) -> list[tuple[int, int]]:
        min_cell_x = math.floor(min_x / self.cell_size_m)
        min_cell_y = math.floor(min_y / self.cell_size_m)
        max_cell_x = math.floor(max_x / self.cell_size_m)
        max_cell_y = math.floor(max_y / self.cell_size_m)
        return [
            (cell_x, cell_y)
            for cell_x in range(min_cell_x, max_cell_x + 1)
            for cell_y in range(min_cell_y, max_cell_y + 1)
        ]

    def _build(self, project) -> None:
        for feature_index, feature in enumerate(self.edge_features):
            geometry = feature.get("geometry") or {}
            if geometry.get("type") != "LineString":
                continue
            coordinates = [clean_coord(coord) for coord in geometry.get("coordinates", []) if len(coord) >= 2]
            if len(coordinates) < 2:
                continue
            projected = [project(coord) for coord in coordinates]
            properties = feature.get("properties") or {}
            edge_id = str(properties.get("edgeId") or properties.get("id") or feature.get("id"))

            for segment_index in range(len(projected) - 1):
                start = projected[segment_index]
                end = projected[segment_index + 1]
                vector = (end[0] - start[0], end[1] - start[1])
                if vector_length(vector) == 0:
                    continue
                segment = {
                    "edgeId": edge_id,
                    "featureIndex": feature_index,
                    "segmentIndex": segment_index,
                    "start": start,
                    "end": end,
                    "vector": vector,
                }
                segment_id = len(self.segments)
                self.segments.append(segment)

                min_x = min(start[0], end[0]) - self.max_distance_m
                min_y = min(start[1], end[1]) - self.max_distance_m
                max_x = max(start[0], end[0]) + self.max_distance_m
                max_y = max(start[1], end[1]) + self.max_distance_m
                for cell in self._cells_for_bounds(min_x, min_y, max_x, max_y):
                    self.grid[cell].append(segment_id)

    def candidates_near(self, point: tuple[float, float]) -> list[dict[str, Any]]:
        return [self.segments[index] for index in self.grid.get(self._cell(point), [])]


class EdgeConnectivityIndex:
    def __init__(self, edge_features: list[dict[str, Any]]) -> None:
        self.edge_features = edge_features
        self.edge_by_id: dict[str, dict[str, Any]] = {}
        self.feature_index_by_edge_id: dict[str, int] = {}
        self.adjacency: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self._build()

    def _build(self) -> None:
        for feature_index, feature in enumerate(self.edge_features):
            properties = feature.get("properties") or {}
            edge_id = str(properties.get("edgeId") or properties.get("id") or feature.get("id"))
            from_node_id = properties.get("fromNodeId")
            to_node_id = properties.get("toNodeId")
            if not edge_id or not from_node_id or not to_node_id:
                continue
            distance_m = float(
                properties.get("distanceMeters")
                or line_length_m(feature.get("geometry", {}).get("coordinates") or [])
            )
            self.edge_by_id[edge_id] = feature
            self.feature_index_by_edge_id[edge_id] = feature_index
            self.adjacency[str(from_node_id)].append(
                {
                    "toNodeId": str(to_node_id),
                    "edgeId": edge_id,
                    "direction": "forward",
                    "distanceMeters": distance_m,
                }
            )
            self.adjacency[str(to_node_id)].append(
                {
                    "toNodeId": str(from_node_id),
                    "edgeId": edge_id,
                    "direction": "reverse",
                    "distanceMeters": distance_m,
                }
            )

    def oriented_nodes(self, edge_id: str, direction: str) -> tuple[str | None, str | None]:
        feature = self.edge_by_id.get(edge_id)
        properties = feature.get("properties") if feature else {}
        from_node_id = properties.get("fromNodeId")
        to_node_id = properties.get("toNodeId")
        if not from_node_id or not to_node_id:
            return None, None
        if direction == "reverse":
            return str(to_node_id), str(from_node_id)
        return str(from_node_id), str(to_node_id)

    def shortest_connector_path(
        self,
        from_node_id: str | None,
        to_node_id: str | None,
        *,
        max_distance_m: float,
        excluded_edge_ids: set[str],
    ) -> list[dict[str, Any]]:
        if not from_node_id or not to_node_id or from_node_id == to_node_id:
            return []

        queue: list[tuple[float, int, str, list[dict[str, Any]]]] = [(0.0, 0, from_node_id, [])]
        push_count = 1
        best_distance_by_node = {from_node_id: 0.0}
        while queue:
            distance_m, _push_index, node_id, path = heapq.heappop(queue)
            if distance_m > max_distance_m:
                continue
            if node_id == to_node_id:
                return path
            if distance_m > best_distance_by_node.get(node_id, math.inf):
                continue
            for edge in self.adjacency.get(node_id, []):
                edge_id = str(edge["edgeId"])
                if edge_id in excluded_edge_ids:
                    continue
                next_distance = distance_m + float(edge["distanceMeters"])
                if next_distance > max_distance_m:
                    continue
                next_node_id = str(edge["toNodeId"])
                if next_distance >= best_distance_by_node.get(next_node_id, math.inf):
                    continue
                best_distance_by_node[next_node_id] = next_distance
                heapq.heappush(
                    queue,
                    (
                        next_distance,
                        push_count,
                        next_node_id,
                        [
                            *path,
                            {
                                "edgeId": edge_id,
                                "direction": edge["direction"],
                                "distanceMeters": float(edge["distanceMeters"]),
                            },
                        ],
                    ),
                )
                push_count += 1
        return []


def active_cycleways_features(source_geojson: dict[str, Any]) -> list[dict[str, Any]]:
    features = []
    for feature in source_geojson.get("features", []):
        geometry = feature.get("geometry") or {}
        properties = feature.get("properties") or {}
        status = properties.get("status", "active")
        if geometry.get("type") != "LineString":
            continue
        if status in {"deprecated", "draft", "legacy"} or properties.get("deprecated"):
            continue
        coordinates = geometry.get("coordinates") or []
        if len(coordinates) < 2:
            continue
        features.append(feature)
    return features


def sample_line(
    coordinates: list[list[float]],
    project,
    spacing_m: float,
) -> tuple[list[dict[str, Any]], float]:
    clean_coordinates = [clean_coord(coord) for coord in coordinates if len(coord) >= 2]
    projected = [project(coord) for coord in clean_coordinates]
    cumulative = [0.0]
    for index in range(1, len(projected)):
        previous = projected[index - 1]
        current = projected[index]
        cumulative.append(cumulative[-1] + math.hypot(current[0] - previous[0], current[1] - previous[1]))

    total_length = cumulative[-1] if cumulative else 0.0
    if total_length == 0:
        return [], 0.0

    distances = [0.0]
    distance = spacing_m
    while distance < total_length:
        distances.append(distance)
        distance += spacing_m
    if distances[-1] != total_length:
        distances.append(total_length)

    samples = []
    segment_index = 0
    for distance_along in distances:
        while segment_index < len(cumulative) - 2 and cumulative[segment_index + 1] < distance_along:
            segment_index += 1
        start_distance = cumulative[segment_index]
        end_distance = cumulative[segment_index + 1]
        segment_length = end_distance - start_distance
        t = 0.0 if segment_length == 0 else (distance_along - start_distance) / segment_length
        t = max(0.0, min(1.0, t))
        start_coord = clean_coordinates[segment_index]
        end_coord = clean_coordinates[segment_index + 1]
        start_point = projected[segment_index]
        end_point = projected[segment_index + 1]
        coord = [
            start_coord[0] + (end_coord[0] - start_coord[0]) * t,
            start_coord[1] + (end_coord[1] - start_coord[1]) * t,
        ]
        point = (
            start_point[0] + (end_point[0] - start_point[0]) * t,
            start_point[1] + (end_point[1] - start_point[1]) * t,
        )
        samples.append(
            {
                "coord": [round(coord[0], 7), round(coord[1], 7)],
                "point": point,
                "distanceAlong": distance_along,
                "sourceVector": (end_point[0] - start_point[0], end_point[1] - start_point[1]),
            }
        )

    return samples, total_length


def find_best_match(
    sample: dict[str, Any],
    edge_index: EdgeSpatialIndex,
    *,
    max_distance_m: float,
    direction_limit_degrees: float,
    direction_penalty_m: float,
) -> dict[str, Any] | None:
    best = None
    for candidate in edge_index.candidates_near(sample["point"]):
        projected, _t = segment_projection(sample["point"], candidate["start"], candidate["end"])
        distance_m = math.hypot(sample["point"][0] - projected[0], sample["point"][1] - projected[1])
        if distance_m > max_distance_m:
            continue

        angle_degrees = undirected_angle_degrees(sample["sourceVector"], candidate["vector"])
        if angle_degrees > direction_limit_degrees and distance_m > 4.0:
            continue

        score = distance_m + (angle_degrees / max(direction_limit_degrees, 1.0)) * direction_penalty_m
        if best is None or score < best["score"]:
            best = {
                "edgeId": candidate["edgeId"],
                "featureIndex": candidate["featureIndex"],
                "distanceMeters": distance_m,
                "angleDegrees": angle_degrees,
                "direction": direction_label(sample["sourceVector"], candidate["vector"]),
                "score": score,
            }
    return best


def confidence_for(coverage_ratio: float, avg_distance_m: float | None) -> str:
    if avg_distance_m is None:
        return "none"
    if coverage_ratio >= 0.92 and avg_distance_m <= 8.0:
        return "high"
    if coverage_ratio >= 0.78 and avg_distance_m <= 14.0:
        return "medium"
    if coverage_ratio >= 0.45 and avg_distance_m <= 22.0:
        return "low"
    return "none"


def classify_match(
    *,
    coverage_ratio: float,
    avg_distance_m: float | None,
    gap_count: int,
    matched_edge_count: int,
    overmatched_edge_count: int,
    edge_length_ratio: float | None,
    continuity_gap_count: int,
) -> dict[str, str]:
    if avg_distance_m is None or matched_edge_count == 0:
        return {
            "failureClass": "osm_missing",
            "reviewStatus": "needs_manual_edge_candidate",
            "reviewReason": "No nearby base graph edge matched the sampled CycleWays geometry.",
        }

    if continuity_gap_count > 0:
        return {
            "failureClass": "disconnected_edges",
            "reviewStatus": "inspect_continuity",
            "reviewReason": "The matched base edge sequence is not continuous.",
        }

    if overmatched_edge_count > 0 or (edge_length_ratio is not None and edge_length_ratio > MAX_EDGE_SUM_RATIO):
        return {
            "failureClass": "overmatched_edge",
            "reviewStatus": "inspect_edge_sequence",
            "reviewReason": "The matched edge sequence includes full base edges that are too long for their sample support.",
        }

    if coverage_ratio >= 0.92 and avg_distance_m <= 8.0:
        return {
            "failureClass": "accepted",
            "reviewStatus": "auto_accept_candidate",
            "reviewReason": "Coverage and average distance are both within the high-confidence threshold.",
        }

    if coverage_ratio >= 0.75 and gap_count > 0:
        return {
            "failureClass": "partial_gap",
            "reviewStatus": "inspect_gaps",
            "reviewReason": "Most samples matched, but the segment still has unmatched gaps.",
        }

    if coverage_ratio < 0.2:
        return {
            "failureClass": "osm_missing",
            "reviewStatus": "needs_manual_edge_candidate",
            "reviewReason": "Only a small fraction of the CycleWays segment matched nearby base graph edges.",
        }

    if avg_distance_m <= 8.0 and gap_count > 0:
        return {
            "failureClass": "partial_gap",
            "reviewStatus": "inspect_gaps",
            "reviewReason": "Matched portions are close to the base graph, but unmatched gaps remain.",
        }

    if coverage_ratio < 0.75 and avg_distance_m <= 8.0:
        return {
            "failureClass": "matcher_failed",
            "reviewStatus": "inspect_matcher",
            "reviewReason": "Matched samples are close, but coverage is too low for automatic acceptance.",
        }

    if avg_distance_m >= 14.0:
        return {
            "failureClass": "source_geometry_mismatch",
            "reviewStatus": "inspect_source_geometry",
            "reviewReason": "The matched geometry is relatively far from the current CycleWays source line.",
        }

    return {
        "failureClass": "manual_review",
        "reviewStatus": "manual_review",
        "reviewReason": "The automatic signals are mixed and need visual review.",
    }


def collapse_edge_sequence(matches: list[dict[str, Any] | None]) -> list[str]:
    sequence: list[str] = []
    previous = None
    for match in matches:
        edge_id = match["edgeId"] if match else None
        if not edge_id:
            previous = None
            continue
        if edge_id != previous:
            sequence.append(edge_id)
        previous = edge_id
    return sequence


def unmatched_gap_features(
    samples: list[dict[str, Any]],
    matches: list[dict[str, Any] | None],
    properties: dict[str, Any],
    confidence: str,
    coverage_ratio: float,
) -> list[dict[str, Any]]:
    features = []
    start_index = None

    def close_gap(end_index: int) -> None:
        nonlocal start_index
        if start_index is None:
            return
        group = samples[start_index:end_index]
        start_index = None
        if len(group) < 2:
            return
        coordinates = [sample["coord"] for sample in group]
        gap_length = line_length_m(coordinates)
        if gap_length < MIN_GAP_LENGTH_M:
            return
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": coordinates,
                },
                "properties": {
                    "kind": "gap",
                    "debugType": "cwMatchGap",
                    "segmentId": properties.get("id"),
                    "segmentName": properties.get("name"),
                    "roadType": properties.get("roadType"),
                    "confidence": confidence,
                    "coverageRatio": round(coverage_ratio, 4),
                    "distanceMeters": round(gap_length, 1),
                },
            }
        )

    for index, match in enumerate(matches):
        if match is None:
            if start_index is None:
                start_index = index
            continue
        close_gap(index)
    close_gap(len(samples))
    return features


def sample_diagnostic_features(
    samples: list[dict[str, Any]],
    matches: list[dict[str, Any] | None],
    properties: dict[str, Any],
    *,
    high_distance_m: float,
) -> list[dict[str, Any]]:
    features = []
    for index, sample in enumerate(samples):
        match = matches[index] if index < len(matches) else None
        if match is None:
            kind = "unmatchedSample"
            distance_m = None
        elif match["distanceMeters"] >= high_distance_m:
            kind = "distantSample"
            distance_m = match["distanceMeters"]
        else:
            continue

        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": sample["coord"],
                },
                "properties": {
                    "kind": kind,
                    "debugType": "cwMatchSample",
                    "segmentId": properties.get("id"),
                    "segmentName": properties.get("name"),
                    "roadType": properties.get("roadType"),
                    "sampleIndex": index,
                    "distanceAlongMeters": round(sample["distanceAlong"], 1),
                    "distanceMeters": round(distance_m, 2) if distance_m is not None else None,
                    "edgeId": match.get("edgeId") if match else None,
                    "direction": match.get("direction") if match else None,
                },
            }
        )
    return features


def build_edge_support_diagnostics(
    edge_stats: dict[str, dict[str, Any]],
    edge_features: list[dict[str, Any]],
    *,
    edge_sequence: list[str],
    total_length_m: float,
    sample_spacing_m: float,
) -> tuple[list[dict[str, Any]], float | None]:
    diagnostics = []
    total_edge_length_m = 0.0
    first_edge_id = edge_sequence[0] if edge_sequence else None
    last_edge_id = edge_sequence[-1] if edge_sequence else None

    for edge_id, stats in edge_stats.items():
        source_edge = edge_features[stats["featureIndex"]]
        edge_properties = source_edge.get("properties") or {}
        edge_length_m = float(edge_properties.get("distanceMeters") or line_length_m(source_edge.get("geometry", {}).get("coordinates") or []))
        total_edge_length_m += edge_length_m
        sample_count = int(stats["sampleCount"])
        support_length_m = sample_count * sample_spacing_m
        support_ratio = support_length_m / edge_length_m if edge_length_m > 0 else 0.0
        segment_length_ratio = edge_length_m / total_length_m if total_length_m > 0 else 0.0
        is_boundary_edge = edge_id == first_edge_id or edge_id == last_edge_id
        suspicious_reasons = []
        if (
            is_boundary_edge
            and sample_count == 1
            and edge_length_m >= max(sample_spacing_m, MIN_TERMINAL_SINGLE_SAMPLE_EDGE_LENGTH_M)
        ):
            suspicious_reasons.append("terminal_single_sample_edge")
        if (
            is_boundary_edge
            and edge_length_m >= MIN_BOUNDARY_SLIVER_EDGE_LENGTH_M
            and sample_count <= MIN_EDGE_SUPPORT_SAMPLES
            and support_ratio <= MAX_BOUNDARY_SLIVER_SUPPORT_RATIO
        ):
            suspicious_reasons.append("boundary_sliver_low_support")
        if edge_length_m >= LONG_EDGE_THRESHOLD_M and sample_count < MIN_EDGE_SUPPORT_SAMPLES:
            suspicious_reasons.append("long_edge_low_sample_count")
        if edge_length_m >= LONG_EDGE_THRESHOLD_M and support_ratio < MIN_EDGE_SUPPORT_RATIO:
            suspicious_reasons.append("low_edge_support_ratio")
        if segment_length_ratio > MAX_EDGE_LENGTH_RATIO and sample_count < MIN_EDGE_SUPPORT_SAMPLES:
            suspicious_reasons.append("large_edge_relative_to_segment")

        diagnostics.append(
            {
                "edgeId": edge_id,
                "edgeLengthMeters": round(edge_length_m, 1),
                "sampleCount": sample_count,
                "supportLengthMeters": round(support_length_m, 1),
                "supportRatio": round(support_ratio, 4),
                "segmentLengthRatio": round(segment_length_ratio, 4),
                "boundaryEdge": is_boundary_edge,
                "suspicious": len(suspicious_reasons) > 0,
                "suspiciousReasons": suspicious_reasons,
            }
        )

    edge_length_ratio = total_edge_length_m / total_length_m if total_length_m > 0 else None
    diagnostics.sort(key=lambda item: (not item["suspicious"], -item["edgeLengthMeters"]))
    return diagnostics, edge_length_ratio


def oriented_edge_coordinates(
    edge_id: str,
    edge_stats: dict[str, dict[str, Any]],
    edge_features: list[dict[str, Any]],
) -> list[list[float]]:
    stats = edge_stats.get(edge_id)
    if not stats:
        return []
    source_edge = edge_features[stats["featureIndex"]]
    coordinates = [
        clean_coord(coord)
        for coord in source_edge.get("geometry", {}).get("coordinates", [])
        if len(coord) >= 2
    ]
    if stats["directions"].most_common(1)[0][0] == "reverse":
        coordinates = list(reversed(coordinates))
    return coordinates


def edge_continuity_diagnostics(
    edge_sequence: list[str],
    edge_stats: dict[str, dict[str, Any]],
    edge_features: list[dict[str, Any]],
    properties: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    gaps = []
    features = []

    for sequence_index in range(len(edge_sequence) - 1):
        from_edge_id = edge_sequence[sequence_index]
        to_edge_id = edge_sequence[sequence_index + 1]
        from_coords = oriented_edge_coordinates(from_edge_id, edge_stats, edge_features)
        to_coords = oriented_edge_coordinates(to_edge_id, edge_stats, edge_features)
        if not from_coords or not to_coords:
            continue

        from_coord = from_coords[-1]
        to_coord = to_coords[0]
        distance_m = haversine_m(from_coord, to_coord)
        if distance_m <= MAX_EDGE_CONNECTION_GAP_M:
            continue

        gap = {
            "fromEdgeId": from_edge_id,
            "toEdgeId": to_edge_id,
            "sequenceIndex": sequence_index,
            "distanceMeters": round(distance_m, 1),
        }
        gaps.append(gap)
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [from_coord, to_coord],
                },
                "properties": {
                    "kind": "continuityGap",
                    "debugType": "cwMatchContinuityGap",
                    "segmentId": properties.get("id"),
                    "segmentName": properties.get("name"),
                    "roadType": properties.get("roadType"),
                    **gap,
                },
            }
        )

    return gaps, features


def primary_direction_for_edge(edge_id: str, edge_stats: dict[str, dict[str, Any]]) -> str:
    stats = edge_stats.get(edge_id)
    if not stats or not stats["directions"]:
        return "forward"
    return stats["directions"].most_common(1)[0][0]


def add_connector_edge_stats(
    connector: dict[str, Any],
    edge_stats: dict[str, dict[str, Any]],
    connectivity_index: EdgeConnectivityIndex,
) -> None:
    edge_id = str(connector["edgeId"])
    if edge_id in edge_stats:
        edge_stats[edge_id]["directions"][connector["direction"]] += 1
        edge_stats[edge_id]["connector"] = True
        return

    feature_index = connectivity_index.feature_index_by_edge_id.get(edge_id)
    if feature_index is None:
        return
    edge_stats[edge_id] = {
        "featureIndex": feature_index,
        "sampleCount": 0,
        "distanceTotal": 0.0,
        "directions": Counter({connector["direction"]: 1}),
        "connector": True,
    }


def bridge_short_connector_edges(
    edge_sequence: list[str],
    edge_stats: dict[str, dict[str, Any]],
    connectivity_index: EdgeConnectivityIndex,
) -> tuple[list[str], list[dict[str, Any]]]:
    if len(edge_sequence) < 2:
        return edge_sequence, []

    bridged_sequence: list[str] = []
    inserted_connectors: list[dict[str, Any]] = []

    for index, edge_id in enumerate(edge_sequence[:-1]):
        next_edge_id = edge_sequence[index + 1]
        bridged_sequence.append(edge_id)
        edge_direction = primary_direction_for_edge(edge_id, edge_stats)
        next_direction = primary_direction_for_edge(next_edge_id, edge_stats)
        _edge_start, edge_end = connectivity_index.oriented_nodes(edge_id, edge_direction)
        next_start, _next_end = connectivity_index.oriented_nodes(next_edge_id, next_direction)
        if edge_end is None or next_start is None or edge_end == next_start:
            continue

        connector_path = connectivity_index.shortest_connector_path(
            edge_end,
            next_start,
            max_distance_m=MAX_CONNECTOR_BRIDGE_M,
            excluded_edge_ids={edge_id, next_edge_id},
        )
        if not connector_path:
            continue

        for connector in connector_path:
            connector_edge_id = str(connector["edgeId"])
            if bridged_sequence and bridged_sequence[-1] == connector_edge_id:
                continue
            if connector_edge_id == next_edge_id:
                continue
            bridged_sequence.append(connector_edge_id)
            inserted_connectors.append(
                {
                    **connector,
                    "between": [edge_id, next_edge_id],
                    "sequenceIndex": len(bridged_sequence) - 1,
                }
            )
            add_connector_edge_stats(connector, edge_stats, connectivity_index)

    bridged_sequence.append(edge_sequence[-1])
    return bridged_sequence, inserted_connectors


def match_segment(
    feature: dict[str, Any],
    edge_index: EdgeSpatialIndex,
    connectivity_index: EdgeConnectivityIndex,
    edge_features: list[dict[str, Any]],
    project,
    *,
    sample_spacing_m: float,
    max_distance_m: float,
    direction_limit_degrees: float,
    direction_penalty_m: float,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    properties = feature.get("properties") or {}
    coordinates = feature.get("geometry", {}).get("coordinates", [])
    samples, total_length_m = sample_line(coordinates, project, sample_spacing_m)
    matches = [
        find_best_match(
            sample,
            edge_index,
            max_distance_m=max_distance_m,
            direction_limit_degrees=direction_limit_degrees,
            direction_penalty_m=direction_penalty_m,
        )
        for sample in samples
    ]

    matched_samples = [match for match in matches if match is not None]
    coverage_ratio = len(matched_samples) / len(samples) if samples else 0.0
    avg_distance_m = (
        sum(match["distanceMeters"] for match in matched_samples) / len(matched_samples)
        if matched_samples
        else None
    )
    max_observed_distance_m = (
        max(match["distanceMeters"] for match in matched_samples)
        if matched_samples
        else None
    )
    confidence = confidence_for(coverage_ratio, avg_distance_m)
    edge_sequence = collapse_edge_sequence(matches)

    edge_stats: dict[str, dict[str, Any]] = {}
    for match in matched_samples:
        stats = edge_stats.setdefault(
            match["edgeId"],
            {
                "featureIndex": match["featureIndex"],
                "sampleCount": 0,
                "distanceTotal": 0.0,
                "directions": Counter(),
            },
        )
        stats["sampleCount"] += 1
        stats["distanceTotal"] += match["distanceMeters"]
        stats["directions"][match["direction"]] += 1

    edge_sequence, inserted_connectors = bridge_short_connector_edges(
        edge_sequence,
        edge_stats,
        connectivity_index,
    )

    preview_features: list[dict[str, Any]] = []
    sequence_index_by_edge: dict[str, list[int]] = defaultdict(list)
    for sequence_index, edge_id in enumerate(edge_sequence):
        sequence_index_by_edge[edge_id].append(sequence_index)

    for edge_id, stats in edge_stats.items():
        source_edge = edge_features[stats["featureIndex"]]
        edge_properties = source_edge.get("properties") or {}
        direction = stats["directions"].most_common(1)[0][0]
        avg_edge_distance = stats["distanceTotal"] / stats["sampleCount"] if stats["sampleCount"] else None
        sequence_indexes = sequence_index_by_edge.get(edge_id, [])
        preview_features.append(
            {
                "type": "Feature",
                "id": f"cw-{properties.get('id')}-{edge_id}",
                "geometry": source_edge.get("geometry"),
                "properties": {
                    "kind": "matchedEdge",
                    "debugType": "cwMatchEdge",
                    "segmentId": properties.get("id"),
                    "segmentName": properties.get("name"),
                    "roadType": properties.get("roadType"),
                    "confidence": confidence,
                    "coverageRatio": round(coverage_ratio, 4),
                    "edgeId": edge_id,
                    "osmWayId": edge_properties.get("osmWayId"),
                    "direction": direction,
                    "sequenceIndex": sequence_indexes[0] if sequence_indexes else None,
                    "sequenceIndexes": json.dumps(sequence_indexes, ensure_ascii=False),
                    "sampleCount": stats["sampleCount"],
                    "avgDistanceMeters": round(avg_edge_distance, 2) if avg_edge_distance is not None else None,
                    "connector": bool(stats.get("connector")),
                    "graphHighway": edge_properties.get("highway"),
                    "graphClass": edge_properties.get("osmRouteClass"),
                    "graphAccessStatus": edge_properties.get("accessStatus"),
                },
            }
        )

    preview_features.extend(
        unmatched_gap_features(samples, matches, properties, confidence, coverage_ratio)
    )
    preview_features.extend(
        sample_diagnostic_features(
            samples,
            matches,
            properties,
            high_distance_m=max_distance_m * 0.5,
        )
    )
    continuity_gaps, continuity_features = edge_continuity_diagnostics(
        edge_sequence,
        edge_stats,
        edge_features,
        properties,
    )
    preview_features.extend(continuity_features)

    gap_count = sum(1 for preview in preview_features if preview["properties"].get("kind") == "gap")
    edge_support, edge_length_ratio = build_edge_support_diagnostics(
        edge_stats,
        edge_features,
        edge_sequence=edge_sequence,
        total_length_m=total_length_m,
        sample_spacing_m=sample_spacing_m,
    )
    overmatched_edges = [edge for edge in edge_support if edge["suspicious"]]
    classification = classify_match(
        coverage_ratio=coverage_ratio,
        avg_distance_m=avg_distance_m,
        gap_count=gap_count,
        matched_edge_count=len(edge_stats),
        overmatched_edge_count=len(overmatched_edges),
        edge_length_ratio=edge_length_ratio,
        continuity_gap_count=len(continuity_gaps),
    )

    summary = {
        "segmentId": properties.get("id"),
        "segmentName": properties.get("name"),
        "roadType": properties.get("roadType"),
        "distanceMeters": round(total_length_m, 1),
        "sampleCount": len(samples),
        "matchedSampleCount": len(matched_samples),
        "coverageRatio": round(coverage_ratio, 4),
        "confidence": confidence,
        "avgDistanceMeters": round(avg_distance_m, 2) if avg_distance_m is not None else None,
        "maxDistanceMeters": (
            round(max_observed_distance_m, 2) if max_observed_distance_m is not None else None
        ),
        "matchedEdgeCount": len(edge_stats),
        "edgeSequenceCount": len(edge_sequence),
        "edgeSequence": edge_sequence,
        "insertedConnectorCount": len(inserted_connectors),
        "insertedConnectors": inserted_connectors,
        "edgeLengthRatio": round(edge_length_ratio, 4) if edge_length_ratio is not None else None,
        "overmatchedEdgeCount": len(overmatched_edges),
        "overmatchedEdges": overmatched_edges,
        "edgeSupport": edge_support,
        "continuityGapCount": len(continuity_gaps),
        "continuityGaps": continuity_gaps,
        "gapCount": gap_count,
        **classification,
    }
    return summary, preview_features


def build_preview(
    source_geojson: dict[str, Any],
    graph_edges_geojson: dict[str, Any],
    *,
    sample_spacing_m: float,
    max_distance_m: float,
    direction_limit_degrees: float,
    direction_penalty_m: float,
    grid_cell_m: float,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    active_features = active_cycleways_features(source_geojson)
    edge_features = [
        feature
        for feature in graph_edges_geojson.get("features", [])
        if feature.get("geometry", {}).get("type") == "LineString"
    ]
    bounds = coordinate_bounds(
        [
            {"type": "FeatureCollection", "features": active_features},
            {"type": "FeatureCollection", "features": edge_features},
        ]
    )
    project = make_projection(bounds)
    edge_index = EdgeSpatialIndex(
        edge_features,
        project,
        cell_size_m=grid_cell_m,
        max_distance_m=max_distance_m,
    )
    connectivity_index = EdgeConnectivityIndex(edge_features)

    segment_summaries = []
    preview_features = []
    for feature in active_features:
        summary, segment_preview_features = match_segment(
            feature,
            edge_index,
            connectivity_index,
            edge_features,
            project,
            sample_spacing_m=sample_spacing_m,
            max_distance_m=max_distance_m,
            direction_limit_degrees=direction_limit_degrees,
            direction_penalty_m=direction_penalty_m,
        )
        segment_summaries.append(summary)
        preview_features.extend(segment_preview_features)

    confidence_counts = Counter(summary["confidence"] for summary in segment_summaries)
    total_distance_m = sum(summary["distanceMeters"] for summary in segment_summaries)
    matched_distance_m = sum(
        summary["distanceMeters"] * summary["coverageRatio"]
        for summary in segment_summaries
    )
    gap_count = sum(summary["gapCount"] for summary in segment_summaries)

    summary = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceSegments": len(active_features),
        "graphEdges": len(edge_features),
        "sampleSpacingMeters": sample_spacing_m,
        "maxDistanceMeters": max_distance_m,
        "directionLimitDegrees": direction_limit_degrees,
        "coverageRatio": round(matched_distance_m / total_distance_m, 4)
        if total_distance_m
        else 0.0,
        "totalKm": round(total_distance_m / 1000, 1),
        "matchedKm": round(matched_distance_m / 1000, 1),
        "unmatchedKm": round((total_distance_m - matched_distance_m) / 1000, 1),
        "confidenceCounts": dict(confidence_counts),
        "gapCount": gap_count,
        "segments": sorted(
            segment_summaries,
            key=lambda value: (value["confidence"] == "high", value["coverageRatio"]),
        ),
    }

    preview_geojson = {
        "type": "FeatureCollection",
        "features": preview_features,
    }
    matches_json = {
        "generatedAt": summary["generatedAt"],
        "segments": segment_summaries,
    }
    return preview_geojson, summary, matches_json


def build_single_segment_preview(
    segment_feature: dict[str, Any],
    graph_edges_geojson: dict[str, Any],
    *,
    sample_spacing_m: float,
    max_distance_m: float,
    direction_limit_degrees: float,
    direction_penalty_m: float,
    grid_cell_m: float,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    edge_features = [
        feature
        for feature in graph_edges_geojson.get("features", [])
        if feature.get("geometry", {}).get("type") == "LineString"
    ]
    bounds = coordinate_bounds(
        [
            {"type": "FeatureCollection", "features": [segment_feature]},
            {"type": "FeatureCollection", "features": edge_features},
        ]
    )
    project = make_projection(bounds)
    edge_index = EdgeSpatialIndex(
        edge_features,
        project,
        cell_size_m=grid_cell_m,
        max_distance_m=max_distance_m,
    )
    connectivity_index = EdgeConnectivityIndex(edge_features)
    return match_segment(
        segment_feature,
        edge_index,
        connectivity_index,
        edge_features,
        project,
        sample_spacing_m=sample_spacing_m,
        max_distance_m=max_distance_m,
        direction_limit_degrees=direction_limit_degrees,
        direction_penalty_m=direction_penalty_m,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-geojson",
        type=Path,
        default=Path("data/map-source.geojson"),
        help="CycleWays canonical source GeoJSON.",
    )
    parser.add_argument(
        "--graph-edges",
        type=Path,
        default=Path("build/osm/osm-base-edges.geojson"),
        help="Generated OSM base graph edge GeoJSON.",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("build/osm"),
        help="Directory for match preview artifacts.",
    )
    parser.add_argument("--sample-spacing-m", type=float, default=DEFAULT_SAMPLE_SPACING_M)
    parser.add_argument("--max-distance-m", type=float, default=DEFAULT_MAX_DISTANCE_M)
    parser.add_argument(
        "--direction-limit-degrees",
        type=float,
        default=DEFAULT_DIRECTION_LIMIT_DEGREES,
    )
    parser.add_argument("--direction-penalty-m", type=float, default=DEFAULT_DIRECTION_PENALTY_M)
    parser.add_argument("--grid-cell-m", type=float, default=DEFAULT_GRID_CELL_M)
    parser.add_argument(
        "--single-segment-geojson",
        type=Path,
        help="GeoJSON Feature for one unsaved CycleWays segment to match.",
    )
    parser.add_argument(
        "--single-out-json",
        type=Path,
        help="Write the one-segment match result to this JSON file.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    graph_edges_geojson = load_json(args.graph_edges)
    if args.single_segment_geojson:
        if not args.single_out_json:
            raise ValueError("--single-out-json is required with --single-segment-geojson")
        segment_feature = load_json(args.single_segment_geojson)
        summary, preview_features = build_single_segment_preview(
            segment_feature,
            graph_edges_geojson,
            sample_spacing_m=args.sample_spacing_m,
            max_distance_m=args.max_distance_m,
            direction_limit_degrees=args.direction_limit_degrees,
            direction_penalty_m=args.direction_penalty_m,
            grid_cell_m=args.grid_cell_m,
        )
        result = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "summary": summary,
            "preview": {
                "type": "FeatureCollection",
                "features": preview_features,
            },
        }
        write_json(args.single_out_json, result)
        print(
            "Matched CycleWays segment "
            f"{summary['segmentId']} against {len(graph_edges_geojson.get('features', []))} graph edges: "
            f"{summary['matchedSampleCount']} / {summary['sampleCount']} samples "
            f"({summary['coverageRatio'] * 100:.1f}%)"
        )
        print(f"Wrote {args.single_out_json}")
        return

    source_geojson = load_json(args.source_geojson)
    preview_geojson, summary, matches_json = build_preview(
        source_geojson,
        graph_edges_geojson,
        sample_spacing_m=args.sample_spacing_m,
        max_distance_m=args.max_distance_m,
        direction_limit_degrees=args.direction_limit_degrees,
        direction_penalty_m=args.direction_penalty_m,
        grid_cell_m=args.grid_cell_m,
    )

    preview_path = args.out_dir / "cw-osm-match-preview.geojson"
    summary_path = args.out_dir / "cw-osm-match-summary.json"
    matches_path = args.out_dir / "cw-osm-matches.json"
    write_json(preview_path, preview_geojson, compact=True)
    write_json(summary_path, summary)
    write_json(matches_path, matches_json)

    print(
        "Matched "
        f"{summary['sourceSegments']} CycleWays segments against {summary['graphEdges']} graph edges: "
        f"{summary['matchedKm']} / {summary['totalKm']} km "
        f"({summary['coverageRatio'] * 100:.1f}%)"
    )
    print(f"Wrote {preview_path}")
    print(f"Wrote {summary_path}")
    print(f"Wrote {matches_path}")


if __name__ == "__main__":
    main()
