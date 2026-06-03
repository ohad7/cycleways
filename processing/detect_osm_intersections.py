#!/usr/bin/env python3
"""Detect naive geometric intersections in the raw OSM debug network.

This is an exploration aid, not a routing graph builder. It treats the raw OSM
ways as linework, detects shared vertices and simple segment crossings between
different ways, and writes red-dot-ready GeoJSON.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_GRID_CELL_METERS = 75.0
EPSILON = 1e-9


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


def coordinate_bounds(features: list[dict[str, Any]]) -> tuple[float, float, float, float]:
    min_lng = math.inf
    min_lat = math.inf
    max_lng = -math.inf
    max_lat = -math.inf

    for feature in features:
        if feature.get("geometry", {}).get("type") != "LineString":
            continue
        for coord in feature.get("geometry", {}).get("coordinates", []):
            if len(coord) < 2:
                continue
            lng = float(coord[0])
            lat = float(coord[1])
            min_lng = min(min_lng, lng)
            min_lat = min(min_lat, lat)
            max_lng = max(max_lng, lng)
            max_lat = max(max_lat, lat)

    if not all(math.isfinite(value) for value in (min_lng, min_lat, max_lng, max_lat)):
        raise ValueError("Could not compute bounds for OSM ways")
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


def cross(a: tuple[float, float], b: tuple[float, float]) -> float:
    return a[0] * b[1] - a[1] * b[0]


def subtract(a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float]:
    return a[0] - b[0], a[1] - b[1]


def points_close(a: tuple[float, float], b: tuple[float, float], tolerance_m: float) -> bool:
    return abs(a[0] - b[0]) <= tolerance_m and abs(a[1] - b[1]) <= tolerance_m


def endpoint_touch(
    a: dict[str, Any],
    b: dict[str, Any],
    tolerance_m: float,
) -> tuple[tuple[float, float], str] | None:
    endpoints_a = [(a["p1"], "a_start"), (a["p2"], "a_end")]
    endpoints_b = [(b["p1"], "b_start"), (b["p2"], "b_end")]
    for point_a, _label_a in endpoints_a:
        for point_b, _label_b in endpoints_b:
            if points_close(point_a, point_b, tolerance_m):
                return (
                    ((point_a[0] + point_b[0]) / 2, (point_a[1] + point_b[1]) / 2),
                    "shared_vertex",
                )
    return None


def segment_intersection(
    a: dict[str, Any],
    b: dict[str, Any],
    tolerance_m: float,
) -> tuple[tuple[float, float], str] | None:
    touch = endpoint_touch(a, b, tolerance_m)
    if touch:
        return touch

    p = a["p1"]
    r = subtract(a["p2"], a["p1"])
    q = b["p1"]
    s = subtract(b["p2"], b["p1"])
    rxs = cross(r, s)
    qmp = subtract(q, p)

    # Skip colinear overlaps for now. They are useful later, but make the first
    # visual debug layer noisy because duplicate or parallel OSM ways produce
    # long overlap ranges rather than one actionable junction point.
    if abs(rxs) < EPSILON:
      return None

    t = cross(qmp, s) / rxs
    u = cross(qmp, r) / rxs
    if -EPSILON <= t <= 1 + EPSILON and -EPSILON <= u <= 1 + EPSILON:
        point = (p[0] + t * r[0], p[1] + t * r[1])
        near_endpoint = (
            min(abs(t), abs(t - 1), abs(u), abs(u - 1)) <= 1e-7
        )
        return point, "touch" if near_endpoint else "crossing"

    return None


def cell_range(min_value: float, max_value: float, cell_size: float) -> range:
    return range(
        math.floor(min_value / cell_size),
        math.floor(max_value / cell_size) + 1,
    )


def add_intersection(
    intersections: dict[tuple[int, int], dict[str, Any]],
    point_lng_lat: list[float],
    kind: str,
    way_id_a: int,
    way_id_b: int,
    max_way_ids: int,
) -> None:
    key = (round(point_lng_lat[0] * 1e7), round(point_lng_lat[1] * 1e7))
    entry = intersections.setdefault(
        key,
        {
            "coordinate": point_lng_lat,
            "kinds": Counter(),
            "wayIds": set(),
            "pairCount": 0,
        },
    )
    entry["kinds"][kind] += 1
    entry["pairCount"] += 1
    if len(entry["wayIds"]) < max_way_ids:
        entry["wayIds"].add(way_id_a)
        entry["wayIds"].add(way_id_b)


def detect_intersections(
    geojson_data: dict[str, Any],
    *,
    cell_size_m: float,
    tolerance_m: float,
    max_way_ids: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    features = [
        feature
        for feature in geojson_data.get("features", [])
        if feature.get("geometry", {}).get("type") == "LineString"
    ]
    bounds = coordinate_bounds(features)
    project, unproject = make_projection(bounds)
    segments: list[dict[str, Any]] = []
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)

    for way_index, feature in enumerate(features):
        way_id = int(feature.get("properties", {}).get("osmId") or way_index)
        coordinates = feature.get("geometry", {}).get("coordinates", [])
        for segment_index in range(len(coordinates) - 1):
            p1_lng_lat = coordinates[segment_index]
            p2_lng_lat = coordinates[segment_index + 1]
            p1 = project(p1_lng_lat)
            p2 = project(p2_lng_lat)
            if points_close(p1, p2, 0.001):
                continue

            segment = {
                "wayId": way_id,
                "wayIndex": way_index,
                "segmentIndex": segment_index,
                "p1": p1,
                "p2": p2,
                "minX": min(p1[0], p2[0]),
                "minY": min(p1[1], p2[1]),
                "maxX": max(p1[0], p2[0]),
                "maxY": max(p1[1], p2[1]),
            }
            segment_id = len(segments)
            segments.append(segment)
            for cell_x in cell_range(segment["minX"], segment["maxX"], cell_size_m):
                for cell_y in cell_range(segment["minY"], segment["maxY"], cell_size_m):
                    grid[(cell_x, cell_y)].append(segment_id)

    intersections: dict[tuple[int, int], dict[str, Any]] = {}
    seen_pairs: set[tuple[int, int]] = set()

    for cell_segments in grid.values():
        if len(cell_segments) < 2:
            continue
        for i, segment_id_a in enumerate(cell_segments[:-1]):
            segment_a = segments[segment_id_a]
            for segment_id_b in cell_segments[i + 1 :]:
                if segment_id_a > segment_id_b:
                    pair = (segment_id_b, segment_id_a)
                else:
                    pair = (segment_id_a, segment_id_b)
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)

                segment_b = segments[segment_id_b]
                if segment_a["wayId"] == segment_b["wayId"]:
                    continue
                if (
                    segment_a["maxX"] + tolerance_m < segment_b["minX"]
                    or segment_b["maxX"] + tolerance_m < segment_a["minX"]
                    or segment_a["maxY"] + tolerance_m < segment_b["minY"]
                    or segment_b["maxY"] + tolerance_m < segment_a["minY"]
                ):
                    continue

                result = segment_intersection(segment_a, segment_b, tolerance_m)
                if not result:
                    continue

                point_m, kind = result
                point_lng_lat = unproject(point_m)
                add_intersection(
                    intersections,
                    point_lng_lat,
                    kind,
                    segment_a["wayId"],
                    segment_b["wayId"],
                    max_way_ids,
                )

    output_features = []
    kind_counts: Counter[str] = Counter()
    for index, entry in enumerate(intersections.values(), start=1):
        dominant_kind = entry["kinds"].most_common(1)[0][0]
        kind_counts.update(entry["kinds"])
        way_ids = sorted(entry["wayIds"])
        output_features.append(
            {
                "type": "Feature",
                "id": f"osm-intersection-{index}",
                "geometry": {
                    "type": "Point",
                    "coordinates": entry["coordinate"],
                },
                "properties": {
                    "intersectionId": index,
                    "kind": dominant_kind,
                    "kinds": dict(entry["kinds"]),
                    "wayIds": way_ids,
                    "wayCount": len(way_ids),
                    "pairCount": entry["pairCount"],
                },
            }
        )

    output_features.sort(
        key=lambda feature: (
            feature["geometry"]["coordinates"][1],
            feature["geometry"]["coordinates"][0],
        )
    )
    generated_at = datetime.now(timezone.utc).isoformat()
    feature_collection = {
        "type": "FeatureCollection",
        "metadata": {
            "generatedAt": generated_at,
            "source": "Naive geometric intersection detection over raw OSM ways",
            "cellSizeMeters": cell_size_m,
            "toleranceMeters": tolerance_m,
            "note": "Exploration only. Shared vertices and simple crossings are included; colinear overlaps are skipped.",
        },
        "features": output_features,
    }
    summary = {
        "generatedAt": generated_at,
        "inputWays": len(features),
        "inputLineSegments": len(segments),
        "candidatePairsChecked": len(seen_pairs),
        "intersections": len(output_features),
        "kindCounts": dict(kind_counts.most_common()),
        "cellSizeMeters": cell_size_m,
        "toleranceMeters": tolerance_m,
    }
    return feature_collection, summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-geojson",
        type=Path,
        default=Path("build/osm/osm-raw-ways.geojson"),
        help="Raw OSM ways GeoJSON.",
    )
    parser.add_argument(
        "--output-geojson",
        type=Path,
        default=Path("build/osm/osm-intersections.geojson"),
        help="Output GeoJSON of detected intersection points.",
    )
    parser.add_argument(
        "--summary",
        type=Path,
        default=Path("build/osm/osm-intersections-summary.json"),
        help="Output summary JSON.",
    )
    parser.add_argument(
        "--cell-size-m",
        type=float,
        default=DEFAULT_GRID_CELL_METERS,
        help="Spatial grid cell size in meters.",
    )
    parser.add_argument(
        "--tolerance-m",
        type=float,
        default=0.15,
        help="Endpoint touch tolerance in meters.",
    )
    parser.add_argument(
        "--max-way-ids",
        type=int,
        default=12,
        help="Maximum way ids stored on each intersection point.",
    )
    args = parser.parse_args()

    geojson_data = load_json(args.input_geojson)
    intersections, summary = detect_intersections(
        geojson_data,
        cell_size_m=args.cell_size_m,
        tolerance_m=args.tolerance_m,
        max_way_ids=args.max_way_ids,
    )
    write_json(args.output_geojson, intersections, compact=True)
    write_json(args.summary, summary)
    print(
        f"Wrote {summary['intersections']} intersections from "
        f"{summary['inputLineSegments']} line segments to {args.output_geojson}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
