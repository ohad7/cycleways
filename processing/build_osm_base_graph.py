#!/usr/bin/env python3
"""Build a first-pass static OSM/manual base graph from debug artifacts.

This is a prototype graph builder for inspection and future CycleWays matching.
It splits raw OSM ways at detected intersections and shared vertices, producing
atomic graph edges, and appends manually drawn base edges from the editor.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any

try:
    from .bicycle_traversal_policy import (
        POLICY_DIGEST,
        POLICY_ID,
        normalize_bicycle_traversal,
        source_geometry_digest,
        validate_override,
    )
except ImportError:  # Direct script execution: processing/ is on sys.path.
    from bicycle_traversal_policy import (
        POLICY_DIGEST,
        POLICY_ID,
        normalize_bicycle_traversal,
        source_geometry_digest,
        validate_override,
    )


DEFAULT_NODE_MERGE_TOLERANCE_M = 0.5
DEFAULT_SPLIT_TOLERANCE_M = 1.0
DEFAULT_MIN_EDGE_LENGTH_M = 0.25
MAX_NODE_WAY_IDS = 16
SOURCE_PRIORITY = {
    "manual": 5,
    "overlay_split": 4,
    "calculated_crossing": 3,
    "osm_intersection": 2,
    "osm_vertex": 1,
    "osm_ring_split": 0,
    "osm_endpoint": 0,
}


def record_performance_phase(
    performance: dict[str, Any] | None,
    name: str,
    started_at: float,
) -> None:
    if performance is None:
        return
    performance.setdefault("phasesMs", {})[name] = round(
        (perf_counter() - started_at) * 1000,
        3,
    )


def load_json_snapshot(path: Path, fallback: Any) -> tuple[Any, dict[str, Any]]:
    """Parse and digest the same bytes so a build can prove its exact inputs."""
    if not path.exists():
        return fallback, {
            "path": str(path),
            "exists": False,
            "bytes": 0,
            "digest": None,
        }
    contents = path.read_bytes()
    return json.loads(contents), {
        "path": str(path),
        "exists": True,
        "bytes": len(contents),
        "digest": f"sha256:{hashlib.sha256(contents).hexdigest()}",
    }


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, data: Any, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # json.dump performs a very large number of Python-level write() calls for
    # these 10-80 MB artifacts. Serializing once and using one buffered write is
    # materially faster in the editor rebuild loop at an acceptable memory cost.
    content = (
        json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        if compact
        else json.dumps(data, ensure_ascii=False, indent=2)
    )
    path.write_text(f"{content}\n", encoding="utf-8")


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


def coordinate_bounds(features: list[dict[str, Any]]) -> tuple[float, float, float, float]:
    min_lng = math.inf
    min_lat = math.inf
    max_lng = -math.inf
    max_lat = -math.inf

    for feature in features:
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
        raise ValueError("Could not compute OSM coordinate bounds")
    return min_lng, min_lat, max_lng, max_lat


def make_projection(bounds: tuple[float, float, float, float]):
    _min_lng, min_lat, _max_lng, max_lat = bounds
    lat0 = math.radians((min_lat + max_lat) / 2)
    meters_per_deg_lat = 111_320.0
    meters_per_deg_lng = meters_per_deg_lat * math.cos(lat0)

    def project(coord: list[float]) -> tuple[float, float]:
        return float(coord[0]) * meters_per_deg_lng, float(coord[1]) * meters_per_deg_lat

    def unproject(point: tuple[float, float]) -> list[float]:
        return [
            round(point[0] / meters_per_deg_lng, 7),
            round(point[1] / meters_per_deg_lat, 7),
        ]

    return project, unproject


def coord_key(coord: list[float], precision: int = 7) -> tuple[int, int]:
    scale = 10**precision
    return round(float(coord[0]) * scale), round(float(coord[1]) * scale)


def stable_node_id(coord: list[float]) -> str:
    lng_key, lat_key = coord_key(coord)
    digest = hashlib.sha256(f"{lng_key},{lat_key}".encode("ascii")).hexdigest()
    return f"n{digest[:16]}"


def parse_jsonish(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def best_source(sources: set[str]) -> str:
    if not sources:
        return "osm_vertex"
    return max(sources, key=lambda source: SOURCE_PRIORITY.get(source, -1))


def clean_properties(properties: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in properties.items()
        if key not in {"osmColor", "osmWidth", "osmOpacity", "distanceMeters"}
    }


class NodeIndex:
    def __init__(self, project, tolerance_m: float):
        self.project = project
        self.tolerance_m = tolerance_m
        self.cell_size_m = tolerance_m
        self.nodes: list[dict[str, Any]] = []
        self.node_ids: set[str] = set()
        self.grid: dict[tuple[int, int], list[int]] = defaultdict(list)

    def _cell(self, point_m: tuple[float, float]) -> tuple[int, int]:
        return (
            math.floor(point_m[0] / self.cell_size_m),
            math.floor(point_m[1] / self.cell_size_m),
        )

    def _nearby_indices(self, point_m: tuple[float, float]) -> list[int]:
        cell_x, cell_y = self._cell(point_m)
        indices: list[int] = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                indices.extend(self.grid.get((cell_x + dx, cell_y + dy), []))
        return indices

    def get_or_create(
        self,
        coord: list[float],
        source: str,
        way_id: int,
    ) -> str:
        point_m = self.project(coord)
        best_index = None
        best_distance = math.inf
        for index in self._nearby_indices(point_m):
            node = self.nodes[index]
            distance = math.hypot(point_m[0] - node["_x"], point_m[1] - node["_y"])
            if distance <= self.tolerance_m and distance < best_distance:
                best_index = index
                best_distance = distance

        if best_index is not None:
            node = self.nodes[best_index]
            node["sources"].add(source)
            node["source"] = best_source(node["sources"])
            if len(node["wayIds"]) < MAX_NODE_WAY_IDS:
                node["wayIds"].add(way_id)
            return node["id"]

        node_id = stable_node_id(coord)
        if node_id in self.node_ids:
            suffix = 2
            while f"{node_id}_{suffix}" in self.node_ids:
                suffix += 1
            node_id = f"{node_id}_{suffix}"
        node = {
            "id": node_id,
            "coord": [round(float(coord[0]), 7), round(float(coord[1]), 7)],
            "source": source,
            "sources": {source},
            "wayIds": {way_id},
            "degree": 0,
            "_x": point_m[0],
            "_y": point_m[1],
        }
        self.nodes.append(node)
        self.node_ids.add(node_id)
        self.grid[self._cell(point_m)].append(len(self.nodes) - 1)
        return node_id

    def public_nodes(self) -> list[dict[str, Any]]:
        nodes = []
        for node in self.nodes:
            nodes.append(
                {
                    "id": node["id"],
                    "coord": node["coord"],
                    "source": node["source"],
                    "sources": sorted(node["sources"]),
                    "wayIds": sorted(node["wayIds"]),
                    "degree": node["degree"],
                }
            )
        return nodes


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


def project_onto_way(
    coord: list[float],
    coords: list[list[float]],
    projected_coords: list[tuple[float, float]],
    cumulative: list[float],
    project,
    unproject,
) -> dict[str, Any] | None:
    if len(coords) < 2:
        return None

    point_m = project(coord)
    best = None
    for index in range(len(projected_coords) - 1):
        start = projected_coords[index]
        end = projected_coords[index + 1]
        projected, t = segment_projection(point_m, start, end)
        distance_to_line = math.hypot(point_m[0] - projected[0], point_m[1] - projected[1])
        segment_length = math.hypot(end[0] - start[0], end[1] - start[1])
        distance_along = cumulative[index] + segment_length * t
        if best is None or distance_to_line < best["distanceToLineMeters"]:
            best = {
                "coord": unproject(projected),
                "pointM": projected,
                "segmentIndex": index,
                "distanceAlongMeters": distance_along,
                "distanceToLineMeters": distance_to_line,
            }
    return best


def cumulative_lengths(projected_coords: list[tuple[float, float]]) -> list[float]:
    cumulative = [0.0]
    for index in range(1, len(projected_coords)):
        previous = projected_coords[index - 1]
        current = projected_coords[index]
        cumulative.append(
            cumulative[-1]
            + math.hypot(current[0] - previous[0], current[1] - previous[1])
        )
    return cumulative


def normalize_way_ids(value: Any) -> list[int]:
    parsed = parse_jsonish(value, [])
    if not isinstance(parsed, list):
        return []
    way_ids = []
    for item in parsed:
        try:
            way_ids.append(int(item))
        except (TypeError, ValueError):
            continue
    return way_ids


def collect_split_candidates(
    raw_geojson: dict[str, Any],
    intersections_geojson: dict[str, Any],
) -> dict[int, list[dict[str, Any]]]:
    split_candidates: dict[int, list[dict[str, Any]]] = defaultdict(list)
    vertex_ways: dict[tuple[int, int], set[int]] = defaultdict(set)
    vertex_coords: dict[tuple[int, int], list[float]] = {}

    for feature in raw_geojson.get("features", []):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "LineString":
            continue
        coords = geometry.get("coordinates") or []
        if len(coords) < 2:
            continue
        way_id = int(feature.get("properties", {}).get("osmId") or 0)
        if not way_id:
            continue

        split_candidates[way_id].append({"coord": coords[0], "source": "osm_endpoint"})
        split_candidates[way_id].append({"coord": coords[-1], "source": "osm_endpoint"})
        for coord in coords:
            key = coord_key(coord)
            vertex_ways[key].add(way_id)
            vertex_coords.setdefault(key, coord)

    for key, way_ids in vertex_ways.items():
        if len(way_ids) < 2:
            continue
        coord = vertex_coords[key]
        for way_id in way_ids:
            split_candidates[way_id].append({"coord": coord, "source": "osm_vertex"})

    for feature in intersections_geojson.get("features", []):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "Point":
            continue
        coord = geometry.get("coordinates")
        if not coord or len(coord) < 2:
            continue
        properties = feature.get("properties") or {}
        kind = properties.get("kind")
        source = "calculated_crossing" if kind == "crossing" else "osm_intersection"
        for way_id in normalize_way_ids(properties.get("wayIds")):
            split_candidates[way_id].append({"coord": coord, "source": source})

    return split_candidates


def merge_way_splits(
    candidates: list[dict[str, Any]],
    coords: list[list[float]],
    project,
    unproject,
    *,
    split_tolerance_m: float,
) -> list[dict[str, Any]]:
    projected_coords = [project(coord) for coord in coords]
    cumulative = cumulative_lengths(projected_coords)
    projected_candidates = []

    for candidate in candidates:
        projected = project_onto_way(
            candidate["coord"],
            coords,
            projected_coords,
            cumulative,
            project,
            unproject,
        )
        if not projected:
            continue
        if projected["distanceToLineMeters"] > split_tolerance_m:
            continue
        projected["sources"] = {candidate["source"]}
        projected_candidates.append(projected)

    if not projected_candidates:
        return []

    projected_candidates.sort(key=lambda candidate: candidate["distanceAlongMeters"])
    merged: list[dict[str, Any]] = []
    for candidate in projected_candidates:
        if not merged:
            merged.append(candidate)
            continue
        previous = merged[-1]
        distance_between = math.hypot(
            candidate["pointM"][0] - previous["pointM"][0],
            candidate["pointM"][1] - previous["pointM"][1],
        )
        if (
            abs(candidate["distanceAlongMeters"] - previous["distanceAlongMeters"])
            <= split_tolerance_m
            or distance_between <= split_tolerance_m
        ):
            previous["sources"].update(candidate["sources"])
            if SOURCE_PRIORITY.get(best_source(candidate["sources"]), -1) > SOURCE_PRIORITY.get(
                best_source(previous["sources"] - candidate["sources"]), -1
            ):
                previous["coord"] = candidate["coord"]
                previous["pointM"] = candidate["pointM"]
                previous["segmentIndex"] = candidate["segmentIndex"]
                previous["distanceAlongMeters"] = candidate["distanceAlongMeters"]
            previous["source"] = best_source(previous["sources"])
        else:
            candidate["source"] = best_source(candidate["sources"])
            merged.append(candidate)

    for candidate in merged:
        candidate["source"] = best_source(candidate["sources"])
    return merged


def append_coord(output: list[list[float]], coord: list[float]) -> None:
    normalized = [round(float(coord[0]), 7), round(float(coord[1]), 7)]
    if output and haversine_m(output[-1], normalized) < 0.01:
        return
    output.append(normalized)


def slice_way_geometry(
    coords: list[list[float]],
    start_split: dict[str, Any],
    end_split: dict[str, Any],
) -> list[list[float]]:
    if start_split["distanceAlongMeters"] > end_split["distanceAlongMeters"]:
        return list(
            reversed(
                slice_way_geometry(
                    coords,
                    end_split,
                    start_split,
                )
            )
        )

    sliced: list[list[float]] = []
    append_coord(sliced, start_split["coord"])
    for index in range(start_split["segmentIndex"] + 1, end_split["segmentIndex"] + 1):
        append_coord(sliced, coords[index])
    append_coord(sliced, end_split["coord"])
    return sliced


def is_closed_way(coords: list[list[float]]) -> bool:
    return len(coords) >= 3 and coord_key(coords[0]) == coord_key(coords[-1])


def slice_closed_way_wrap_geometry(
    coords: list[list[float]],
    start_split: dict[str, Any],
    end_split: dict[str, Any],
) -> list[list[float]]:
    """Slice forward across a closed way's stored end/start boundary."""

    sliced: list[list[float]] = []
    append_coord(sliced, start_split["coord"])
    for index in range(start_split["segmentIndex"] + 1, len(coords)):
        append_coord(sliced, coords[index])
    # Skip coords[0]: a valid closed LineString repeats it at coords[-1].
    for index in range(1, end_split["segmentIndex"] + 1):
        append_coord(sliced, coords[index])
    append_coord(sliced, end_split["coord"])
    return sliced


def closed_way_midpoint_split(coords: list[list[float]], project, unproject) -> dict[str, Any] | None:
    """Create a deterministic second node for a ring with only one attachment."""

    projected_coords = [project(coord) for coord in coords]
    cumulative = cumulative_lengths(projected_coords)
    if not cumulative or cumulative[-1] <= 0:
        return None
    target_distance = cumulative[-1] / 2
    for segment_index in range(len(projected_coords) - 1):
        segment_start_distance = cumulative[segment_index]
        segment_end_distance = cumulative[segment_index + 1]
        segment_length = segment_end_distance - segment_start_distance
        if segment_length <= 0 or target_distance > segment_end_distance:
            continue
        t = (target_distance - segment_start_distance) / segment_length
        start = projected_coords[segment_index]
        end = projected_coords[segment_index + 1]
        point_m = (
            start[0] + (end[0] - start[0]) * t,
            start[1] + (end[1] - start[1]) * t,
        )
        return {
            "coord": unproject(point_m),
            "pointM": point_m,
            "segmentIndex": segment_index,
            "distanceAlongMeters": target_distance,
            "distanceToLineMeters": 0.0,
            "sources": {"osm_ring_split"},
            "source": "osm_ring_split",
        }
    return None


def edge_properties(
    edge_id: str,
    way_id: int,
    slice_index: int,
    raw_properties: dict[str, Any],
    from_node_id: str,
    to_node_id: str,
    distance_m: float,
) -> dict[str, Any]:
    return {
        **clean_properties(raw_properties),
        "id": edge_id,
        "edgeId": edge_id,
        "source": "osm",
        "osmWayId": way_id,
        "sliceIndex": slice_index,
        "fromNodeId": from_node_id,
        "toNodeId": to_node_id,
        "distanceMeters": round(distance_m, 1),
        "graphColor": "#2563eb",
        "graphWidth": 1.4,
        "graphOpacity": 0.72,
    }


def manual_edge_properties(
    edge_id: str,
    manual_edge_id: str,
    raw_properties: dict[str, Any],
    from_node_id: str,
    to_node_id: str,
    distance_m: float,
) -> dict[str, Any]:
    road_type = raw_properties.get("roadType") or "dirt"
    route_class = raw_properties.get("osmRouteClass") or (
        "road" if road_type == "road" else "manual"
    )
    return {
        **clean_properties(raw_properties),
        "id": edge_id,
        "edgeId": edge_id,
        "source": "manual",
        "manualEdgeId": manual_edge_id,
        "highway": raw_properties.get("highway") or "manual",
        "osmRouteClass": route_class,
        "accessStatus": raw_properties.get("accessStatus") or "manual",
        "fromNodeId": from_node_id,
        "toNodeId": to_node_id,
        "distanceMeters": round(distance_m, 1),
        "graphColor": "#2563eb",
        "graphWidth": 1.4,
        "graphOpacity": 0.72,
    }


def build_graph(
    raw_geojson: dict[str, Any],
    intersections_geojson: dict[str, Any],
    manual_edges_geojson: dict[str, Any] | None,
    traversal_overrides: dict[str, Any] | None = None,
    *,
    node_merge_tolerance_m: float,
    split_tolerance_m: float,
    min_edge_length_m: float,
    performance: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    phase_started_at = perf_counter()
    features = [
        feature
        for feature in raw_geojson.get("features", [])
        if (feature.get("geometry") or {}).get("type") == "LineString"
    ]
    manual_features = [
        feature
        for feature in (manual_edges_geojson or {}).get("features", [])
        if (feature.get("geometry") or {}).get("type") == "LineString"
    ]
    override_records: dict[int, dict[str, Any]] = {}
    if traversal_overrides:
        if int(traversal_overrides.get("schemaVersion") or 0) != 1:
            raise ValueError("Bicycle traversal overrides require schemaVersion 1")
        if traversal_overrides.get("policyId") != POLICY_ID:
            raise ValueError(f"Bicycle traversal overrides require policyId {POLICY_ID}")
        for record in traversal_overrides.get("overrides") or []:
            way_id = int(record.get("osmWayId") or 0)
            if way_id <= 0:
                raise ValueError("Bicycle traversal override is missing a positive osmWayId")
            if way_id in override_records:
                raise ValueError(f"Duplicate bicycle traversal override for OSM way {way_id}")
            override_records[way_id] = record
    overridden_edge_ids = {
        str(properties.get("copiedFromEdgeId"))
        for feature in manual_features
        for properties in [feature.get("properties") or {}]
        if properties.get("copiedFromEdgeId")
    }
    bounds = coordinate_bounds([*features, *manual_features])
    project, unproject = make_projection(bounds)
    split_candidates = collect_split_candidates(raw_geojson, intersections_geojson)
    node_index = NodeIndex(project, node_merge_tolerance_m)
    edge_records: list[dict[str, Any]] = []
    edge_features: list[dict[str, Any]] = []
    edge_ids: set[str] = set()
    split_count_by_source: Counter[str] = Counter()
    skipped_short_edges = 0
    split_counts = []
    seen_override_way_ids: set[int] = set()
    record_performance_phase(performance, "graphSetup", phase_started_at)

    phase_started_at = perf_counter()
    for feature in sorted(features, key=lambda item: int(item.get("properties", {}).get("osmId") or 0)):
        properties = feature.get("properties") or {}
        way_id = int(properties.get("osmId") or 0)
        coords = feature.get("geometry", {}).get("coordinates") or []
        if not way_id or len(coords) < 2:
            continue
        source_geometry_digest_value = source_geometry_digest(coords)
        override = override_records.get(way_id)
        if override is not None:
            validate_override(override, source_geometry_digest_value)
            seen_override_way_ids.add(way_id)

        candidates = split_candidates.get(way_id, [])
        splits = merge_way_splits(
            candidates,
            coords,
            project,
            unproject,
            split_tolerance_m=split_tolerance_m,
        )
        if is_closed_way(coords) and len(splits) == 1:
            midpoint_split = closed_way_midpoint_split(coords, project, unproject)
            if midpoint_split is not None:
                distance_to_existing = math.hypot(
                    midpoint_split["pointM"][0] - splits[0]["pointM"][0],
                    midpoint_split["pointM"][1] - splits[0]["pointM"][1],
                )
                if distance_to_existing > split_tolerance_m:
                    splits.append(midpoint_split)
                    splits.sort(key=lambda split: split["distanceAlongMeters"])
        if len(splits) < 2:
            continue

        split_counts.append(len(splits))
        for split in splits:
            split_count_by_source[split["source"]] += 1

        way_slices = [
            (slice_index + 1, splits[slice_index], splits[slice_index + 1], False)
            for slice_index in range(len(splits) - 1)
        ]
        if is_closed_way(coords):
            way_slices.append((len(splits), splits[-1], splits[0], True))

        for slice_index, start_split, end_split, wraps_boundary in way_slices:
            geometry = (
                slice_closed_way_wrap_geometry(coords, start_split, end_split)
                if wraps_boundary
                else slice_way_geometry(coords, start_split, end_split)
            )
            if len(geometry) < 2:
                continue
            distance_m = line_length_m(geometry)
            if distance_m < min_edge_length_m:
                skipped_short_edges += 1
                continue

            edge_id = f"e{way_id}_{slice_index}"
            if edge_id in overridden_edge_ids:
                continue

            from_node_id = node_index.get_or_create(
                start_split["coord"],
                start_split["source"],
                way_id,
            )
            to_node_id = node_index.get_or_create(
                end_split["coord"],
                end_split["source"],
                way_id,
            )
            if from_node_id == to_node_id:
                skipped_short_edges += 1
                continue

            edge_ids.add(edge_id)
            public_properties = edge_properties(
                edge_id,
                way_id,
                slice_index,
                properties,
                from_node_id,
                to_node_id,
                distance_m,
            )
            edge_record = {
                "id": edge_id,
                "fromNodeId": from_node_id,
                "toNodeId": to_node_id,
                "source": "osm",
                "osmWayId": way_id,
                "sliceIndex": slice_index,
                "sourceGeometryDigest": source_geometry_digest_value,
                "distanceMeters": round(distance_m, 1),
                "coordinates": geometry,
                "tags": clean_properties(properties),
            }
            edge_record["bicycleTraversalShadow"] = normalize_bicycle_traversal(
                edge_record["tags"], source="osm", override=override
            )
            public_properties["sourceGeometryDigest"] = source_geometry_digest_value
            public_properties["bicycleTraversal"] = {
                key: edge_record["bicycleTraversalShadow"].get(key)
                for key in (
                    "policyId",
                    "policyDigest",
                    "forward",
                    "reverse",
                    "forwardReason",
                    "reverseReason",
                )
            }
            edge_records.append(edge_record)
            edge_features.append(
                {
                    "type": "Feature",
                    "id": edge_id,
                    "geometry": {
                        "type": "LineString",
                        "coordinates": geometry,
                    },
                    "properties": public_properties,
                }
            )

    missing_override_way_ids = sorted(set(override_records) - seen_override_way_ids)
    if missing_override_way_ids:
        raise ValueError(
            "Bicycle traversal overrides reference missing OSM ways: "
            + ", ".join(str(value) for value in missing_override_way_ids[:10])
        )
    record_performance_phase(performance, "osmEdgeBuild", phase_started_at)

    phase_started_at = perf_counter()
    for manual_index, feature in enumerate(manual_features):
        properties = feature.get("properties") or {}
        coords = [
            [round(float(coord[0]), 7), round(float(coord[1]), 7)]
            for coord in (feature.get("geometry", {}).get("coordinates") or [])
            if len(coord) >= 2
        ]
        if len(coords) < 2:
            continue
        distance_m = line_length_m(coords)
        if distance_m < min_edge_length_m:
            skipped_short_edges += 1
            continue

        manual_edge_id = str(properties.get("manualEdgeId") or properties.get("id") or feature.get("id") or f"manual-{manual_index + 1}")
        edge_id = manual_edge_id
        if edge_id in edge_ids:
            suffix = 2
            while f"{edge_id}-{suffix}" in edge_ids:
                suffix += 1
            edge_id = f"{edge_id}-{suffix}"
        edge_ids.add(edge_id)
        pseudo_way_id = -(manual_index + 1)
        from_node_id = node_index.get_or_create(coords[0], "manual", pseudo_way_id)
        to_node_id = node_index.get_or_create(coords[-1], "manual", pseudo_way_id)
        if from_node_id == to_node_id:
            skipped_short_edges += 1
            continue

        public_properties = manual_edge_properties(
            edge_id,
            manual_edge_id,
            properties,
            from_node_id,
            to_node_id,
            distance_m,
        )
        edge_record = {
            "id": edge_id,
            "fromNodeId": from_node_id,
            "toNodeId": to_node_id,
            "source": "manual",
            "manualEdgeId": manual_edge_id,
            "copiedFromEdgeId": properties.get("copiedFromEdgeId"),
            "copiedFromOsmWayId": properties.get("copiedFromOsmWayId"),
            "linkedSegmentId": properties.get("linkedSegmentId"),
            "linkedSegmentName": properties.get("linkedSegmentName"),
            "distanceMeters": round(distance_m, 1),
            "coordinates": coords,
            "tags": clean_properties(public_properties),
        }
        edge_record["bicycleTraversalShadow"] = normalize_bicycle_traversal(
            edge_record["tags"], source="manual", manual=properties
        )
        edge_records.append(edge_record)
        edge_features.append(
            {
                "type": "Feature",
                "id": edge_id,
                "geometry": {
                    "type": "LineString",
                    "coordinates": coords,
                },
                "properties": public_properties,
            }
        )
    record_performance_phase(performance, "manualEdgeBuild", phase_started_at)

    phase_started_at = perf_counter()
    node_by_id = {node["id"]: node for node in node_index.nodes}
    adjacency: dict[str, set[str]] = defaultdict(set)
    for edge in edge_records:
        from_node = node_by_id[edge["fromNodeId"]]
        to_node = node_by_id[edge["toNodeId"]]
        from_node["degree"] += 1
        to_node["degree"] += 1
        adjacency[edge["fromNodeId"]].add(edge["toNodeId"])
        adjacency[edge["toNodeId"]].add(edge["fromNodeId"])

    public_nodes = node_index.public_nodes()
    node_features = [
        {
            "type": "Feature",
            "id": node["id"],
            "geometry": {
                "type": "Point",
                "coordinates": node["coord"],
            },
            "properties": {
                "id": node["id"],
                "nodeId": node["id"],
                "source": node["source"],
                "sources": node["sources"],
                "wayIds": node["wayIds"],
                "degree": node["degree"],
            },
        }
        for node in public_nodes
    ]
    record_performance_phase(performance, "topologyFinalize", phase_started_at)

    generated_at = datetime.now(timezone.utc).isoformat()
    graph = {
        "metadata": {
            "generatedAt": generated_at,
            "source": "OSM base graph prototype",
            "nodeMergeToleranceMeters": node_merge_tolerance_m,
            "splitToleranceMeters": split_tolerance_m,
            "minEdgeLengthMeters": min_edge_length_m,
            "manualOverrideEdges": len(overridden_edge_ids),
            "reviewedTraversalOverrides": len(override_records),
            "bicycleTraversalShadowPolicyId": POLICY_ID,
            "bicycleTraversalShadowPolicyDigest": POLICY_DIGEST,
        },
        "nodes": public_nodes,
        "edges": edge_records,
    }
    edge_geojson = {
        "type": "FeatureCollection",
        "metadata": graph["metadata"],
        "features": edge_features,
    }
    node_geojson = {
        "type": "FeatureCollection",
        "metadata": graph["metadata"],
        "features": node_features,
    }
    phase_started_at = perf_counter()
    summary = graph_summary(
        raw_geojson,
        intersections_geojson,
        public_nodes,
        edge_records,
        adjacency,
        split_counts,
        split_count_by_source,
        skipped_short_edges,
        graph["metadata"],
    )
    record_performance_phase(performance, "summaryBuild", phase_started_at)
    if performance is not None:
        performance["counts"] = {
            "rawWays": len(features),
            "manualEdges": len(manual_features),
            "nodes": len(public_nodes),
            "edges": len(edge_records),
        }
    return graph, node_geojson, edge_geojson, summary


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    index = (len(sorted_values) - 1) * p
    lower = math.floor(index)
    upper = math.ceil(index)
    if lower == upper:
        return sorted_values[int(index)]
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * (
        index - lower
    )


def connected_components(nodes: list[dict[str, Any]], adjacency: dict[str, set[str]]) -> list[int]:
    node_ids = {node["id"] for node in nodes}
    visited: set[str] = set()
    component_sizes: list[int] = []

    for node_id in node_ids:
        if node_id in visited:
            continue
        visited.add(node_id)
        queue = deque([node_id])
        size = 0
        while queue:
            current = queue.popleft()
            size += 1
            for next_node in adjacency.get(current, set()):
                if next_node not in visited:
                    visited.add(next_node)
                    queue.append(next_node)
        component_sizes.append(size)

    component_sizes.sort(reverse=True)
    return component_sizes


def graph_summary(
    raw_geojson: dict[str, Any],
    intersections_geojson: dict[str, Any],
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    adjacency: dict[str, set[str]],
    split_counts: list[int],
    split_count_by_source: Counter[str],
    skipped_short_edges: int,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    lengths = [edge["distanceMeters"] for edge in edges]
    component_sizes = connected_components(nodes, adjacency)
    degree_counts = Counter(node["degree"] for node in nodes)
    source_counts = Counter(node["source"] for node in nodes)
    edge_source_counts = Counter(edge["source"] for edge in edges)

    return {
        "generatedAt": metadata["generatedAt"],
        "inputWays": len(raw_geojson.get("features", [])),
        "inputIntersections": len(intersections_geojson.get("features", [])),
        "nodes": len(nodes),
        "edges": len(edges),
        "totalKm": round(sum(lengths) / 1000, 1),
        "edgeLengthMeters": {
            "p50": round(percentile(lengths, 0.5), 1),
            "p95": round(percentile(lengths, 0.95), 1),
            "max": round(max(lengths) if lengths else 0, 1),
        },
        "splitPointsPerWay": {
            "p50": round(percentile(split_counts, 0.5), 1),
            "p95": round(percentile(split_counts, 0.95), 1),
            "max": max(split_counts) if split_counts else 0,
        },
        "nodeSources": dict(source_counts.most_common()),
        "edgeSources": dict(edge_source_counts.most_common()),
        "splitSources": dict(split_count_by_source.most_common()),
        "degreeCounts": dict(sorted(degree_counts.items())),
        "components": len(component_sizes),
        "largestComponents": component_sizes[:10],
        "skippedShortEdges": skipped_short_edges,
        "nodeMergeToleranceMeters": metadata["nodeMergeToleranceMeters"],
        "splitToleranceMeters": metadata["splitToleranceMeters"],
        "minEdgeLengthMeters": metadata["minEdgeLengthMeters"],
        "manualOverrideEdges": metadata.get("manualOverrideEdges", 0),
        "reviewedTraversalOverrides": metadata.get("reviewedTraversalOverrides", 0),
    }


def main() -> int:
    measured_started_at = perf_counter()
    performance: dict[str, Any] = {"schemaVersion": 1, "phasesMs": {}}
    phase_started_at = perf_counter()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-geojson",
        type=Path,
        default=Path("build/osm/osm-raw-ways.geojson"),
        help="Raw OSM ways GeoJSON.",
    )
    parser.add_argument(
        "--intersections-geojson",
        type=Path,
        default=Path("build/osm/osm-intersections.geojson"),
        help="Detected OSM intersections GeoJSON.",
    )
    parser.add_argument(
        "--manual-edges-geojson",
        type=Path,
        default=Path("data/manual-base-edges.geojson"),
        help="Manually drawn base edges GeoJSON.",
    )
    parser.add_argument(
        "--bicycle-traversal-overrides",
        type=Path,
        default=Path("data/bicycle-traversal-overrides.json"),
        help="Reviewed OSM-way traversal overrides.",
    )
    parser.add_argument(
        "--output-graph",
        type=Path,
        default=Path("build/osm/osm-base-graph.json"),
        help="Output graph JSON.",
    )
    parser.add_argument(
        "--output-nodes",
        type=Path,
        default=Path("build/osm/osm-base-nodes.geojson"),
        help="Output graph nodes GeoJSON.",
    )
    parser.add_argument(
        "--output-edges",
        type=Path,
        default=Path("build/osm/osm-base-edges.geojson"),
        help="Output graph edges GeoJSON.",
    )
    parser.add_argument(
        "--summary",
        type=Path,
        default=Path("build/osm/osm-base-graph-summary.json"),
        help="Output graph summary JSON.",
    )
    parser.add_argument(
        "--node-merge-tolerance-m",
        type=float,
        default=DEFAULT_NODE_MERGE_TOLERANCE_M,
    )
    parser.add_argument(
        "--split-tolerance-m",
        type=float,
        default=DEFAULT_SPLIT_TOLERANCE_M,
    )
    parser.add_argument(
        "--min-edge-length-m",
        type=float,
        default=DEFAULT_MIN_EDGE_LENGTH_M,
    )
    args = parser.parse_args()
    record_performance_phase(performance, "argumentParse", phase_started_at)

    phase_started_at = perf_counter()
    raw_geojson, raw_input = load_json_snapshot(
        args.input_geojson,
        {"type": "FeatureCollection", "features": []},
    )
    record_performance_phase(performance, "rawOsmReadParse", phase_started_at)

    phase_started_at = perf_counter()
    intersections_geojson, intersections_input = load_json_snapshot(
        args.intersections_geojson,
        {"type": "FeatureCollection", "features": []},
    )
    record_performance_phase(performance, "intersectionsReadParse", phase_started_at)

    phase_started_at = perf_counter()
    manual_edges_geojson, manual_input = load_json_snapshot(
        args.manual_edges_geojson,
        {"type": "FeatureCollection", "features": []},
    )
    record_performance_phase(performance, "manualEdgesReadParse", phase_started_at)

    phase_started_at = perf_counter()
    traversal_overrides, overrides_input = load_json_snapshot(
        args.bicycle_traversal_overrides,
        {"schemaVersion": 1, "policyId": POLICY_ID, "overrides": []},
    )
    record_performance_phase(performance, "traversalOverridesReadParse", phase_started_at)

    build_inputs = {
        "schemaVersion": 1,
        "files": {
            "rawOsmWays": raw_input,
            "osmIntersections": intersections_input,
            "manualBaseEdges": manual_input,
            "bicycleTraversalOverrides": overrides_input,
        },
        "settings": {
            "nodeMergeToleranceMeters": args.node_merge_tolerance_m,
            "splitToleranceMeters": args.split_tolerance_m,
            "minEdgeLengthMeters": args.min_edge_length_m,
        },
    }

    phase_started_at = perf_counter()
    graph, nodes, edges, summary = build_graph(
        raw_geojson,
        intersections_geojson,
        manual_edges_geojson,
        traversal_overrides,
        node_merge_tolerance_m=args.node_merge_tolerance_m,
        split_tolerance_m=args.split_tolerance_m,
        min_edge_length_m=args.min_edge_length_m,
        performance=performance,
    )
    record_performance_phase(performance, "buildGraph", phase_started_at)

    for artifact in (graph, nodes, edges):
        artifact.setdefault("metadata", {})["buildInputs"] = build_inputs
    summary["buildInputs"] = build_inputs
    summary["performance"] = performance

    phase_started_at = perf_counter()
    write_json(args.output_graph, graph, compact=True)
    record_performance_phase(performance, "graphOutputWrite", phase_started_at)

    phase_started_at = perf_counter()
    write_json(args.output_nodes, nodes, compact=True)
    record_performance_phase(performance, "nodesOutputWrite", phase_started_at)

    phase_started_at = perf_counter()
    write_json(args.output_edges, edges, compact=True)
    record_performance_phase(performance, "edgesOutputWrite", phase_started_at)
    performance["measuredThroughPrimaryOutputsMs"] = round(
        (perf_counter() - measured_started_at) * 1000,
        3,
    )

    phase_started_at = perf_counter()
    write_json(args.summary, summary)
    record_performance_phase(performance, "summaryOutputWrite", phase_started_at)
    performance["totalMs"] = round((perf_counter() - measured_started_at) * 1000, 3)
    print(
        f"Wrote OSM base graph with {summary['nodes']} nodes and "
        f"{summary['edges']} edges to {args.output_graph}"
    )
    print("BASE_GRAPH_PERFORMANCE " + json.dumps(performance, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
