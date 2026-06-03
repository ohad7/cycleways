#!/usr/bin/env python3
"""Create canonical source GeoJSON from current generated GeoJSON + segments.json."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


GENERATED_KEYS = {
    "middle",
    "elevation_gain_m",
    "elevation_loss_m",
    "net_elevation_change_m",
}


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def infer_road_type(stroke: str | None) -> str:
    normalized = (stroke or "").lower()
    if normalized == "#0288d1":
        return "paved"
    if normalized == "#ae9067":
        return "dirt"
    if normalized == "#8f2424":
        return "road"
    return "paved"


def source_properties(
    feature_properties: dict[str, Any],
    segment_data: dict[str, Any] | None,
    next_id: int,
) -> tuple[dict[str, Any], int]:
    segment_data = segment_data or {}
    name = feature_properties.get("name")
    properties: dict[str, Any] = {
        "id": segment_data.get("id", next_id),
        "name": name,
        "status": "deprecated" if segment_data.get("deprecated") else "active",
        "roadType": infer_road_type(feature_properties.get("stroke")),
    }

    if "styleUrl" in feature_properties:
        properties["styleUrl"] = feature_properties["styleUrl"]
    if "stroke" in feature_properties:
        properties["stroke"] = feature_properties["stroke"]
        properties["sourceStroke"] = feature_properties["stroke"]
    if "stroke-opacity" in feature_properties:
        properties["stroke-opacity"] = feature_properties["stroke-opacity"]
    if "stroke-width" in feature_properties:
        properties["stroke-width"] = feature_properties["stroke-width"]
    if "description" in feature_properties:
        properties["description"] = feature_properties["description"]

    for key, value in segment_data.items():
        if key in GENERATED_KEYS or key == "id":
            continue
        properties[key] = value

    if segment_data.get("id") is None:
        next_id += 1

    return properties, next_id


def legacy_properties(name: str, segment_data: dict[str, Any]) -> dict[str, Any]:
    properties: dict[str, Any] = {
        "name": name,
        "id": segment_data.get("id"),
        "status": "deprecated" if segment_data.get("deprecated") else "legacy",
        "roadType": "paved",
    }

    for key, value in segment_data.items():
        if key in GENERATED_KEYS or key == "id":
            continue
        properties[key] = value

    return properties


def migrate(geojson_path: Path, segments_path: Path, output_path: Path) -> dict[str, Any]:
    geojson_data = load_json(geojson_path)
    segments_data = load_json(segments_path)

    if geojson_data.get("type") != "FeatureCollection":
        raise ValueError(f"Expected FeatureCollection: {geojson_path}")
    if not isinstance(segments_data, dict):
        raise ValueError(f"Expected segments object: {segments_path}")

    max_id = max(
        [value.get("id", 0) for value in segments_data.values() if isinstance(value, dict)],
        default=0,
    )
    next_id = max_id + 1
    seen_names: set[str] = set()
    features: list[dict[str, Any]] = []

    for feature in geojson_data.get("features", []):
        geometry = feature.get("geometry", {})
        if geometry.get("type") != "LineString":
            continue

        feature_properties = feature.get("properties", {})
        name = feature_properties.get("name")
        if not name:
            continue

        properties, next_id = source_properties(
            feature_properties,
            segments_data.get(name),
            next_id,
        )
        seen_names.add(name)
        features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": geometry,
            }
        )

    for name, segment_data in sorted(
        segments_data.items(),
        key=lambda item: (item[1].get("id", 0) if isinstance(item[1], dict) else 0, item[0]),
    ):
        if name in seen_names or not isinstance(segment_data, dict):
            continue
        features.append(
            {
                "type": "Feature",
                "properties": legacy_properties(name, segment_data),
                "geometry": None,
            }
        )

    source = {
        "type": "FeatureCollection",
        "features": features,
    }
    write_json(output_path, source)
    return {
        "output": str(output_path),
        "lineFeatures": len(seen_names),
        "legacyFeatures": len(features) - len(seen_names),
        "totalFeatures": len(features),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create canonical source GeoJSON from current map artifacts."
    )
    parser.add_argument("--geojson", type=Path, default=Path("public-data/bike_roads.geojson"))
    parser.add_argument("--segments", type=Path, default=Path("public-data/segments.json"))
    parser.add_argument("--output", type=Path, default=Path("data/map-source.geojson"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    summary = migrate(args.geojson, args.segments, args.output)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
