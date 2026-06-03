#!/usr/bin/env python3
"""Fetch an OSM base road/path network for visual exploration.

This script intentionally stops before graph segmentation. It downloads OSM
ways in the current CycleWays coverage area, keeps their original way geometry
and tags, and writes debug GeoJSON plus a compact summary.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter"
DEFAULT_HIGHWAY_PATTERN = (
    "^(cycleway|path|track|service|residential|living_street|unclassified|"
    "tertiary|secondary|primary|trunk|motorway|tertiary_link|secondary_link|"
    "primary_link|trunk_link|motorway_link|road|pedestrian|footway|bridleway)$"
)
DEFAULT_BUFFER_DEG = 0.02
DEFAULT_TARGET_GEOJSON = Path("data/osm-target-area.geojson")
USER_AGENT = "CycleWays OSM exploration (https://www.cycleways.app/)"


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


def haversine_m(lng_lat_a: list[float], lng_lat_b: list[float]) -> float:
    radius_m = 6_371_000
    lng1, lat1 = lng_lat_a[:2]
    lng2, lat2 = lng_lat_b[:2]
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return radius_m * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def line_length_m(coordinates: list[list[float]]) -> float:
    return sum(
        haversine_m(coordinates[index - 1], coordinates[index])
        for index in range(1, len(coordinates))
    )


def source_geojson_bbox(source_geojson: dict[str, Any]) -> tuple[float, float, float, float]:
    min_lng = math.inf
    min_lat = math.inf
    max_lng = -math.inf
    max_lat = -math.inf

    for feature in source_geojson.get("features", []):
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
        raise ValueError("Could not compute a bounding box from source GeoJSON")

    return min_lng, min_lat, max_lng, max_lat


def load_target_polygon(path: Path) -> list[list[float]]:
    data = load_json(path)
    geometry = data.get("geometry") if isinstance(data, dict) else None

    if not geometry and data.get("type") == "FeatureCollection":
        for feature in data.get("features", []):
            candidate = feature.get("geometry") or {}
            if candidate.get("type") == "Polygon":
                geometry = candidate
                break

    if not geometry or geometry.get("type") != "Polygon":
        raise ValueError(f"{path} must contain a GeoJSON Polygon")

    rings = geometry.get("coordinates") or []
    if not rings or len(rings[0]) < 4:
        raise ValueError(f"{path} polygon must have at least four coordinates")

    ring = []
    for coord in rings[0]:
        if len(coord) < 2:
            continue
        ring.append([float(coord[0]), float(coord[1])])

    if ring[0] != ring[-1]:
        ring.append(ring[0])

    return ring


def polygon_bbox(ring: list[list[float]]) -> tuple[float, float, float, float]:
    lngs = [coord[0] for coord in ring]
    lats = [coord[1] for coord in ring]
    return min(lngs), min(lats), max(lngs), max(lats)


def overpass_poly_string(ring: list[list[float]]) -> str:
    # Overpass polygon filters use "lat lon" coordinate order.
    return " ".join(f"{lat:.7f} {lng:.7f}" for lng, lat in ring)


def parse_bbox(value: str) -> tuple[float, float, float, float]:
    parts = [float(part.strip()) for part in value.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("bbox must be west,south,east,north")
    west, south, east, north = parts
    if west >= east or south >= north:
        raise argparse.ArgumentTypeError("bbox must satisfy west < east and south < north")
    return west, south, east, north


def buffered_bbox(
    bbox: tuple[float, float, float, float],
    buffer_deg: float,
) -> tuple[float, float, float, float]:
    west, south, east, north = bbox
    return (
        west - buffer_deg,
        south - buffer_deg,
        east + buffer_deg,
        north + buffer_deg,
    )


def build_overpass_query(
    target: dict[str, Any],
    highway_pattern: str,
    timeout_seconds: int,
) -> str:
    west, south, east, north = target["bbox"]
    if target["type"] == "polygon":
        selector = f'(poly:"{overpass_poly_string(target["ring"])}")'
    else:
        selector = f"({south:.7f},{west:.7f},{north:.7f},{east:.7f})"

    return f"""[out:json][timeout:{timeout_seconds}];
(
  way["highway"~"{highway_pattern}"]{selector};
);
out body geom({south:.7f},{west:.7f},{north:.7f},{east:.7f});
"""


def fetch_overpass_json(endpoint: str, query: str) -> dict[str, Any]:
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=240) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return json.loads(response.read().decode(charset))


def access_status(tags: dict[str, Any]) -> str:
    bicycle = str(tags.get("bicycle", "")).lower()
    access = str(tags.get("access", "")).lower()
    vehicle = str(tags.get("vehicle", "")).lower()

    if bicycle in {"yes", "designated", "official", "permissive"}:
        return "bike_allowed"
    if bicycle in {"no", "private", "use_sidepath"}:
        return "restricted"
    if access in {"no", "private"} or vehicle in {"no", "private"}:
        return "restricted"
    if access in {"destination", "customers", "delivery", "permissive"}:
        return "conditional"
    return "unspecified"


def route_class(tags: dict[str, Any]) -> str:
    highway = str(tags.get("highway", "")).lower()
    bicycle = str(tags.get("bicycle", "")).lower()

    if highway == "cycleway" or bicycle in {"designated", "official"}:
        return "cycle"
    if highway in {"track", "path", "bridleway", "footway", "pedestrian"}:
        return "path_track"
    if highway in {"residential", "living_street", "service", "unclassified"}:
        return "local_road"
    if highway in {
        "motorway",
        "motorway_link",
        "trunk",
        "trunk_link",
        "primary",
        "primary_link",
        "secondary",
        "secondary_link",
        "tertiary",
        "tertiary_link",
        "road",
    }:
        return "road"
    return "other"


def style_for_class(osm_class: str, status: str) -> dict[str, Any]:
    styles = {
        "cycle": {"osmColor": "#00a88f", "osmWidth": 3.4, "osmOpacity": 0.9},
        "path_track": {"osmColor": "#8f6a20", "osmWidth": 2.7, "osmOpacity": 0.72},
        "local_road": {"osmColor": "#6d7785", "osmWidth": 2.0, "osmOpacity": 0.48},
        "road": {"osmColor": "#b84a4a", "osmWidth": 2.1, "osmOpacity": 0.55},
        "other": {"osmColor": "#7f7f7f", "osmWidth": 1.7, "osmOpacity": 0.4},
    }
    style = dict(styles.get(osm_class, styles["other"]))
    if status == "restricted":
        style["osmOpacity"] = min(style["osmOpacity"], 0.32)
    elif status == "conditional":
        style["osmOpacity"] = min(style["osmOpacity"], 0.48)
    return style


def overpass_to_geojson(
    overpass_data: dict[str, Any],
    target: dict[str, Any],
    query: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    features = []
    by_highway: Counter[str] = Counter()
    by_surface: Counter[str] = Counter()
    by_tracktype: Counter[str] = Counter()
    by_access_status: Counter[str] = Counter()
    by_route_class: Counter[str] = Counter()
    total_m = 0.0
    with_bicycle_tags = 0
    with_surface = 0

    for element in overpass_data.get("elements", []):
        if element.get("type") != "way":
            continue

        geometry = element.get("geometry") or []
        coordinates = [
            [round(float(point["lon"]), 7), round(float(point["lat"]), 7)]
            for point in geometry
            if point and "lon" in point and "lat" in point
        ]
        if len(coordinates) < 2:
            continue

        tags = element.get("tags") or {}
        status = access_status(tags)
        osm_class = route_class(tags)
        distance_m = line_length_m(coordinates)
        total_m += distance_m

        highway = str(tags.get("highway", "(none)"))
        surface = str(tags.get("surface", "(none)"))
        tracktype = str(tags.get("tracktype", "(none)"))
        by_highway[highway] += 1
        by_surface[surface] += 1
        by_tracktype[tracktype] += 1
        by_access_status[status] += 1
        by_route_class[osm_class] += 1
        if "bicycle" in tags:
            with_bicycle_tags += 1
        if "surface" in tags:
            with_surface += 1

        properties = {
            **tags,
            "osmType": "way",
            "osmId": element.get("id"),
            "osmRouteClass": osm_class,
            "accessStatus": status,
            "distanceMeters": round(distance_m, 1),
            **style_for_class(osm_class, status),
        }
        features.append(
            {
                "type": "Feature",
                "id": f"way/{element.get('id')}",
                "geometry": {
                    "type": "LineString",
                    "coordinates": coordinates,
                },
                "properties": properties,
            }
        )

    west, south, east, north = target["bbox"]
    feature_collection = {
        "type": "FeatureCollection",
        "bbox": [west, south, east, north],
        "metadata": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "source": "OpenStreetMap via Overpass",
            "target": target_metadata(target),
            "overpassQuery": query,
            "note": "Raw OSM ways for visual exploration; not split into routing graph edges.",
        },
        "features": features,
    }
    summary = {
        "generatedAt": feature_collection["metadata"]["generatedAt"],
        "source": feature_collection["metadata"]["source"],
        "bbox": {
            "west": west,
            "south": south,
            "east": east,
            "north": north,
        },
        "target": target_metadata(target),
        "ways": len(features),
        "totalKm": round(total_m / 1000, 1),
        "withBicycleTags": with_bicycle_tags,
        "withSurface": with_surface,
        "byHighway": dict(by_highway.most_common()),
        "bySurface": dict(by_surface.most_common()),
        "byTracktype": dict(by_tracktype.most_common()),
        "byAccessStatus": dict(by_access_status.most_common()),
        "byRouteClass": dict(by_route_class.most_common()),
    }
    return feature_collection, summary


def target_metadata(target: dict[str, Any]) -> dict[str, Any]:
    metadata = {
        "type": target["type"],
        "bbox": {
            "west": target["bbox"][0],
            "south": target["bbox"][1],
            "east": target["bbox"][2],
            "north": target["bbox"][3],
        },
    }
    if target.get("path"):
        metadata["path"] = str(target["path"])
    if target.get("id"):
        metadata["id"] = target["id"]
    if target.get("name"):
        metadata["name"] = target["name"]
    return metadata


def target_from_geojson(path: Path) -> dict[str, Any]:
    data = load_json(path)
    ring = load_target_polygon(path)
    properties = data.get("properties") if isinstance(data, dict) else {}
    return {
        "type": "polygon",
        "path": path,
        "id": properties.get("id") if isinstance(properties, dict) else None,
        "name": properties.get("name") if isinstance(properties, dict) else None,
        "ring": ring,
        "bbox": polygon_bbox(ring),
    }


def target_from_bbox(bbox: tuple[float, float, float, float]) -> dict[str, Any]:
    return {
        "type": "bbox",
        "bbox": bbox,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-geojson",
        type=Path,
        default=Path("data/map-source.geojson"),
        help="CycleWays source GeoJSON used to derive the default bbox.",
    )
    parser.add_argument(
        "--target-geojson",
        type=Path,
        default=DEFAULT_TARGET_GEOJSON,
        help="GeoJSON Polygon used as the OSM fetch target when present.",
    )
    parser.add_argument(
        "--bbox",
        type=parse_bbox,
        default=None,
        help="Manual bbox as west,south,east,north. Defaults to source bbox plus buffer.",
    )
    parser.add_argument(
        "--buffer-deg",
        type=float,
        default=DEFAULT_BUFFER_DEG,
        help="Degrees to expand the source bbox in every direction.",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("build/osm"),
        help="Output directory for debug artifacts.",
    )
    parser.add_argument(
        "--endpoint",
        default=DEFAULT_ENDPOINT,
        help="Overpass interpreter endpoint.",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=180,
        help="Overpass query timeout.",
    )
    parser.add_argument(
        "--highway-pattern",
        default=DEFAULT_HIGHWAY_PATTERN,
        help="Regex for OSM highway values to include.",
    )
    parser.add_argument(
        "--input-overpass-json",
        type=Path,
        default=None,
        help="Convert an existing Overpass JSON response instead of fetching.",
    )
    args = parser.parse_args()

    if args.bbox:
        target = target_from_bbox(args.bbox)
    elif args.target_geojson and args.target_geojson.exists():
        target = target_from_geojson(args.target_geojson)
    else:
        source_geojson = load_json(args.source_geojson)
        target = target_from_bbox(
            buffered_bbox(source_geojson_bbox(source_geojson), args.buffer_deg)
        )

    query = build_overpass_query(target, args.highway_pattern, args.timeout_seconds)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "overpass-query.ql").write_text(query, encoding="utf-8")

    try:
        if args.input_overpass_json:
            overpass_data = load_json(args.input_overpass_json)
        else:
            overpass_data = fetch_overpass_json(args.endpoint, query)
            write_json(args.out_dir / "overpass-response.json", overpass_data, compact=True)

        geojson_data, summary = overpass_to_geojson(overpass_data, target, query)
        write_json(args.out_dir / "osm-raw-ways.geojson", geojson_data, compact=True)
        write_json(args.out_dir / "osm-summary.json", summary)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
        print(f"Failed to fetch or convert OSM data: {error}", file=sys.stderr)
        return 1

    print(
        f"Wrote {summary['ways']} OSM ways, {summary['totalKm']} km "
        f"to {args.out_dir / 'osm-raw-ways.geojson'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
