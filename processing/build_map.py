#!/usr/bin/env python3
"""Build map artifacts from source KML or canonical source GeoJSON.

This keeps the current KML-based processing flow repeatable while moving all
outputs into deterministic paths:

- bike_roads.geojson
- segments.json
- map.kml
- report.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict, deque
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


KML_NAMESPACE = "http://www.opengis.net/kml/2.2"
DEFAULT_ELEVATION_URL = "http://localhost/api/v1/lookup"
DEFAULT_CACHE_FILE = Path(__file__).resolve().parent / "cache" / "elevation_cache.json"
GENERATED_SEGMENT_KEYS = {
    "middle",
    "elevation_gain_m",
    "elevation_loss_m",
    "net_elevation_change_m",
}
STYLE_ONLY_KEYS = {
    "name",
    "styleUrl",
    "stroke",
    "stroke-opacity",
    "stroke-width",
    "sourceStroke",
    "roadType",
}
ROAD_TYPE_STYLES = {
    "paved": {"stroke": "#0288d1", "stroke-opacity": 1.0, "stroke-width": 5.0},
    "dirt": {"stroke": "#ae9067", "stroke-opacity": 1.0, "stroke-width": 5.0},
    "road": {"stroke": "#8f2424", "stroke-opacity": 1.0, "stroke-width": 5.0},
}
QUALITY_KEYS = ("overall", "safety", "comfort", "scenery")


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        try:
            return json.load(handle)
        except json.JSONDecodeError:
            return default


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def emit_progress(enabled: bool, message: str) -> None:
    if enabled:
        print(message, file=sys.stderr, flush=True)


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def combined_digest(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def strip_namespace(tree: ET.ElementTree) -> ET.ElementTree:
    for elem in tree.iter():
        if "}" in elem.tag:
            elem.tag = elem.tag.split("}", 1)[1]
    return tree


def ensure_kml_namespace(root: ET.Element) -> None:
    if root.tag != "kml":
        root.tag = "kml"
    root.attrib.clear()
    root.set("xmlns", KML_NAMESPACE)


def kml_color_to_hex(kml_color: str | None) -> tuple[str, float]:
    """Convert KML color aabbggrr to CSS hex rrggbb and opacity."""
    if not kml_color or len(kml_color) != 8:
        return "#000000", 1.0
    alpha = int(kml_color[0:2], 16) / 255.0
    blue = kml_color[2:4]
    green = kml_color[4:6]
    red = kml_color[6:8]
    return f"#{red}{green}{blue}", alpha


def haversine(coord1: tuple[float, float], coord2: tuple[float, float]) -> float:
    """Calculate distance in meters between two (lat, lon) coordinates."""
    radius_m = 6_371_000
    lat1, lon1 = coord1
    lat2, lon2 = coord2
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius_m * c


def parse_coordinate(coord_text: str) -> list[float] | None:
    parts = coord_text.split(",")
    if len(parts) < 2:
        return None
    lon = float(parts[0])
    lat = float(parts[1])
    elev = float(parts[2]) if len(parts) >= 3 and parts[2] != "" else 0.0
    return [lon, lat, elev]


def parse_coordinates(coords_text: str | None) -> list[list[float]]:
    if not coords_text:
        return []
    coords: list[list[float]] = []
    for coord_text in coords_text.strip().split():
        coord = parse_coordinate(coord_text)
        if coord is not None:
            coords.append(coord)
    return coords


def format_coordinates(coords: list[list[float] | tuple[float, float, float]]) -> str:
    return " ".join(f"{coord[0]},{coord[1]},{coord[2]}" for coord in coords)


def interpolate_coords(
    coords: list[tuple[float, float]],
    max_distance_m: float,
) -> list[tuple[float, float]]:
    """Interpolate lon/lat points so adjacent points are at most max_distance_m apart."""
    if not coords:
        return []
    new_coords = [coords[0]]
    for index in range(1, len(coords)):
        start = coords[index - 1]
        end = coords[index]
        distance = haversine((start[1], start[0]), (end[1], end[0]))
        if distance > max_distance_m:
            steps = int(distance // max_distance_m)
            for step in range(1, steps + 1):
                fraction = step / (steps + 1)
                lon = start[0] + fraction * (end[0] - start[0])
                lat = start[1] + fraction * (end[1] - start[1])
                new_coords.append((lon, lat))
        new_coords.append(end)
    return new_coords


def normalize_geojson_coord(coord: list[Any] | tuple[Any, ...]) -> list[float]:
    lon = float(coord[0])
    lat = float(coord[1])
    elevation = float(coord[2]) if len(coord) >= 3 and coord[2] is not None else 0.0
    return [lon, lat, elevation]


def interpolate_coords_with_elevation(
    coords: list[list[float]],
    max_distance_m: float,
) -> list[list[float]]:
    """Interpolate lon/lat/elevation points with linear elevation between endpoints."""
    if not coords:
        return []

    new_coords = [coords[0]]
    for index in range(1, len(coords)):
        start = coords[index - 1]
        end = coords[index]
        distance = haversine((start[1], start[0]), (end[1], end[0]))
        if distance > max_distance_m:
            steps = int(distance // max_distance_m)
            for step in range(1, steps + 1):
                fraction = step / (steps + 1)
                lon = start[0] + fraction * (end[0] - start[0])
                lat = start[1] + fraction * (end[1] - start[1])
                elevation = start[2] + fraction * (end[2] - start[2])
                new_coords.append([lon, lat, elevation])
        new_coords.append(end)

    return new_coords


def calculate_average_spacing(coords: list[list[float]]) -> float | None:
    if len(coords) < 2:
        return None

    total_distance = 0.0
    for index in range(1, len(coords)):
        total_distance += haversine(
            (coords[index - 1][1], coords[index - 1][0]),
            (coords[index][1], coords[index][0]),
        )
    return total_distance / (len(coords) - 1)


def get_kml_namespace(root: ET.Element) -> dict[str, str]:
    match = re.match(r"\{.*\}", root.tag)
    namespace = match.group(0)[1:-1] if match else KML_NAMESPACE
    return {"kml": namespace}


def calculate_segment_densities(tree: ET.ElementTree) -> dict[str, float]:
    root = tree.getroot()
    namespace = get_kml_namespace(root)
    densities: dict[str, float] = {}

    for placemark in root.findall(".//kml:Placemark", namespace):
        name_elem = placemark.find("kml:name", namespace)
        coords_elem = placemark.find(".//kml:coordinates", namespace)
        if name_elem is None or coords_elem is None or not name_elem.text:
            continue

        coords = parse_coordinates(coords_elem.text)
        if len(coords) < 2:
            continue

        total_distance = 0.0
        for index in range(1, len(coords)):
            total_distance += haversine(
                (coords[index - 1][1], coords[index - 1][0]),
                (coords[index][1], coords[index][0]),
            )
        densities[name_elem.text.strip()] = total_distance / (len(coords) - 1)

    return densities


def create_uniform_kml(
    input_kml: Path,
    output_kml: Path,
    max_distance_m: float,
) -> dict[str, float]:
    tree = ET.parse(input_kml)
    densities = calculate_segment_densities(tree)
    root = tree.getroot()
    namespace = get_kml_namespace(root)

    for coords_elem in root.findall(".//kml:coordinates", namespace):
        coords = parse_coordinates(coords_elem.text)
        lon_lat_coords = [(coord[0], coord[1]) for coord in coords]
        if len(lon_lat_coords) > 1:
            fixed_coords = interpolate_coords(lon_lat_coords, max_distance_m)
            coords_elem.text = " ".join(f"{lon},{lat},0" for lon, lat in fixed_coords)

    output_kml.parent.mkdir(parents=True, exist_ok=True)
    tree.write(output_kml, encoding="utf-8", xml_declaration=True)
    return densities


def build_elevation_url(base_url: str, lat: str, lon: str) -> str:
    query = urllib.parse.urlencode({"locations": f"{lat},{lon}"})
    return f"{base_url}?{query}"


def get_elevation(
    lat: str,
    lon: str,
    original_elev: float,
    cache: dict[str, float],
    elevation_url: str,
    skip_elevation: bool,
    elevation_stats: dict[str, Any],
) -> float:
    if skip_elevation:
        elevation_stats["skipped"] += 1
        return original_elev

    key = f"{lat},{lon}"
    if key in cache:
        elevation_stats["cacheHits"] += 1
        return cache[key]

    elevation_stats["lookups"] += 1
    url = build_elevation_url(elevation_url, lat, lon)
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
        results = payload.get("results", [])
        if results:
            elevation = float(results[0].get("elevation", 0))
            cache[key] = elevation
            return elevation
        elevation_stats["failures"] += 1
        elevation_stats["failureExamples"].append(
            {"lat": lat, "lon": lon, "error": "No elevation results returned"}
        )
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        elevation_stats["failures"] += 1
        elevation_stats["failureExamples"].append({"lat": lat, "lon": lon, "error": str(exc)})

    return 0.0


def process_coordinates_with_elevation(
    coords_text: str | None,
    cache: dict[str, float],
    elevation_url: str,
    skip_elevation: bool,
    elevation_stats: dict[str, Any],
) -> str:
    processed: list[list[float]] = []
    for coord_text in (coords_text or "").strip().split():
        parts = coord_text.split(",")
        if len(parts) < 2:
            continue

        lon = parts[0]
        lat = parts[1]
        original_elev = float(parts[2]) if len(parts) >= 3 and parts[2] != "" else 0.0
        corrected_elev = get_elevation(
            lat,
            lon,
            original_elev,
            cache,
            elevation_url,
            skip_elevation,
            elevation_stats,
        )
        processed.append([float(lon), float(lat), corrected_elev])

    return "\n" + "\n".join(f"{lon},{lat},{elev}" for lon, lat, elev in processed) + "\n"


def process_coord_list_with_elevation(
    coords: list[list[float]],
    cache: dict[str, float],
    elevation_url: str,
    skip_elevation: bool,
    elevation_stats: dict[str, Any],
    progress: Callable[[str], None] | None = None,
) -> list[list[float]]:
    processed: list[list[float]] = []
    total = len(coords)
    for index, (lon, lat, original_elev) in enumerate(coords, start=1):
        corrected_elev = get_elevation(
            str(lat),
            str(lon),
            original_elev,
            cache,
            elevation_url,
            skip_elevation,
            elevation_stats,
        )
        processed.append([lon, lat, corrected_elev])
        if progress and index % 1000 == 0:
            progress(
                f"elevation {index}/{total} points "
                f"(lookups {elevation_stats['lookups']}, "
                f"cache hits {elevation_stats['cacheHits']}, "
                f"skipped {elevation_stats['skipped']}, "
                f"failures {elevation_stats['failures']})"
            )
    return processed


def ensure_elevation_success(elevation_stats: dict[str, Any]) -> None:
    if elevation_stats.get("skipElevation"):
        return

    failures = int(elevation_stats.get("failures") or 0)
    if failures == 0:
        return

    examples = elevation_stats.get("failureExamples") or []
    example_text = ""
    if examples:
        first = examples[0]
        example_text = (
            f" Example: {first.get('lat')},{first.get('lon')}: "
            f"{first.get('error')}"
        )
    raise RuntimeError(
        f"Elevation lookup failed for {failures} points. "
        "Start the elevation service or run with --skip-elevation for preview builds."
        f"{example_text}"
    )


def update_line_widths(root: ET.Element, width: str = "5") -> None:
    for linestyle in root.findall(".//LineStyle"):
        width_tag = linestyle.find("width")
        if width_tag is None:
            width_tag = ET.SubElement(linestyle, "width")
        width_tag.text = width


def remove_redundant_coords_by_height(
    root: ET.Element,
    distance_threshold_m: float,
) -> None:
    for coords_elem in root.findall(".//coordinates"):
        coords = parse_coordinates(coords_elem.text)
        if len(coords) < 2:
            continue

        reduced = [coords[0]]
        last_kept = coords[0]

        for current in coords[1:-1]:
            if current[2] != last_kept[2]:
                reduced.append(current)
                last_kept = current
                continue

            distance = haversine((last_kept[1], last_kept[0]), (current[1], current[0]))
            if distance >= distance_threshold_m:
                reduced.append(current)
                last_kept = current

        reduced.append(coords[-1])
        coords_elem.text = format_coordinates(reduced)


def reduce_redundant_coords_by_height(
    coords: list[list[float]],
    distance_threshold_m: float,
) -> list[list[float]]:
    if len(coords) < 2:
        return coords

    reduced = [coords[0]]
    last_kept = coords[0]

    for current in coords[1:-1]:
        if current[2] != last_kept[2]:
            reduced.append(current)
            last_kept = current
            continue

        distance = haversine((last_kept[1], last_kept[0]), (current[1], current[0]))
        if distance >= distance_threshold_m:
            reduced.append(current)
            last_kept = current

    reduced.append(coords[-1])
    return reduced


def parse_linestyle(style_element: ET.Element) -> dict[str, Any]:
    props: dict[str, Any] = {}
    linestyle = style_element.find("LineStyle")
    if linestyle is None:
        return props

    color_tag = linestyle.find("color")
    width_tag = linestyle.find("width")
    if color_tag is not None and color_tag.text:
        stroke, opacity = kml_color_to_hex(color_tag.text.strip())
        props["stroke"] = stroke
        props["stroke-opacity"] = round(opacity, 3)
    if width_tag is not None and width_tag.text:
        try:
            props["stroke-width"] = float(width_tag.text.strip())
        except ValueError:
            pass
    return props


def extract_styles(root: ET.Element) -> dict[str, dict[str, Any]]:
    styles: dict[str, dict[str, Any]] = {}

    for style in root.findall(".//Style"):
        style_id = style.get("id")
        if style_id:
            styles[f"#{style_id}"] = parse_linestyle(style)

    for stylemap in root.findall(".//StyleMap"):
        stylemap_id = stylemap.get("id")
        if not stylemap_id:
            continue

        normal_style = None
        for pair in stylemap.findall("Pair"):
            key_tag = pair.find("key")
            url_tag = pair.find("styleUrl")
            if (
                key_tag is not None
                and key_tag.text == "normal"
                and url_tag is not None
                and url_tag.text
            ):
                normal_style = url_tag.text.strip()
                break

        if normal_style and normal_style in styles:
            styles[f"#{stylemap_id}"] = styles[normal_style]

    return styles


def extract_properties(placemark: ET.Element, styles: dict[str, dict[str, Any]]) -> dict[str, Any]:
    props: dict[str, Any] = {}

    name_tag = placemark.find("name")
    if name_tag is not None and name_tag.text:
        props["name"] = name_tag.text.strip()

    desc_tag = placemark.find("description")
    if desc_tag is not None and desc_tag.text:
        props["description"] = desc_tag.text.strip()

    style_tag = placemark.find("styleUrl")
    if style_tag is not None and style_tag.text:
        style_url = style_tag.text.strip()
        props["styleUrl"] = style_url
        if style_url in styles:
            props.update(styles[style_url])

    return props


def smooth_elevations(coords: list[list[float]], window_size: int = 5) -> list[tuple[float, float, float]]:
    if len(coords) < window_size:
        return [(coord[0], coord[1], coord[2]) for coord in coords]

    smoothed: list[tuple[float, float, float]] = []
    half_window = window_size // 2
    for index, coord in enumerate(coords):
        start = max(0, index - half_window)
        end = min(len(coords), index + half_window + 1)
        avg_height = sum(c[2] for c in coords[start:end]) / (end - start)
        smoothed.append((coord[0], coord[1], avg_height))
    return smoothed


def calculate_elevation_changes(
    coords: list[list[float]],
    min_elevation_change_m: float = 2.0,
) -> tuple[float, float, float]:
    if len(coords) < 2:
        return 0.0, 0.0, 0.0

    total_gain = 0.0
    total_loss = 0.0
    smoothed = smooth_elevations(coords)

    for index in range(1, len(smoothed)):
        diff = smoothed[index][2] - smoothed[index - 1][2]
        if abs(diff) < min_elevation_change_m:
            continue
        if diff > 0:
            total_gain += diff
        else:
            total_loss += abs(diff)

    return total_gain, total_loss, total_gain - total_loss


def calculate_middle_coordinate(coords: list[list[float]]) -> list[float] | None:
    if not coords:
        return None
    if len(coords) == 1:
        return coords[0]

    cumulative = [0.0]
    for index in range(1, len(coords)):
        cumulative.append(
            cumulative[-1]
            + haversine(
                (coords[index - 1][1], coords[index - 1][0]),
                (coords[index][1], coords[index][0]),
            )
        )

    middle_distance = cumulative[-1] / 2.0
    closest_index = min(
        range(len(cumulative)),
        key=lambda index: abs(cumulative[index] - middle_distance),
    )
    return coords[closest_index]


def kml_to_geojson(root: ET.Element) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    styles = extract_styles(root)
    features: list[dict[str, Any]] = []
    metrics_by_name: dict[str, dict[str, Any]] = {}

    for placemark in root.findall(".//Placemark"):
        coords_tag = placemark.find(".//coordinates")
        if coords_tag is None or not (coords_tag.text or "").strip():
            continue

        coords = parse_coordinates(coords_tag.text)
        if not coords:
            continue

        properties = extract_properties(placemark, styles)
        segment_name = properties.get("name")
        geometry = (
            {"type": "Point", "coordinates": coords[0]}
            if len(coords) == 1
            else {"type": "LineString", "coordinates": coords}
        )

        gain, loss, net = calculate_elevation_changes(coords)
        middle = calculate_middle_coordinate(coords)
        if segment_name:
            metrics_by_name[segment_name] = {
                "elevation_gain_m": round(gain, 2),
                "elevation_loss_m": round(loss, 2),
                "net_elevation_change_m": round(net, 2),
                "middle": middle,
                "coordinate_count": len(coords),
            }

        features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": geometry,
            }
        )

    return {"type": "FeatureCollection", "features": features}, metrics_by_name


def extract_segment_names_from_kml(input_kml: Path) -> list[str]:
    tree = ET.parse(input_kml)
    root = tree.getroot()
    namespace = get_kml_namespace(root)
    names: list[str] = []
    for placemark in root.findall(".//kml:Placemark", namespace):
        name_elem = placemark.find("kml:name", namespace)
        if name_elem is not None and name_elem.text is not None:
            names.append(name_elem.text.strip())
    return names


def build_segments_output(
    source_segments: dict[str, Any],
    metrics_by_name: dict[str, dict[str, Any]],
    kml_segment_names: list[str],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    output: dict[str, Any] = {}
    new_segments: list[dict[str, Any]] = []
    next_id = max(
        [value.get("id", 0) for value in source_segments.values() if isinstance(value, dict)],
        default=0,
    )

    for segment_name in kml_segment_names:
        if segment_name in output:
            continue

        if segment_name in source_segments and isinstance(source_segments[segment_name], dict):
            segment_data = dict(source_segments[segment_name])
        else:
            next_id += 1
            segment_data = {"id": next_id}
            new_segments.append({"name": segment_name, "id": next_id})

        metrics = metrics_by_name.get(segment_name, {})
        middle = metrics.get("middle")
        if middle:
            segment_data["middle"] = {
                "longitude": round(middle[0], 6),
                "latitude": round(middle[1], 6),
                "elevation": round(middle[2], 2),
            }

        if "elevation_gain_m" in metrics:
            segment_data["elevation_gain_m"] = metrics["elevation_gain_m"]
            segment_data["elevation_loss_m"] = metrics["elevation_loss_m"]
            segment_data["net_elevation_change_m"] = metrics["net_elevation_change_m"]

        output[segment_name] = segment_data

    for segment_name, segment_data in source_segments.items():
        if segment_name not in output:
            output[segment_name] = dict(segment_data)

    return output, new_segments


def segment_data_from_source_properties(properties: dict[str, Any]) -> dict[str, Any]:
    segment_data: dict[str, Any] = {}
    for key, value in properties.items():
        if key in STYLE_ONLY_KEYS or key in GENERATED_SEGMENT_KEYS:
            continue
        segment_data[key] = value
    return segment_data


def source_segments_from_geojson(source_geojson: dict[str, Any]) -> dict[str, Any]:
    segments: dict[str, Any] = {}
    for feature in source_geojson.get("features", []):
        properties = feature.get("properties", {})
        name = properties.get("name")
        if not name:
            continue
        segments[name] = segment_data_from_source_properties(properties)
    return segments


def is_active_source_feature(feature: dict[str, Any]) -> bool:
    geometry = feature.get("geometry")
    if not geometry or geometry.get("type") != "LineString":
        return False

    properties = feature.get("properties", {})
    status = properties.get("status", "active")
    if status in {"deprecated", "draft", "legacy"}:
        return False
    if properties.get("deprecated"):
        return False
    return True


def style_properties_from_source(properties: dict[str, Any]) -> dict[str, Any]:
    road_type = properties.get("roadType")
    style = dict(ROAD_TYPE_STYLES.get(road_type, {}))

    if properties.get("stroke"):
        style["stroke"] = properties["stroke"]
    if properties.get("stroke-opacity") is not None:
        style["stroke-opacity"] = properties["stroke-opacity"]
    if properties.get("stroke-width") is not None:
        style["stroke-width"] = properties["stroke-width"]

    if "stroke" not in style:
        style["stroke"] = "#0288d1"
    if "stroke-opacity" not in style:
        style["stroke-opacity"] = 1.0
    if "stroke-width" not in style:
        style["stroke-width"] = 5.0

    return style


def output_properties_from_source(properties: dict[str, Any]) -> dict[str, Any]:
    output = {
        "name": properties.get("name"),
    }

    for key in ("id", "status", "roadType", "description"):
        if key in properties:
            output[key] = properties[key]

    output.update(style_properties_from_source(properties))
    return output


def geojson_to_processed_geojson(
    source_geojson: dict[str, Any],
    cache_file: Path,
    elevation_url: str,
    skip_elevation: bool,
    max_distance_m: float,
    redundant_distance_m: float,
    verbose: bool = False,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], dict[str, float], dict[str, Any]]:
    cache = load_json(cache_file, {})
    elevation_stats: dict[str, Any] = {
        "cacheFile": str(cache_file),
        "url": elevation_url,
        "skipElevation": skip_elevation,
        "lookups": 0,
        "cacheHits": 0,
        "failures": 0,
        "skipped": 0,
        "failureExamples": [],
    }

    features: list[dict[str, Any]] = []
    metrics_by_name: dict[str, dict[str, Any]] = {}
    densities: dict[str, float] = {}
    active_features = [
        feature
        for feature in source_geojson.get("features", [])
        if is_active_source_feature(feature)
    ]

    emit_progress(
        verbose,
        f"Processing {len(active_features)} active source segments "
        f"from {len(source_geojson.get('features', []))} source records",
    )

    for index, source_feature in enumerate(active_features, start=1):
        properties = source_feature.get("properties", {})
        name = properties.get("name")
        raw_coords = [
            normalize_geojson_coord(coord)
            for coord in source_feature["geometry"].get("coordinates", [])
        ]
        if not name or len(raw_coords) < 2:
            emit_progress(
                verbose,
                f"[{index}/{len(active_features)}] skipped unnamed or short feature",
            )
            continue

        emit_progress(
            verbose,
            f"[{index}/{len(active_features)}] {name}: {len(raw_coords)} source coordinates",
        )
        average_spacing = calculate_average_spacing(raw_coords)
        if average_spacing is not None:
            densities[name] = average_spacing

        interpolated = interpolate_coords_with_elevation(raw_coords, max_distance_m)
        before = {
            "lookups": elevation_stats["lookups"],
            "cacheHits": elevation_stats["cacheHits"],
            "skipped": elevation_stats["skipped"],
            "failures": elevation_stats["failures"],
        }
        emit_progress(
            verbose,
            f"[{index}/{len(active_features)}] {name}: resolving {len(interpolated)} elevation points",
        )

        def segment_progress(message: str) -> None:
            emit_progress(verbose, f"[{index}/{len(active_features)}] {name}: {message}")

        elevated = process_coord_list_with_elevation(
            interpolated,
            cache,
            elevation_url,
            skip_elevation,
            elevation_stats,
            segment_progress if verbose else None,
        )
        processed_coords = reduce_redundant_coords_by_height(elevated, redundant_distance_m)
        emit_progress(
            verbose,
            f"[{index}/{len(active_features)}] {name}: "
            f"{len(raw_coords)} source -> {len(interpolated)} sampled -> {len(processed_coords)} output, "
            f"lookups +{elevation_stats['lookups'] - before['lookups']}, "
            f"cache +{elevation_stats['cacheHits'] - before['cacheHits']}, "
            f"skipped +{elevation_stats['skipped'] - before['skipped']}, "
            f"failures +{elevation_stats['failures'] - before['failures']}",
        )

        gain, loss, net = calculate_elevation_changes(processed_coords)
        middle = calculate_middle_coordinate(processed_coords)
        metrics_by_name[name] = {
            "elevation_gain_m": round(gain, 2),
            "elevation_loss_m": round(loss, 2),
            "net_elevation_change_m": round(net, 2),
            "middle": middle,
            "coordinate_count": len(processed_coords),
        }

        features.append(
            {
                "type": "Feature",
                "properties": output_properties_from_source(properties),
                "geometry": {
                    "type": "LineString",
                    "coordinates": processed_coords,
                },
            }
        )

    write_json(cache_file, cache)
    if len(elevation_stats["failureExamples"]) > 20:
        elevation_stats["failureExamples"] = elevation_stats["failureExamples"][:20]

    return {"type": "FeatureCollection", "features": features}, metrics_by_name, densities, elevation_stats


def hex_to_kml_color(hex_color: str, opacity: float = 1.0) -> str:
    color = hex_color.lstrip("#")
    if len(color) != 6:
        color = "000000"
    alpha = max(0, min(255, round(opacity * 255)))
    red = color[0:2]
    green = color[2:4]
    blue = color[4:6]
    return f"{alpha:02x}{blue}{green}{red}"


def write_kml_from_geojson(geojson_data: dict[str, Any], output_kml: Path) -> None:
    root = ET.Element("kml", {"xmlns": KML_NAMESPACE})
    document = ET.SubElement(root, "Document")
    name_elem = ET.SubElement(document, "name")
    name_elem.text = "CycleWays Map"

    style_ids: dict[tuple[str, float, float], str] = {}
    style_count = 1

    for feature in geojson_data.get("features", []):
        properties = feature.get("properties", {})
        stroke = properties.get("stroke", "#0288d1")
        opacity = float(properties.get("stroke-opacity", 1.0))
        width = float(properties.get("stroke-width", 5.0))
        style_key = (stroke, opacity, width)
        if style_key in style_ids:
            continue

        style_id = f"sty-{style_count}"
        style_count += 1
        style_ids[style_key] = style_id

        style_elem = ET.SubElement(document, "Style", {"id": style_id})
        line_style = ET.SubElement(style_elem, "LineStyle")
        color_elem = ET.SubElement(line_style, "color")
        color_elem.text = hex_to_kml_color(stroke, opacity)
        width_elem = ET.SubElement(line_style, "width")
        width_elem.text = str(int(width) if width.is_integer() else width)

    for feature in geojson_data.get("features", []):
        geometry = feature.get("geometry", {})
        if geometry.get("type") != "LineString":
            continue

        properties = feature.get("properties", {})
        placemark = ET.SubElement(document, "Placemark")
        placemark_name = ET.SubElement(placemark, "name")
        placemark_name.text = str(properties.get("name", "Unnamed Route"))

        description = properties.get("description")
        if description:
            description_elem = ET.SubElement(placemark, "description")
            description_elem.text = str(description)

        stroke = properties.get("stroke", "#0288d1")
        opacity = float(properties.get("stroke-opacity", 1.0))
        width = float(properties.get("stroke-width", 5.0))
        style_url = ET.SubElement(placemark, "styleUrl")
        style_url.text = f"#{style_ids[(stroke, opacity, width)]}"

        linestring = ET.SubElement(placemark, "LineString")
        coordinates = ET.SubElement(linestring, "coordinates")
        coordinates.text = "\n" + "\n".join(
            f"{coord[0]},{coord[1]},{coord[2]}"
            for coord in geometry.get("coordinates", [])
        ) + "\n"

    output_kml.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(root).write(output_kml, encoding="utf-8", xml_declaration=True)


def endpoint_topology_report(
    geojson_data: dict[str, Any],
    threshold_m: float,
) -> dict[str, Any]:
    features = [
        feature
        for feature in geojson_data.get("features", [])
        if feature.get("geometry", {}).get("type") == "LineString"
    ]
    names = [feature.get("properties", {}).get("name", "") for feature in features]
    endpoints: list[tuple[list[float], list[float]]] = []
    for feature in features:
        coords = feature["geometry"]["coordinates"]
        endpoints.append((coords[0], coords[-1]))

    adjacency = [set() for _ in features]
    endpoint_degrees = [[0, 0] for _ in features]
    close_pairs: list[dict[str, Any]] = []

    for i in range(len(features)):
        for j in range(i + 1, len(features)):
            connected = False
            pairs = [
                (0, endpoints[i][0], 0, endpoints[j][0]),
                (0, endpoints[i][0], 1, endpoints[j][1]),
                (1, endpoints[i][1], 0, endpoints[j][0]),
                (1, endpoints[i][1], 1, endpoints[j][1]),
            ]
            for end_i, point_i, end_j, point_j in pairs:
                distance = haversine((point_i[1], point_i[0]), (point_j[1], point_j[0]))
                if distance <= threshold_m:
                    connected = True
                    endpoint_degrees[i][end_i] += 1
                    endpoint_degrees[j][end_j] += 1
                    if distance > 10:
                        close_pairs.append(
                            {
                                "distance_m": round(distance, 1),
                                "from": names[i],
                                "fromEnd": "end" if end_i else "start",
                                "to": names[j],
                                "toEnd": "end" if end_j else "start",
                            }
                        )
            if connected:
                adjacency[i].add(j)
                adjacency[j].add(i)

    visited: set[int] = set()
    components: list[list[int]] = []
    for index in range(len(features)):
        if index in visited:
            continue
        queue = deque([index])
        visited.add(index)
        component: list[int] = []
        while queue:
            current = queue.popleft()
            component.append(current)
            for neighbor in adjacency[current]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)
        components.append(component)

    components.sort(key=len, reverse=True)
    orphan_endpoints: list[dict[str, Any]] = []
    for index, degrees in enumerate(endpoint_degrees):
        for end_index, degree in enumerate(degrees):
            if degree == 0:
                point = endpoints[index][end_index]
                orphan_endpoints.append(
                    {
                        "segment": names[index],
                        "end": "end" if end_index else "start",
                        "latitude": point[1],
                        "longitude": point[0],
                    }
                )

    return {
        "segmentCount": len(features),
        "connectedComponents": len(components),
        "largestComponents": [len(component) for component in components[:8]],
        "orphanEndpointCount": len(orphan_endpoints),
        "orphanEndpoints": orphan_endpoints[:20],
        "closeEndpointPairsOver10m": close_pairs[:20],
    }


def route_compatibility_warnings(segments_data: dict[str, Any]) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    by_id: dict[int, tuple[str, dict[str, Any]]] = {}

    for segment_name, data in segments_data.items():
        if isinstance(data, dict) and isinstance(data.get("id"), int):
            by_id[data["id"]] = (segment_name, data)

    for segment_name, data in segments_data.items():
        if not isinstance(data, dict):
            continue

        segment_id = data.get("id")
        status = data.get("status", "active")
        is_deprecated = data.get("deprecated") or status == "deprecated"

        route_anchors = data.get("routeAnchors")
        if route_anchors is not None:
            if not isinstance(route_anchors, list) or not route_anchors:
                warnings.append(
                    {
                        "segment": segment_name,
                        "id": segment_id,
                        "issue": "routeAnchors must be a non-empty array of [lng, lat] coordinates",
                    }
                )
            else:
                for anchor_index, anchor in enumerate(route_anchors):
                    if (
                        not isinstance(anchor, list)
                        or len(anchor) < 2
                        or not isinstance(anchor[0], (int, float))
                        or not isinstance(anchor[1], (int, float))
                        or anchor[0] < -180
                        or anchor[0] > 180
                        or anchor[1] < -90
                        or anchor[1] > 90
                    ):
                        warnings.append(
                            {
                                "segment": segment_name,
                                "id": segment_id,
                                "anchorIndex": anchor_index,
                                "issue": "route anchor must be [lng, lat]",
                            }
                        )

        if is_deprecated and route_anchors is None and "middle" not in data:
            warnings.append(
                {
                    "segment": segment_name,
                    "id": segment_id,
                    "issue": "deprecated segment has no routeAnchors or middle fallback",
                }
            )

        split_from = data.get("splitFrom")
        if split_from is not None and isinstance(segment_id, int):
            parent = by_id.get(split_from)
            if parent is None:
                warnings.append(
                    {
                        "segment": segment_name,
                        "id": segment_id,
                        "splitFrom": split_from,
                        "issue": "split parent id does not exist",
                    }
                )
            else:
                parent_name, parent_data = parent
                if "routeAnchors" not in parent_data and "middle" not in parent_data:
                    warnings.append(
                        {
                            "segment": segment_name,
                            "id": segment_id,
                            "splitFrom": split_from,
                            "parent": parent_name,
                            "issue": "split parent has no routeAnchors or middle fallback",
                        }
                    )

    return warnings


def validate_outputs(
    geojson_data: dict[str, Any],
    segments_data: dict[str, Any],
    original_segments: dict[str, Any],
    new_segments: list[dict[str, Any]],
    threshold_m: float,
) -> dict[str, Any]:
    features = [
        feature
        for feature in geojson_data.get("features", [])
        if feature.get("geometry", {}).get("type") == "LineString"
    ]
    feature_names = [feature.get("properties", {}).get("name") for feature in features]
    feature_name_counts = Counter(name for name in feature_names if name)
    duplicate_feature_names = sorted(
        name for name, count in feature_name_counts.items() if count > 1
    )

    ids_by_value: dict[int, list[str]] = defaultdict(list)
    for name, data in segments_data.items():
        if isinstance(data, dict) and isinstance(data.get("id"), int):
            ids_by_value[data["id"]].append(name)
    duplicate_ids = {
        str(segment_id): names
        for segment_id, names in sorted(ids_by_value.items())
        if len(names) > 1
    }

    geojson_names = set(name for name in feature_names if name)
    segment_names = set(segments_data.keys())
    original_segment_names = set(original_segments.keys())
    active_missing_middle = sorted(
        name
        for name, data in segments_data.items()
        if (
            isinstance(data, dict)
            and not data.get("deprecated")
            and data.get("status", "active") not in {"deprecated", "draft", "legacy"}
            and "middle" not in data
        )
    )

    invalid_data_markers: list[dict[str, Any]] = []
    invalid_quality: list[dict[str, Any]] = []
    active_split_numbered_names: list[dict[str, Any]] = []
    for segment_name, data in segments_data.items():
        if not isinstance(data, dict):
            continue

        status = data.get("status", "active")
        active = not data.get("deprecated") and status not in {"deprecated", "draft", "legacy"}
        if active and data.get("splitFrom") is not None and re.search(r"\s-\s\d+$", segment_name):
            active_split_numbered_names.append(
                {
                    "segment": segment_name,
                    "id": data.get("id"),
                    "splitFrom": data.get("splitFrom"),
                    "issue": "active split child still has a numbered split suffix",
                }
            )

        quality = data.get("quality")
        if quality is None:
            if active:
                invalid_quality.append(
                    {
                        "segment": segment_name,
                        "issue": "missing quality",
                    }
                )
        elif not isinstance(quality, dict) or isinstance(quality, list):
            invalid_quality.append(
                {
                    "segment": segment_name,
                    "issue": "quality must be an object",
                }
            )
        else:
            unknown_keys = sorted(key for key in quality.keys() if key not in QUALITY_KEYS)
            if unknown_keys:
                invalid_quality.append(
                    {
                        "segment": segment_name,
                        "issue": "unsupported quality fields",
                        "fields": unknown_keys,
                    }
                )
            for key in QUALITY_KEYS:
                value = quality.get(key)
                if not isinstance(value, int) or value < 1 or value > 5:
                    invalid_quality.append(
                        {
                            "segment": segment_name,
                            "issue": f"quality.{key} must be an integer from 1 to 5",
                        }
                    )

        for index, marker in enumerate(data.get("data", []) or []):
            location = marker.get("location") if isinstance(marker, dict) else None
            if (
                not isinstance(location, list)
                or len(location) < 2
                or not isinstance(location[0], (int, float))
                or not isinstance(location[1], (int, float))
            ):
                invalid_data_markers.append({"segment": segment_name, "index": index})

    return {
        "featureCount": len(features),
        "segmentsCount": len(segments_data),
        "newSegments": new_segments,
        "duplicateFeatureNames": duplicate_feature_names,
        "duplicateIds": duplicate_ids,
        "geojsonMissingMetadataBeforeGeneration": sorted(geojson_names - original_segment_names),
        "metadataMissingInGeojson": sorted(segment_names - geojson_names),
        "activeMissingMiddle": active_missing_middle,
        "invalidDataMarkers": invalid_data_markers,
        "invalidQuality": invalid_quality,
        "activeSplitNumberedNames": active_split_numbered_names,
        "routeCompatibilityWarnings": route_compatibility_warnings(segments_data),
        "topology": endpoint_topology_report(geojson_data, threshold_m),
    }


def write_versioned_outputs(
    out_dir: Path,
    output_geojson: Path,
    output_segments: Path,
    output_kml: Path,
    elevation_stats: dict[str, Any],
    validation: dict[str, Any],
) -> tuple[dict[str, Any], Path]:
    version = combined_digest([output_geojson, output_segments, output_kml])[:12]
    versioned_geojson = out_dir / f"bike_roads.{version}.geojson"
    versioned_segments = out_dir / f"segments.{version}.json"
    versioned_kml = out_dir / f"map.{version}.kml"
    manifest_path = out_dir / "map-manifest.json"

    shutil.copyfile(output_geojson, versioned_geojson)
    shutil.copyfile(output_segments, versioned_segments)
    shutil.copyfile(output_kml, versioned_kml)

    manifest = {
        "version": version,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "bikeRoads": versioned_geojson.name,
        "segments": versioned_segments.name,
        "kml": f"exports/{versioned_kml.name}",
        "stable": {
            "bikeRoads": output_geojson.name,
            "segments": output_segments.name,
            "kml": output_kml.name,
        },
        "hashes": {
            "bikeRoads": file_digest(output_geojson),
            "segments": file_digest(output_segments),
            "kml": file_digest(output_kml),
        },
        "elevation": {
            "skipElevation": elevation_stats.get("skipElevation"),
            "failures": elevation_stats.get("failures"),
        },
        "validation": {
            "featureCount": validation.get("featureCount"),
            "segmentsCount": validation.get("segmentsCount"),
            "newSegments": len(validation.get("newSegments", [])),
            "routeCompatibilityWarnings": len(validation.get("routeCompatibilityWarnings", [])),
        },
    }
    write_json(manifest_path, manifest)
    return {
        "version": version,
        "manifest": str(manifest_path),
        "geojson": str(versioned_geojson),
        "segments": str(versioned_segments),
        "kml": str(versioned_kml),
    }, manifest_path


def process_elevations(
    uniform_kml: Path,
    output_kml: Path,
    cache_file: Path,
    elevation_url: str,
    skip_elevation: bool,
    redundant_distance_m: float,
    verbose: bool = False,
) -> tuple[ET.ElementTree, dict[str, Any]]:
    cache = load_json(cache_file, {})
    elevation_stats: dict[str, Any] = {
        "cacheFile": str(cache_file),
        "url": elevation_url,
        "skipElevation": skip_elevation,
        "lookups": 0,
        "cacheHits": 0,
        "failures": 0,
        "skipped": 0,
        "failureExamples": [],
    }

    tree = ET.parse(uniform_kml)
    strip_namespace(tree)
    root = tree.getroot()
    ensure_kml_namespace(root)

    coordinate_blocks = root.findall(".//coordinates")
    emit_progress(verbose, f"Processing {len(coordinate_blocks)} KML coordinate blocks")
    for index, coord_elem in enumerate(coordinate_blocks, start=1):
        emit_progress(verbose, f"[{index}/{len(coordinate_blocks)}] resolving KML coordinate block")
        coord_elem.text = process_coordinates_with_elevation(
            coord_elem.text,
            cache,
            elevation_url,
            skip_elevation,
            elevation_stats,
        )
        emit_progress(
            verbose,
            f"[{index}/{len(coordinate_blocks)}] KML block done "
            f"(lookups {elevation_stats['lookups']}, "
            f"cache hits {elevation_stats['cacheHits']}, "
            f"skipped {elevation_stats['skipped']}, "
            f"failures {elevation_stats['failures']})",
        )

    remove_redundant_coords_by_height(root, redundant_distance_m)
    update_line_widths(root)

    output_kml.parent.mkdir(parents=True, exist_ok=True)
    tree.write(output_kml, encoding="utf-8", xml_declaration=True)
    write_json(cache_file, cache)

    if len(elevation_stats["failureExamples"]) > 20:
        elevation_stats["failureExamples"] = elevation_stats["failureExamples"][:20]

    return tree, elevation_stats


def build_from_kml(args: argparse.Namespace) -> dict[str, Any]:
    input_kml = args.input_kml.resolve()
    segments_file = args.segments.resolve()
    out_dir = args.out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    emit_progress(args.verbose, f"Build input KML: {input_kml}")
    emit_progress(args.verbose, f"Build input segments: {segments_file}")
    emit_progress(args.verbose, f"Build output directory: {out_dir}")

    if not input_kml.exists():
        raise FileNotFoundError(f"Input KML not found: {input_kml}")
    if not segments_file.exists():
        raise FileNotFoundError(f"Segments JSON not found: {segments_file}")

    source_segments = load_json(segments_file, {})
    if not isinstance(source_segments, dict):
        raise ValueError(f"Segments JSON must be an object: {segments_file}")

    uniform_kml = out_dir / "intermediate_uniform.kml"
    output_kml = out_dir / "map.kml"
    output_geojson = out_dir / "bike_roads.geojson"
    output_segments = out_dir / "segments.json"
    output_report = out_dir / "report.json"

    densities = create_uniform_kml(input_kml, uniform_kml, args.max_distance)
    emit_progress(args.verbose, f"Wrote intermediate uniform KML: {uniform_kml}")
    processed_tree, elevation_stats = process_elevations(
        uniform_kml,
        output_kml,
        args.cache_file.resolve(),
        args.elevation_url,
        args.skip_elevation,
        args.redundant_distance,
        args.verbose,
    )
    ensure_elevation_success(elevation_stats)
    geojson_data, metrics_by_name = kml_to_geojson(processed_tree.getroot())
    kml_segment_names = extract_segment_names_from_kml(input_kml)
    generated_segments, new_segments = build_segments_output(
        source_segments,
        metrics_by_name,
        kml_segment_names,
    )

    emit_progress(args.verbose, "Writing GeoJSON, segments JSON, and versioned outputs")
    write_json(output_geojson, geojson_data)
    write_json(output_segments, generated_segments)

    validation = validate_outputs(
        geojson_data,
        generated_segments,
        source_segments,
        new_segments,
        args.topology_threshold,
    )
    versioned_outputs, manifest_path = write_versioned_outputs(
        out_dir,
        output_geojson,
        output_segments,
        output_kml,
        elevation_stats,
        validation,
    )
    emit_progress(args.verbose, f"Build version: {versioned_outputs['version']}")
    report = {
        "inputs": {
            "kml": str(input_kml),
            "segments": str(segments_file),
        },
        "outputs": {
            "uniformKml": str(uniform_kml),
            "kml": str(output_kml),
            "geojson": str(output_geojson),
            "segments": str(output_segments),
            "manifest": str(manifest_path),
            "versioned": versioned_outputs,
            "report": str(output_report),
        },
        "settings": {
            "maxDistanceM": args.max_distance,
            "redundantDistanceM": args.redundant_distance,
            "topologyThresholdM": args.topology_threshold,
        },
        "segmentDensitiesM": {
            name: round(distance, 2) for name, distance in sorted(densities.items())
        },
        "elevation": elevation_stats,
        "validation": validation,
    }
    write_json(output_report, report)
    return report


def build_from_source_geojson(args: argparse.Namespace) -> dict[str, Any]:
    input_geojson = args.input_geojson.resolve()
    out_dir = args.out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    emit_progress(args.verbose, f"Build input source GeoJSON: {input_geojson}")
    emit_progress(args.verbose, f"Build output directory: {out_dir}")

    if not input_geojson.exists():
        raise FileNotFoundError(f"Input GeoJSON not found: {input_geojson}")

    source_geojson = load_json(input_geojson, {})
    if source_geojson.get("type") != "FeatureCollection":
        raise ValueError(f"Source GeoJSON must be a FeatureCollection: {input_geojson}")
    emit_progress(
        args.verbose,
        f"Loaded {len(source_geojson.get('features', []))} source records",
    )

    source_segments = source_segments_from_geojson(source_geojson)
    output_kml = out_dir / "map.kml"
    output_geojson = out_dir / "bike_roads.geojson"
    output_segments = out_dir / "segments.json"
    output_report = out_dir / "report.json"

    geojson_data, metrics_by_name, densities, elevation_stats = geojson_to_processed_geojson(
        source_geojson,
        args.cache_file.resolve(),
        args.elevation_url,
        args.skip_elevation,
        args.max_distance,
        args.redundant_distance,
        args.verbose,
    )
    ensure_elevation_success(elevation_stats)
    active_segment_names = [
        feature.get("properties", {}).get("name")
        for feature in source_geojson.get("features", [])
        if is_active_source_feature(feature) and feature.get("properties", {}).get("name")
    ]
    generated_segments, new_segments = build_segments_output(
        source_segments,
        metrics_by_name,
        active_segment_names,
    )

    emit_progress(args.verbose, "Writing GeoJSON, segments JSON, KML, and versioned outputs")
    write_json(output_geojson, geojson_data)
    write_json(output_segments, generated_segments)
    write_kml_from_geojson(geojson_data, output_kml)

    validation = validate_outputs(
        geojson_data,
        generated_segments,
        source_segments,
        new_segments,
        args.topology_threshold,
    )
    versioned_outputs, manifest_path = write_versioned_outputs(
        out_dir,
        output_geojson,
        output_segments,
        output_kml,
        elevation_stats,
        validation,
    )
    emit_progress(args.verbose, f"Build version: {versioned_outputs['version']}")
    report = {
        "inputs": {
            "geojson": str(input_geojson),
        },
        "outputs": {
            "kml": str(output_kml),
            "geojson": str(output_geojson),
            "segments": str(output_segments),
            "manifest": str(manifest_path),
            "versioned": versioned_outputs,
            "report": str(output_report),
        },
        "settings": {
            "maxDistanceM": args.max_distance,
            "redundantDistanceM": args.redundant_distance,
            "topologyThresholdM": args.topology_threshold,
        },
        "segmentDensitiesM": {
            name: round(distance, 2) for name, distance in sorted(densities.items())
        },
        "elevation": elevation_stats,
        "validation": validation,
    }
    write_json(output_report, report)
    return report


def build(args: argparse.Namespace) -> dict[str, Any]:
    if args.input_geojson:
        return build_from_source_geojson(args)
    return build_from_kml(args)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build map artifacts from source KML or GeoJSON.")
    parser.add_argument("--input-kml", type=Path, default=Path("input.kml"))
    parser.add_argument("--input-geojson", type=Path)
    parser.add_argument("--segments", type=Path, default=Path("segments.json"))
    parser.add_argument("--out-dir", type=Path, default=Path("build"))
    parser.add_argument("--cache-file", type=Path, default=DEFAULT_CACHE_FILE)
    parser.add_argument("--elevation-url", default=DEFAULT_ELEVATION_URL)
    parser.add_argument("--skip-elevation", action="store_true")
    parser.add_argument("--verbose", action="store_true", help="Print build progress to stderr.")
    parser.add_argument("--max-distance", type=float, default=10.0)
    parser.add_argument("--redundant-distance", type=float, default=20.0)
    parser.add_argument("--topology-threshold", type=float, default=50.0)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        report = build(args)
    except Exception as exc:
        print(f"Build failed: {exc}", file=sys.stderr)
        return 1

    outputs = report["outputs"]
    validation = report["validation"]
    print(f"GeoJSON: {outputs['geojson']}")
    print(f"Segments: {outputs['segments']}")
    print(f"KML: {outputs['kml']}")
    print(f"Manifest: {outputs['manifest']}")
    print(f"Report: {outputs['report']}")
    print(
        "Validation: "
        f"{validation['featureCount']} features, "
        f"{validation['segmentsCount']} segment records, "
        f"{len(validation['newSegments'])} new segments"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
