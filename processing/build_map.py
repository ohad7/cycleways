#!/usr/bin/env python3
"""Build map artifacts from source KML or canonical source GeoJSON.

This keeps the current KML-based processing flow repeatable while moving all
public runtime outputs into deterministic paths:

- public-data/bike_roads.geojson
- public-data/segments.json
- public-data/cw-base-index.json
- public-data/exports/map.kml
- public-data/map-manifest.json
- report.json
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import re
import shutil
import struct
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

try:
    from .roundabout_review import join_roundabout_reviews
    from .crossing_review import join_crossing_reviews
    from .bicycle_traversal_policy import POLICY_DIGEST, POLICY_ID, normalize_bicycle_traversal
except ImportError:  # Direct script execution: processing/ is on sys.path.
    from roundabout_review import join_roundabout_reviews
    from crossing_review import join_crossing_reviews
    from bicycle_traversal_policy import POLICY_DIGEST, POLICY_ID, normalize_bicycle_traversal


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
SITE_GEOJSON_COORDINATE_DECIMALS = 6
SITE_GEOJSON_ELEVATION_DECIMALS = 1
ROUTING_EDGE_CONTINUITY_GAP_M = 12.0
ACCEPTED_MAPPING_LENGTH_WARNING_MIN_RATIO = 0.9
ACCEPTED_MAPPING_LENGTH_WARNING_MAX_RATIO = 1.35
ACCEPTED_MAPPING_LENGTH_BLOCK_MIN_RATIO = 0.8
ACCEPTED_MAPPING_LENGTH_BLOCK_MAX_RATIO = 2.0
PUBLIC_DATA_DIR = "public-data"
ROUTING_COMPAT_DIR = Path(__file__).resolve().parents[1] / "data" / "routing-compat"
BASE_ROUTING_SHARD_SCHEMA_VERSION = 1
BASE_ROUTING_SHARD_MANIFEST_SCHEMA_VERSION = 1
BASE_ROUTING_SHARD_SIZE_DEGREES = 0.05


def full_base_edge_ref(ref: dict[str, Any]) -> bool:
    try:
        from_fraction = float(ref.get("fromFraction", 0))
        to_fraction = float(ref.get("toFraction", 1))
    except (TypeError, ValueError):
        return False
    return (
        abs(min(from_fraction, to_fraction)) <= 1e-9
        and abs(max(from_fraction, to_fraction) - 1) <= 1e-9
    )


def cw_access_precedence_eligible(state: Any, reason: Any) -> bool:
    return (
        (state == "prohibited" and reason == "explicit-access-prohibited")
        or (state == "conditional" and reason == "explicit-access-conditional")
    )


def apply_accepted_cw_traversal_precedence(
    traversal: dict[str, Any],
    alignments: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    effective = copy.deepcopy(traversal)
    for direction in ("forward", "reverse"):
        memberships = alignments.get(direction) if isinstance(alignments, dict) else []
        base_state = effective.get(direction)
        base_reason = effective.get(f"{direction}Reason") or "normalized-policy"
        if (
            not memberships
            or not cw_access_precedence_eligible(base_state, base_reason)
        ):
            continue
        effective[f"{direction}BaseState"] = base_state
        effective[f"{direction}BaseReason"] = base_reason
        effective[direction] = "allowed"
        effective[f"{direction}Reason"] = "accepted-cw-alignment"
        trace = effective.get("trace")
        if isinstance(trace, dict) and isinstance(trace.get(direction), list):
            trace[direction].append(
                {
                    "stage": "cycleways",
                    "selected": "accepted-v2-alignment",
                    "baseState": base_state,
                    "baseReason": base_reason,
                    "segmentIds": sorted(
                        {
                            int(value.get("segmentId"))
                            for value in memberships
                            if isinstance(value, dict)
                            and isinstance(value.get("segmentId"), int)
                        }
                    ),
                }
            )
    return effective
BASE_ROUTING_COMPACT_SHARD_FORMAT_VERSION = 2
BASE_ROUTING_COMPACT_SHARD_POLICY_FORMAT_VERSION = 3
BASE_ROUTING_COMPACT_SHARD_JUNCTION_FORMAT_VERSION = 4
BASE_ROUTING_COMPACT_SHARD_MAGIC = b"CWBS1"
BASE_ROUTING_COMPACT_COORDINATE_SCALE = 1_000_000
BASE_ROUTING_COMPACT_DISTANCE_SCALE = 10
BASE_ROUTING_SHARE_ID_SCHEMA_VERSION = 1
PLACEHOLDER_SEGMENT_NAME_RE = re.compile(r"^new segment(?:\s*-\s*\d+)?$", re.IGNORECASE)


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        try:
            return json.load(handle)
        except json.JSONDecodeError:
            return default


def write_json(path: Path, data: Any, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        if compact:
            json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def write_sorted_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False, sort_keys=True)
        handle.write("\n")


def json_compact(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def diffable_site_geojson_feature(feature: Any) -> str:
    if not isinstance(feature, dict):
        return f"  {json_compact(feature)}"

    geometry = feature.get("geometry")
    coordinates = geometry.get("coordinates") if isinstance(geometry, dict) else None
    if (
        not isinstance(geometry, dict)
        or geometry.get("type") != "LineString"
        or not isinstance(coordinates, list)
    ):
        return f"  {json_compact(feature)}"

    parts: list[str] = []
    geometry_written = False
    for key, value in feature.items():
        if key != "geometry":
            parts.append(f"{json_compact(key)}:{json_compact(value)}")
            continue

        geometry_parts = [
            f"{json_compact(geometry_key)}:{json_compact(geometry_value)}"
            for geometry_key, geometry_value in geometry.items()
            if geometry_key != "coordinates"
        ]
        geometry_prefix = ",".join(geometry_parts)
        if geometry_prefix:
            geometry_prefix += ","
        coordinate_lines = ",\n".join(f"      {json_compact(coord)}" for coord in coordinates)
        parts.append(
            f'"geometry":{{{geometry_prefix}"coordinates":[\n'
            f"{coordinate_lines}\n"
            "  ]}"
        )
        geometry_written = True

    if not geometry_written:
        coordinate_lines = ",\n".join(f"      {json_compact(coord)}" for coord in coordinates)
        parts.append(
            '"geometry":{"type":"LineString","coordinates":[\n'
            f"{coordinate_lines}\n"
            "  ]"
        )

    return f"  {{{','.join(parts)}}}"


def write_site_geojson(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    features = data.get("features") if isinstance(data, dict) else None
    if not isinstance(features, list):
        write_json(path, data)
        return

    top_level_items = [
        f"{json_compact(key)}:{json_compact(value)}"
        for key, value in data.items()
        if key != "features"
    ]
    top_level_prefix = ",".join(top_level_items)
    if top_level_prefix:
        top_level_prefix += ',"features":['
    else:
        top_level_prefix = '"features":['

    feature_lines = ",\n".join(diffable_site_geojson_feature(feature) for feature in features)
    with path.open("w", encoding="utf-8") as handle:
        handle.write(f"{{{top_level_prefix}\n")
        handle.write(feature_lines)
        handle.write("\n]}\n")


def messagepack_pack(data: Any) -> bytes:
    payload = bytearray()
    pack_messagepack_value(payload, data)
    return bytes(payload)


def write_messagepack(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(messagepack_pack(data))


def write_compact_base_routing_shard(path: Path, shard_asset: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(pack_compact_base_routing_shard(shard_asset))


def pack_compact_base_routing_shard(shard_asset: dict[str, Any]) -> bytes:
    nodes = shard_asset.get("nodes") if isinstance(shard_asset.get("nodes"), list) else []
    edges = shard_asset.get("edges") if isinstance(shard_asset.get("edges"), list) else []
    strings = compact_shard_string_table(shard_asset, nodes, edges)
    string_index = {value: index for index, value in enumerate(strings)}
    node_index = {
        node["id"]: index
        for index, node in enumerate(nodes)
        if isinstance(node, dict) and isinstance(node.get("id"), str)
    }

    source_routing_schema_version = int(
        shard_asset.get("sourceRoutingSchemaVersion") or 0
    )
    has_junction_membership = any(
        isinstance(edge, dict) and isinstance(edge.get("cwJunctions"), dict)
        for edge in edges
    )
    format_version = (
        BASE_ROUTING_COMPACT_SHARD_JUNCTION_FORMAT_VERSION
        if source_routing_schema_version >= 3 and has_junction_membership
        else BASE_ROUTING_COMPACT_SHARD_POLICY_FORMAT_VERSION
        if source_routing_schema_version >= 3
        else BASE_ROUTING_COMPACT_SHARD_FORMAT_VERSION
    )
    payload = bytearray(BASE_ROUTING_COMPACT_SHARD_MAGIC)
    write_varuint(payload, format_version)
    write_varuint(payload, len(strings))
    for value in strings:
        encoded = value.encode("utf-8")
        write_varuint(payload, len(encoded))
        payload.extend(encoded)

    write_varuint(payload, int(shard_asset.get("schemaVersion") or 0))
    write_varuint(payload, int(shard_asset.get("sourceRoutingSchemaVersion") or 0))
    write_varuint(payload, string_index[str(shard_asset.get("id") or "")])
    for value in shard_asset.get("bounds", [0, 0, 0, 0])[:4]:
        write_varint(
            payload,
            scaled_int(value, BASE_ROUTING_COMPACT_COORDINATE_SCALE),
        )

    write_varuint(payload, len(nodes))
    for node in nodes:
        coord = node.get("coord") if isinstance(node, dict) else None
        if not isinstance(coord, list) or len(coord) < 2:
            raise ValueError(f"Compact shard node has invalid coord: {node}")
        write_varuint(payload, string_index[node["id"]])
        write_varint(payload, scaled_int(coord[0], BASE_ROUTING_COMPACT_COORDINATE_SCALE))
        write_varint(payload, scaled_int(coord[1], BASE_ROUTING_COMPACT_COORDINATE_SCALE))

    write_varuint(payload, len(edges))
    for edge in edges:
        if edge.get("from") not in node_index or edge.get("to") not in node_index:
            raise ValueError(f"Compact shard edge references missing node: {edge.get('id')}")
        coordinates = edge.get("coordinates")
        if not isinstance(coordinates, list) or len(coordinates) < 2:
            raise ValueError(f"Compact shard edge has invalid coordinates: {edge.get('id')}")

        write_varuint(payload, string_index[edge["id"]])
        write_varuint(payload, int(edge.get("shareId") or 0))
        write_varuint(payload, node_index[edge["from"]])
        write_varuint(payload, node_index[edge["to"]])
        write_varint(payload, scaled_int(edge.get("distanceMeters") or 0, BASE_ROUTING_COMPACT_DISTANCE_SCALE))

        write_varuint(payload, len(coordinates))
        previous_lng = None
        previous_lat = None
        for coord in coordinates:
            if not isinstance(coord, list) or len(coord) < 2:
                raise ValueError(f"Compact shard edge has invalid coordinate: {edge.get('id')}")
            lng = scaled_int(coord[0], BASE_ROUTING_COMPACT_COORDINATE_SCALE)
            lat = scaled_int(coord[1], BASE_ROUTING_COMPACT_COORDINATE_SCALE)
            if previous_lng is None or previous_lat is None:
                write_varint(payload, lng)
                write_varint(payload, lat)
            else:
                write_varint(payload, lng - previous_lng)
                write_varint(payload, lat - previous_lat)
            previous_lng = lng
            previous_lat = lat

        write_nullable_string_index(payload, string_index, edge.get("source"))
        write_nullable_string_index(payload, string_index, edge.get("routeClass"))
        write_nullable_string_index(payload, string_index, edge.get("highway"))
        write_nullable_string_index(payload, string_index, edge.get("accessStatus"))
        write_nullable_string_index(payload, string_index, edge.get("roadType"))

        cw_segment_ids = edge.get("cwSegmentIds") if isinstance(edge.get("cwSegmentIds"), list) else []
        write_varuint(payload, len(cw_segment_ids))
        for segment_id in cw_segment_ids:
            write_varuint(payload, int(segment_id))

        elevation = edge.get("elevation") if isinstance(edge.get("elevation"), dict) else None
        if elevation and isinstance(elevation.get("fromMeters"), (int, float)) and isinstance(elevation.get("toMeters"), (int, float)):
            write_varuint(payload, 1)
            write_varint(payload, scaled_int(elevation.get("fromMeters"), BASE_ROUTING_COMPACT_DISTANCE_SCALE))
            write_varint(payload, scaled_int(elevation.get("toMeters"), BASE_ROUTING_COMPACT_DISTANCE_SCALE))
            write_varint(payload, scaled_int(elevation.get("netMeters", elevation.get("toMeters") - elevation.get("fromMeters")), BASE_ROUTING_COMPACT_DISTANCE_SCALE))
        else:
            write_varuint(payload, 0)

        if format_version >= BASE_ROUTING_COMPACT_SHARD_POLICY_FORMAT_VERSION:
            traversal = (
                edge.get("bicycleTraversal")
                if isinstance(edge.get("bicycleTraversal"), dict)
                else {}
            )
            traversal_state_codes = {
                None: 0,
                "allowed": 1,
                "prohibited": 2,
                "conditional": 3,
                "unknown": 4,
            }
            write_varuint(payload, traversal_state_codes.get(traversal.get("forward"), 0))
            write_varuint(payload, traversal_state_codes.get(traversal.get("reverse"), 0))
            write_nullable_string_index(payload, string_index, traversal.get("policyId"))
            write_nullable_string_index(payload, string_index, traversal.get("policyDigest"))
            write_nullable_string_index(payload, string_index, traversal.get("forwardReason"))
            write_nullable_string_index(payload, string_index, traversal.get("reverseReason"))
            alignments = (
                edge.get("cwAlignments")
                if isinstance(edge.get("cwAlignments"), dict)
                else {}
            )
            for direction in ("forward", "reverse"):
                memberships = (
                    alignments.get(direction)
                    if isinstance(alignments.get(direction), list)
                    else []
                )
                write_varuint(payload, len(memberships))
                for membership in memberships:
                    write_varuint(payload, int(membership.get("segmentId") or 0))
                    write_nullable_string_index(
                        payload,
                        string_index,
                        membership.get("alignmentKey"),
                    )
                    write_nullable_string_index(
                        payload,
                        string_index,
                        membership.get("mappingDigest"),
                    )
            if format_version >= BASE_ROUTING_COMPACT_SHARD_JUNCTION_FORMAT_VERSION:
                junctions = edge.get("cwJunctions") if isinstance(edge.get("cwJunctions"), dict) else {}
                for direction in ("forward", "reverse"):
                    memberships = junctions.get(direction) if isinstance(junctions.get(direction), list) else []
                    write_varuint(payload, len(memberships))
                    for membership in memberships:
                        write_nullable_string_index(payload, string_index, membership.get("junctionId"))
                        write_nullable_string_index(payload, string_index, membership.get("fingerprint"))

    return bytes(payload)


def compact_shard_string_table(
    shard_asset: dict[str, Any],
    nodes: list[Any],
    edges: list[Any],
) -> list[str]:
    strings = {str(shard_asset.get("id") or "")}
    for node in nodes:
        if isinstance(node, dict) and isinstance(node.get("id"), str):
            strings.add(node["id"])
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        for key in ("id", "from", "to", "source", "routeClass", "highway", "accessStatus", "roadType"):
            value = edge.get(key)
            if isinstance(value, str) and value != "":
                strings.add(value)
        traversal = edge.get("bicycleTraversal")
        if isinstance(traversal, dict):
            for key in ("policyId", "policyDigest", "forwardReason", "reverseReason"):
                value = traversal.get(key)
                if isinstance(value, str) and value != "":
                    strings.add(value)
        alignments = edge.get("cwAlignments")
        if isinstance(alignments, dict):
            for direction in ("forward", "reverse"):
                for membership in alignments.get(direction) or []:
                    for key in ("alignmentKey", "mappingDigest"):
                        value = membership.get(key) if isinstance(membership, dict) else None
                        if isinstance(value, str) and value != "":
                            strings.add(value)
        junctions = edge.get("cwJunctions")
        if isinstance(junctions, dict):
            for direction in ("forward", "reverse"):
                for membership in junctions.get(direction) or []:
                    for key in ("junctionId", "fingerprint"):
                        value = membership.get(key) if isinstance(membership, dict) else None
                        if isinstance(value, str) and value != "":
                            strings.add(value)
    return sorted(strings)


def scaled_int(value: Any, scale: int) -> int:
    return int(round(float(value) * scale))


def write_nullable_string_index(
    payload: bytearray,
    string_index: dict[str, int],
    value: Any,
) -> None:
    if not isinstance(value, str) or value == "":
        write_varuint(payload, 0)
        return
    write_varuint(payload, string_index[value] + 1)


def write_varuint(payload: bytearray, value: int) -> None:
    if value < 0:
        raise ValueError(f"Varuint cannot encode negative value: {value}")
    while value >= 0x80:
        payload.append((value & 0x7F) | 0x80)
        value >>= 7
    payload.append(value)


def write_varint(payload: bytearray, value: int) -> None:
    write_varuint(payload, value * 2 if value >= 0 else (-value * 2) - 1)


def pack_messagepack_value(payload: bytearray, value: Any) -> None:
    if value is None:
        payload.append(0xC0)
        return
    if value is False:
        payload.append(0xC2)
        return
    if value is True:
        payload.append(0xC3)
        return
    if isinstance(value, int):
        pack_messagepack_int(payload, value)
        return
    if isinstance(value, float):
        payload.append(0xCB)
        payload.extend(struct.pack(">d", value))
        return
    if isinstance(value, str):
        pack_messagepack_str(payload, value)
        return
    if isinstance(value, (list, tuple)):
        pack_messagepack_array_header(payload, len(value))
        for item in value:
            pack_messagepack_value(payload, item)
        return
    if isinstance(value, dict):
        pack_messagepack_map_header(payload, len(value))
        for key, item in value.items():
            pack_messagepack_str(payload, str(key))
            pack_messagepack_value(payload, item)
        return
    raise TypeError(f"Cannot encode {type(value).__name__} as MessagePack")


def pack_messagepack_int(payload: bytearray, value: int) -> None:
    if 0 <= value <= 0x7F:
        payload.append(value)
    elif -32 <= value < 0:
        payload.append(0x100 + value)
    elif 0 <= value <= 0xFF:
        payload.extend((0xCC, value))
    elif 0 <= value <= 0xFFFF:
        payload.append(0xCD)
        payload.extend(struct.pack(">H", value))
    elif 0 <= value <= 0xFFFFFFFF:
        payload.append(0xCE)
        payload.extend(struct.pack(">I", value))
    elif 0 <= value <= 0xFFFFFFFFFFFFFFFF:
        payload.append(0xCF)
        payload.extend(struct.pack(">Q", value))
    elif -0x80 <= value < 0:
        payload.append(0xD0)
        payload.extend(struct.pack(">b", value))
    elif -0x8000 <= value < 0:
        payload.append(0xD1)
        payload.extend(struct.pack(">h", value))
    elif -0x80000000 <= value < 0:
        payload.append(0xD2)
        payload.extend(struct.pack(">i", value))
    elif -0x8000000000000000 <= value < 0:
        payload.append(0xD3)
        payload.extend(struct.pack(">q", value))
    else:
        raise OverflowError(f"Integer is outside MessagePack int64 range: {value}")


def pack_messagepack_str(payload: bytearray, value: str) -> None:
    encoded = value.encode("utf-8")
    length = len(encoded)
    if length <= 31:
        payload.append(0xA0 | length)
    elif length <= 0xFF:
        payload.extend((0xD9, length))
    elif length <= 0xFFFF:
        payload.append(0xDA)
        payload.extend(struct.pack(">H", length))
    elif length <= 0xFFFFFFFF:
        payload.append(0xDB)
        payload.extend(struct.pack(">I", length))
    else:
        raise OverflowError("String is too large for MessagePack str32")
    payload.extend(encoded)


def pack_messagepack_array_header(payload: bytearray, length: int) -> None:
    if length <= 15:
        payload.append(0x90 | length)
    elif length <= 0xFFFF:
        payload.append(0xDC)
        payload.extend(struct.pack(">H", length))
    elif length <= 0xFFFFFFFF:
        payload.append(0xDD)
        payload.extend(struct.pack(">I", length))
    else:
        raise OverflowError("Array is too large for MessagePack array32")


def pack_messagepack_map_header(payload: bytearray, length: int) -> None:
    if length <= 15:
        payload.append(0x80 | length)
    elif length <= 0xFFFF:
        payload.append(0xDE)
        payload.extend(struct.pack(">H", length))
    elif length <= 0xFFFFFFFF:
        payload.append(0xDF)
        payload.extend(struct.pack(">I", length))
    else:
        raise OverflowError("Map is too large for MessagePack map32")


def rounded_number(value: Any, decimals: int) -> Any:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    rounded = round(float(value), decimals)
    return 0.0 if rounded == -0.0 else rounded


def compact_site_coordinate(coord: Any) -> Any:
    if not isinstance(coord, list) or len(coord) < 2:
        return coord

    compacted = [
        rounded_number(coord[0], SITE_GEOJSON_COORDINATE_DECIMALS),
        rounded_number(coord[1], SITE_GEOJSON_COORDINATE_DECIMALS),
    ]
    if len(coord) >= 3:
        compacted.append(rounded_number(coord[2], SITE_GEOJSON_ELEVATION_DECIMALS))
    if len(coord) > 3:
        compacted.extend(coord[3:])
    return compacted


def compact_geojson_for_site(geojson_data: dict[str, Any]) -> dict[str, Any]:
    """Return the site GeoJSON artifact with compact coordinate precision."""
    compact_features = []
    for feature in geojson_data.get("features", []):
        if not isinstance(feature, dict):
            compact_features.append(feature)
            continue

        feature_copy = dict(feature)
        geometry = feature.get("geometry")
        if isinstance(geometry, dict) and geometry.get("type") == "LineString":
            geometry_copy = dict(geometry)
            geometry_copy["coordinates"] = [
                compact_site_coordinate(coord)
                for coord in geometry.get("coordinates", [])
            ]
            feature_copy["geometry"] = geometry_copy
        compact_features.append(feature_copy)

    compacted = dict(geojson_data)
    compacted["features"] = compact_features
    return compacted


def json_size_bytes(data: Any, *, compact: bool = False) -> int:
    if compact:
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    else:
        payload = json.dumps(data, indent=2, ensure_ascii=False)
    return len(payload.encode("utf-8")) + 1


def site_geojson_size_bytes(data: dict[str, Any]) -> int:
    features = data.get("features") if isinstance(data, dict) else None
    if not isinstance(features, list):
        return json_size_bytes(data)

    top_level_items = [
        f"{json_compact(key)}:{json_compact(value)}"
        for key, value in data.items()
        if key != "features"
    ]
    top_level_prefix = ",".join(top_level_items)
    if top_level_prefix:
        top_level_prefix += ',"features":['
    else:
        top_level_prefix = '"features":['
    feature_lines = ",\n".join(diffable_site_geojson_feature(feature) for feature in features)
    payload = f"{{{top_level_prefix}\n{feature_lines}\n]}}\n"
    return len(payload.encode("utf-8"))


def site_geojson_optimization_report(
    geojson_data: dict[str, Any],
    site_geojson_data: dict[str, Any],
) -> dict[str, Any]:
    pretty_bytes = json_size_bytes(geojson_data)
    compact_bytes = json_size_bytes(site_geojson_data, compact=True)
    diffable_bytes = site_geojson_size_bytes(site_geojson_data)
    reduction = 0.0
    if pretty_bytes:
        reduction = round((pretty_bytes - diffable_bytes) / pretty_bytes * 100, 2)
    return {
        "coordinateDecimals": SITE_GEOJSON_COORDINATE_DECIMALS,
        "elevationDecimals": SITE_GEOJSON_ELEVATION_DECIMALS,
        "previousPrettyBytes": pretty_bytes,
        "compactBytes": compact_bytes,
        "diffableBytes": diffable_bytes,
        "reductionPercent": reduction,
    }


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
    placeholder_segment_names: list[dict[str, Any]] = []
    for segment_name, data in segments_data.items():
        if not isinstance(data, dict):
            continue

        status = data.get("status", "active")
        active = not data.get("deprecated") and status not in {"deprecated", "draft", "legacy"}
        if active and PLACEHOLDER_SEGMENT_NAME_RE.fullmatch(str(segment_name).strip()):
            placeholder_segment_names.append(
                {
                    "segment": segment_name,
                    "id": data.get("id"),
                    "issue": "active segment still has a placeholder name",
                }
            )
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
        "placeholderSegmentNames": placeholder_segment_names,
        "activeSplitNumberedNames": active_split_numbered_names,
        "routeCompatibilityWarnings": route_compatibility_warnings(segments_data),
        "topology": endpoint_topology_report(geojson_data, threshold_m),
    }


def active_segment_ids(segments_data: dict[str, Any]) -> set[int]:
    ids: set[int] = set()
    for data in segments_data.values():
        if not isinstance(data, dict) or not isinstance(data.get("id"), int):
            continue
        status = data.get("status", "active")
        if data.get("deprecated") or status in {"deprecated", "draft", "legacy"}:
            continue
        ids.add(data["id"])
    return ids


def route_length_meters(coordinates: list[Any]) -> float:
    total = 0.0
    for index in range(len(coordinates) - 1):
        start = coordinates[index]
        end = coordinates[index + 1]
        if (
            not isinstance(start, list)
            or len(start) < 2
            or not isinstance(end, list)
            or len(end) < 2
            or not isinstance(start[0], (int, float))
            or not isinstance(start[1], (int, float))
            or not isinstance(end[0], (int, float))
            or not isinstance(end[1], (int, float))
        ):
            continue
        total += haversine((float(start[1]), float(start[0])), (float(end[1]), float(end[0])))
    return total


def source_segment_lengths(source_geojson: dict[str, Any] | None) -> dict[int, dict[str, Any]]:
    if not isinstance(source_geojson, dict):
        return {}

    lengths: dict[int, dict[str, Any]] = {}
    for feature in source_geojson.get("features", []):
        if not isinstance(feature, dict) or not is_active_source_feature(feature):
            continue
        properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
        segment_id = properties.get("id")
        geometry = feature.get("geometry") if isinstance(feature.get("geometry"), dict) else {}
        coordinates = geometry.get("coordinates")
        if not isinstance(segment_id, int) or not isinstance(coordinates, list):
            continue
        lengths[segment_id] = {
            "name": properties.get("name") or f"Segment {segment_id}",
            "lengthMeters": route_length_meters(coordinates),
        }
    return lengths


def routing_edge_distance_m(edge: dict[str, Any]) -> float:
    distance = edge.get("distanceMeters")
    if isinstance(distance, (int, float)) and distance >= 0:
        return float(distance)
    return route_length_meters(edge.get("coordinates", []))


def compact_routing_coordinate(coord: Any) -> list[float] | None:
    if not isinstance(coord, list) or len(coord) < 2:
        return None
    if not isinstance(coord[0], (int, float)) or not isinstance(coord[1], (int, float)):
        return None
    return [
        rounded_number(coord[0], SITE_GEOJSON_COORDINATE_DECIMALS),
        rounded_number(coord[1], SITE_GEOJSON_COORDINATE_DECIMALS),
    ]


def sorted_overlay_edge_refs(mapping: dict[str, Any]) -> list[dict[str, Any]]:
    edge_refs = [ref for ref in mapping.get("edgeRefs", []) if isinstance(ref, dict)]
    return sorted(
        edge_refs,
        key=lambda ref: (
            ref.get("sequenceIndex")
            if isinstance(ref.get("sequenceIndex"), int)
            else len(edge_refs),
            str(ref.get("edgeId") or ""),
        ),
    )


def oriented_routing_edge_nodes(edge: dict[str, Any], direction: str | None) -> tuple[str | None, str | None]:
    from_node_id = edge.get("fromNodeId")
    to_node_id = edge.get("toNodeId")
    if not isinstance(from_node_id, str) or not isinstance(to_node_id, str):
        return None, None
    if direction == "reverse":
        return to_node_id, from_node_id
    return from_node_id, to_node_id


def oriented_routing_edge_endpoints(
    edge: dict[str, Any],
    direction: str | None,
) -> tuple[list[float] | None, list[float] | None]:
    coordinates = [
        coord
        for coord in (
            compact_routing_coordinate(coord)
            for coord in edge.get("coordinates", [])
        )
        if coord is not None
    ]
    if len(coordinates) < 2:
        return None, None
    if direction == "reverse":
        return coordinates[-1], coordinates[0]
    return coordinates[0], coordinates[-1]


def routing_coordinate_distance_m(coord_a: list[float], coord_b: list[float]) -> float:
    return haversine((coord_a[1], coord_a[0]), (coord_b[1], coord_b[0]))


def ensure_current_routing_graph(
    graph_path: Path,
    manual_base_edges_path: Path,
    base_graph_path: Path | None = None,
) -> None:
    if not graph_path.exists():
        raise FileNotFoundError(f"Base routing graph not found: {graph_path}")
    if manual_base_edges_path.exists():
        graph_mtime = graph_path.stat().st_mtime
        manual_mtime = manual_base_edges_path.stat().st_mtime
        if graph_mtime + 1 < manual_mtime:
            raise ValueError(
                "Base routing graph is stale relative to manual base edges. "
                "Recalculate Graph + Matches before building."
            )
    if base_graph_path and graph_path.resolve() != base_graph_path.resolve():
        if not base_graph_path.exists():
            raise FileNotFoundError(f"Base routing source graph not found: {base_graph_path}")


def validate_elevated_routing_graph_source(
    graph: dict[str, Any],
    graph_path: Path,
    base_graph_path: Path | None,
) -> bool:
    if not base_graph_path or graph_path.resolve() == base_graph_path.resolve():
        return False
    elevation_metadata = ((graph.get("metadata") or {}).get("elevation") or {})
    source_digest = elevation_metadata.get("sourceGraphDigest")
    if not isinstance(source_digest, str):
        raise ValueError(
            "Elevated base routing graph is missing its source graph digest. "
            "Run `npm run osm:elevation` before Build."
        )
    if source_digest != file_digest(base_graph_path):
        raise ValueError(
            "Elevated base routing graph is stale relative to the current 2D "
            "base graph. Run `npm run osm:elevation` before Build."
        )
    return True


def compact_routing_elevation(edge: dict[str, Any]) -> dict[str, Any] | None:
    elevation = edge.get("elevation")
    if not isinstance(elevation, dict) or elevation.get("status") != "ready":
        return None
    profile = elevation.get("profile")
    if not isinstance(profile, list) or len(profile) < 2:
        return None
    from_elevation = profile[0][1] if isinstance(profile[0], list) and len(profile[0]) >= 2 else None
    to_elevation = profile[-1][1] if isinstance(profile[-1], list) and len(profile[-1]) >= 2 else None
    if not isinstance(from_elevation, (int, float)) or not isinstance(to_elevation, (int, float)):
        return None
    return {
        "fromMeters": rounded_number(from_elevation, 1),
        "toMeters": rounded_number(to_elevation, 1),
        "netMeters": rounded_number(float(to_elevation) - float(from_elevation), 1),
    }


def normalize_base_edge_share_id_registry(raw: Any) -> dict[str, Any]:
    raw_edges = raw.get("edges") if isinstance(raw, dict) else {}
    edges: dict[str, int] = {}
    if isinstance(raw_edges, dict):
        for edge_id, share_id in raw_edges.items():
            if not isinstance(edge_id, str) or edge_id == "":
                continue
            if isinstance(share_id, bool):
                continue
            if isinstance(share_id, int) and share_id > 0:
                edges[edge_id] = share_id

    next_share_id = raw.get("nextShareId") if isinstance(raw, dict) else None
    if not isinstance(next_share_id, int) or next_share_id <= 0:
        next_share_id = (max(edges.values()) + 1) if edges else 1

    return {
        "schemaVersion": BASE_ROUTING_SHARE_ID_SCHEMA_VERSION,
        "nextShareId": max(next_share_id, (max(edges.values()) + 1) if edges else 1),
        "edges": dict(sorted(edges.items())),
    }


def assign_base_edge_share_ids(
    edge_ids: list[str],
    registry_path: Path | None = None,
    proposal_path: Path | None = None,
) -> tuple[dict[str, int], dict[str, Any]]:
    unique_edge_ids = sorted(set(edge_id for edge_id in edge_ids if isinstance(edge_id, str) and edge_id))
    if registry_path is None:
        share_ids = {edge_id: index + 1 for index, edge_id in enumerate(unique_edge_ids)}
        return share_ids, {
            "schemaVersion": BASE_ROUTING_SHARE_ID_SCHEMA_VERSION,
            "runtimeEdges": len(unique_edge_ids),
            "totalIds": len(share_ids),
            "newIds": len(share_ids),
            "retiredIds": 0,
            "registry": None,
        }

    registry = normalize_base_edge_share_id_registry(load_json(registry_path, {}))
    existing_edges = dict(registry["edges"])
    next_share_id = int(registry["nextShareId"])
    new_ids = 0

    for edge_id in unique_edge_ids:
        if edge_id in existing_edges:
            continue
        existing_edges[edge_id] = next_share_id
        next_share_id += 1
        new_ids += 1

    proposed_registry = {
        "schemaVersion": BASE_ROUTING_SHARE_ID_SCHEMA_VERSION,
        "nextShareId": next_share_id,
        "edges": dict(sorted(existing_edges.items())),
    }
    staged_proposal_path = proposal_path
    if staged_proposal_path is None:
        staged_proposal_path = registry_path.with_name(
            f"{registry_path.stem}.proposal{registry_path.suffix}"
        )
    if new_ids > 0:
        # Released share-ID history is immutable during an ordinary build.  The
        # build may use the deterministic proposal in-memory, but publication
        # requires a separate review/promotion step.
        write_sorted_json(staged_proposal_path, proposed_registry)

    runtime_edge_set = set(unique_edge_ids)
    share_ids = {edge_id: existing_edges[edge_id] for edge_id in unique_edge_ids}
    retired_ids = sum(1 for edge_id in existing_edges if edge_id not in runtime_edge_set)
    return share_ids, {
        "schemaVersion": BASE_ROUTING_SHARE_ID_SCHEMA_VERSION,
        "runtimeEdges": len(unique_edge_ids),
        "totalIds": len(existing_edges),
        "newIds": new_ids,
        "retiredIds": retired_ids,
        "registry": str(registry_path),
        "proposal": str(staged_proposal_path) if new_ids > 0 else None,
        "releasedRegistryMutated": False,
    }


def accepted_v2_alignment_mappings(
    overlay: dict[str, Any],
    active_ids: set[int],
) -> list[dict[str, Any]]:
    mappings: list[dict[str, Any]] = []
    for raw_segment_id, segment in (overlay.get("segments") or {}).items():
        if not isinstance(segment, dict):
            continue
        segment_id = int(raw_segment_id)
        if segment_id not in active_ids:
            continue
        alignments = segment.get("alignments") or {}
        for alignment_key in ("aToB", "bToA"):
            record = (alignments.get(alignment_key) or {}).get("published")
            if not isinstance(record, dict) or record.get("disposition") != "accepted":
                continue
            realization = record.get("realization") or {}
            if realization.get("type") == "explicit":
                edge_refs = realization.get("edgeRefs") or []
            elif realization.get("type") == "reverseOf":
                target_key = realization.get("alignmentKey")
                target = (alignments.get(target_key) or {}).get("published") or {}
                target_realization = target.get("realization") or {}
                if target_realization.get("type") != "explicit":
                    raise ValueError(
                        f"V2 segment {segment_id} {alignment_key} reverseOf target is not explicit"
                    )
                if realization.get("referencedMappingDigest") != target.get("mappingDigest"):
                    raise ValueError(
                        f"V2 segment {segment_id} {alignment_key} reverseOf digest is stale"
                    )
                edge_refs = [
                    {
                        **ref,
                        "direction": (
                            "forward" if ref.get("direction") == "reverse" else "reverse"
                        ),
                        "sequenceIndex": index,
                    }
                    for index, ref in enumerate(reversed(target_realization.get("edgeRefs") or []))
                ]
            else:
                raise ValueError(
                    f"V2 segment {segment_id} {alignment_key} has invalid accepted realization"
                )
            mappings.append(
                {
                    "segmentId": segment_id,
                    "segmentName": segment.get("segmentName"),
                    "alignmentKey": alignment_key,
                    "mappingDigest": record.get("mappingDigest"),
                    "status": "accepted_v2_alignment",
                    "edgeRefs": edge_refs,
                }
            )
    return sorted(
        mappings,
        key=lambda value: (int(value["segmentId"]), str(value["alignmentKey"])),
    )


def build_base_routing_asset(
    graph_path: Path,
    overlay_path: Path,
    manual_base_edges_path: Path,
    segments_data: dict[str, Any],
    base_graph_path: Path | None = None,
    source_geojson: dict[str, Any] | None = None,
    base_edge_share_ids_path: Path | None = None,
    base_edge_share_id_proposal_path: Path | None = None,
    routing_profile: str = "production-v1",
) -> tuple[dict[str, Any], dict[str, Any]]:
    ensure_current_routing_graph(graph_path, manual_base_edges_path, base_graph_path)
    if not overlay_path.exists():
        raise FileNotFoundError(f"CW base overlay not found: {overlay_path}")

    graph = load_json(graph_path, {})
    elevated_graph_required = validate_elevated_routing_graph_source(
        graph,
        graph_path,
        base_graph_path,
    )
    overlay = load_json(overlay_path, {})
    overlay_schema_version = int(overlay.get("schemaVersion") or 1)
    if routing_profile == "production-v1" and overlay_schema_version != 1:
        raise ValueError("production-v1 routing profile requires a V1 overlay")
    if routing_profile == "staged-v2" and overlay_schema_version != 2:
        raise ValueError("staged-v2 routing profile requires a V2 overlay")
    if routing_profile not in {"production-v1", "staged-v2"}:
        raise ValueError(f"unknown routing profile: {routing_profile}")
    graph_edges = [
        edge
        for edge in graph.get("edges", [])
        if isinstance(edge, dict)
        and isinstance(edge.get("id"), str)
        and isinstance(edge.get("fromNodeId"), str)
        and isinstance(edge.get("toNodeId"), str)
    ]
    graph_nodes = [
        node
        for node in graph.get("nodes", [])
        if isinstance(node, dict) and isinstance(node.get("id"), str)
    ]
    if not graph_edges or not graph_nodes:
        raise ValueError(f"Base routing graph has no routable nodes or edges: {graph_path}")

    edges_by_id = {edge["id"]: edge for edge in graph_edges}
    active_ids = active_segment_ids(segments_data)
    accepted_mappings = (
        accepted_v2_alignment_mappings(overlay, active_ids)
        if routing_profile == "staged-v2"
        else [
            mapping
            for mapping in (overlay.get("segments") or {}).values()
            if (
                isinstance(mapping, dict)
                and mapping.get("status") in ("accepted_auto_match", "accepted_edge_set")
                and mapping.get("segmentId") in active_ids
            )
        ]
    )
    accepted_mappings.sort(key=lambda mapping: int(mapping.get("segmentId") or 0))

    blockers: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    owners_by_edge_id: dict[str, list[int]] = defaultdict(list)
    owners_by_directed_edge: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    accepted_segment_ids: set[int] = set()
    source_lengths = source_segment_lengths(source_geojson)

    for mapping in accepted_mappings:
        segment_id = mapping.get("segmentId")
        if not isinstance(segment_id, int):
            blockers.append({"issue": "accepted mapping is missing integer segmentId"})
            continue
        accepted_segment_ids.add(segment_id)
        edge_refs = sorted_overlay_edge_refs(mapping)
        previous_end_coord = None
        previous_end_node = None
        previous_edge_id = None
        accepted_length_m = 0.0
        has_edge_ref_blocker = False
        if not edge_refs:
            blockers.append(
                {
                    "segmentId": segment_id,
                    "issue": "accepted mapping has no edge refs",
                }
            )
            continue

        for ref_index, edge_ref in enumerate(edge_refs):
            edge_id = edge_ref.get("edgeId")
            if not isinstance(edge_id, str) or edge_id not in edges_by_id:
                blockers.append(
                    {
                        "segmentId": segment_id,
                        "edgeId": edge_id,
                        "issue": "accepted overlay edge ref does not resolve",
                    }
                )
                has_edge_ref_blocker = True
                previous_end_coord = None
                previous_end_node = None
                previous_edge_id = edge_id
                continue

            direction = "reverse" if edge_ref.get("direction") == "reverse" else "forward"
            if routing_profile == "staged-v2":
                owners_by_directed_edge[(edge_id, direction)].append(
                    {
                        "segmentId": segment_id,
                        "alignmentKey": mapping.get("alignmentKey"),
                        "mappingDigest": mapping.get("mappingDigest"),
                        "fromFraction": float(edge_ref.get("fromFraction", 0)),
                        "toFraction": float(edge_ref.get("toFraction", 1)),
                    }
                )
                edge_tags = (
                    edges_by_id[edge_id].get("tags")
                    if isinstance(edges_by_id[edge_id].get("tags"), dict)
                    else {}
                )
                edge_shadow = edges_by_id[edge_id].get("bicycleTraversalShadow")
                edge_policy = (
                    edge_shadow
                    if isinstance(edge_shadow, dict)
                    and edge_shadow.get("policyId") == POLICY_ID
                    and edge_shadow.get("policyDigest") == POLICY_DIGEST
                    else normalize_bicycle_traversal(
                        edge_tags,
                        source=str(edges_by_id[edge_id].get("source") or "osm"),
                        manual=edge_tags,
                    )
                )
                base_state = edge_policy[direction]
                base_reason = edge_policy[f"{direction}Reason"]
                access_precedence_eligible = cw_access_precedence_eligible(
                    base_state,
                    base_reason,
                )
                precedence_eligible = access_precedence_eligible and full_base_edge_ref(edge_ref)
                if base_state != "allowed" and not precedence_eligible:
                    blockers.append(
                        {
                            "segmentId": segment_id,
                            "alignmentKey": mapping.get("alignmentKey"),
                            "edgeId": edge_id,
                            "direction": direction,
                            "state": base_state,
                            "reason": (
                                "cw-precedence-requires-full-edge"
                                if access_precedence_eligible
                                else base_reason
                            ),
                            "issue": (
                                "accepted V2 alignment needs a base-edge split before CW precedence"
                                if access_precedence_eligible
                                else "accepted V2 alignment contains a non-allowed traversal"
                            ),
                        }
                    )
                    has_edge_ref_blocker = True
            else:
                owners_by_edge_id[edge_id].append(segment_id)
            accepted_length_m += routing_edge_distance_m(edges_by_id[edge_id])
            edge_start_node, edge_end_node = oriented_routing_edge_nodes(
                edges_by_id[edge_id],
                edge_ref.get("direction"),
            )
            if not edge_start_node or not edge_end_node:
                blockers.append(
                    {
                        "segmentId": segment_id,
                        "edgeId": edge_id,
                        "issue": "accepted edge ref has invalid graph topology",
                    }
                )
                has_edge_ref_blocker = True
                previous_end_coord = None
                previous_end_node = None
                previous_edge_id = edge_id
                continue
            edge_start_coord, edge_end_coord = oriented_routing_edge_endpoints(
                edges_by_id[edge_id],
                edge_ref.get("direction"),
            )
            if not edge_start_coord or not edge_end_coord:
                blockers.append(
                    {
                        "segmentId": segment_id,
                        "edgeId": edge_id,
                        "issue": "accepted edge ref has invalid coordinates",
                    }
                )
                has_edge_ref_blocker = True
                previous_end_coord = None
                previous_end_node = None
                previous_edge_id = edge_id
                continue
            topology_mismatch = (
                ref_index > 0
                and previous_end_node
                and edge_start_node
                and previous_end_node != edge_start_node
            )
            spatial_gap = (
                ref_index > 0
                and previous_end_coord
                and routing_coordinate_distance_m(previous_end_coord, edge_start_coord)
                > ROUTING_EDGE_CONTINUITY_GAP_M
            )
            if topology_mismatch or spatial_gap:
                blockers.append(
                    {
                        "segmentId": segment_id,
                        "fromEdgeId": previous_edge_id,
                        "toEdgeId": edge_id,
                        "fromNodeId": previous_end_node if topology_mismatch else None,
                        "toNodeId": edge_start_node if topology_mismatch else None,
                        "issue": (
                            "accepted overlay edge topology is disconnected"
                            if topology_mismatch
                            else "accepted overlay edge sequence is disconnected"
                        ),
                    }
                )
                has_edge_ref_blocker = True
            previous_end_coord = edge_end_coord
            previous_end_node = edge_end_node
            previous_edge_id = edge_id

        source_length = source_lengths.get(segment_id)
        source_length_m = source_length.get("lengthMeters") if source_length else None
        if (
            not has_edge_ref_blocker
            and isinstance(source_length_m, (int, float))
            and source_length_m > 0
            and accepted_length_m > 0
        ):
            length_ratio = accepted_length_m / float(source_length_m)
            length_issue = {
                "segmentId": segment_id,
                "segmentName": source_length.get("name") if source_length else mapping.get("segmentName"),
                "acceptedLengthMeters": round(accepted_length_m, 1),
                "sourceLengthMeters": round(float(source_length_m), 1),
                "lengthRatio": round(length_ratio, 3),
            }
            if (
                length_ratio < ACCEPTED_MAPPING_LENGTH_BLOCK_MIN_RATIO
                or length_ratio > ACCEPTED_MAPPING_LENGTH_BLOCK_MAX_RATIO
            ):
                blockers.append(
                    {
                        **length_issue,
                        "issue": "accepted mapping length differs from source segment",
                    }
                )
            elif (
                length_ratio < ACCEPTED_MAPPING_LENGTH_WARNING_MIN_RATIO
                or length_ratio > ACCEPTED_MAPPING_LENGTH_WARNING_MAX_RATIO
            ):
                warnings.append(
                    {
                        **length_issue,
                        "issue": "accepted mapping length is suspicious",
                    }
                )

    duplicate_edges = [
        {"edgeId": edge_id, "segmentIds": sorted(set(segment_ids))}
        for edge_id, segment_ids in sorted(owners_by_edge_id.items())
        if len(set(segment_ids)) > 1
    ]
    for duplicate in duplicate_edges:
        blockers.append(
            {
                **duplicate,
                "issue": "base edge is owned by more than one accepted CW segment",
            }
        )

    duplicate_directed_edges = [
        {
            "edgeId": edge_id,
            "direction": direction,
            "owners": owners,
        }
        for (edge_id, direction), owners in sorted(owners_by_directed_edge.items())
        if len({(owner["segmentId"], owner["alignmentKey"]) for owner in owners}) > 1
    ]
    for duplicate in duplicate_directed_edges:
        blockers.append(
            {
                **duplicate,
                "issue": "directed edge is owned by more than one accepted V2 alignment",
            }
        )

    unresolved_segment_ids = sorted(active_ids - accepted_segment_ids)
    for segment_id in unresolved_segment_ids:
        source_length = source_lengths.get(segment_id)
        issue = {
            "segmentId": segment_id,
            "segmentName": source_length.get("name") if source_length else None,
            "issue": "active segment has no accepted base overlay mapping",
        }
        if routing_profile == "staged-v2":
            warnings.append(issue)
        else:
            blockers.append(issue)

    if blockers:
        examples = "; ".join(
            json.dumps(blocker, ensure_ascii=False, separators=(",", ":"))
            for blocker in blockers[:5]
        )
        raise ValueError(
            f"Base routing overlay validation failed with {len(blockers)} blocker"
            f"{'' if len(blockers) == 1 else 's'}: {examples}"
        )

    runtime_nodes = []
    for node in graph_nodes:
        coord = compact_routing_coordinate(node.get("coord"))
        if coord is None:
            continue
        runtime_nodes.append({"id": node["id"], "coord": coord})

    runtime_edges = []
    traversal_shadow_states: Counter[str] = Counter()
    traversal_shadow_reasons: Counter[str] = Counter()
    missing_runtime_elevation_edge_ids = []
    for edge in graph_edges:
        coordinates = [
            coord
            for coord in (
                compact_routing_coordinate(coord)
                for coord in edge.get("coordinates", [])
            )
            if coord is not None
        ]
        if len(coordinates) < 2:
            continue
        tags = edge.get("tags") if isinstance(edge.get("tags"), dict) else {}
        existing_shadow = edge.get("bicycleTraversalShadow")
        traversal_shadow = (
            existing_shadow
            if isinstance(existing_shadow, dict)
            and existing_shadow.get("policyId") == POLICY_ID
            and existing_shadow.get("policyDigest") == POLICY_DIGEST
            else normalize_bicycle_traversal(
                tags,
                source=str(edge.get("source") or "osm"),
                manual=tags,
            )
        )
        for traversal_direction in ("forward", "reverse"):
            traversal_shadow_states[
                f"{traversal_direction}:{traversal_shadow[traversal_direction]}"
            ] += 1
            traversal_shadow_reasons[
                f"{traversal_direction}:{traversal_shadow[f'{traversal_direction}Reason']}"
            ] += 1
        runtime_edge = {
            "id": edge["id"],
            "from": edge["fromNodeId"],
            "to": edge["toNodeId"],
            "distanceMeters": rounded_number(edge.get("distanceMeters", 0), 1),
            "coordinates": coordinates,
            "source": edge.get("source") or "osm",
            "routeClass": tags.get("osmRouteClass") or ("manual" if edge.get("source") == "manual" else "other"),
            "highway": tags.get("highway"),
            "accessStatus": tags.get("accessStatus"),
            "roadType": tags.get("roadType"),
        }
        if routing_profile == "staged-v2":
            runtime_edge["cwAlignments"] = {
                direction: sorted(
                    owners_by_directed_edge.get((edge["id"], direction), []),
                    key=lambda value: (int(value["segmentId"]), str(value["alignmentKey"])),
                )
                for direction in ("forward", "reverse")
            }
            runtime_edge["bicycleTraversal"] = apply_accepted_cw_traversal_precedence(
                traversal_shadow,
                runtime_edge["cwAlignments"],
            )
        else:
            runtime_edge["cwSegmentIds"] = sorted(
                set(owners_by_edge_id.get(edge["id"], []))
            )
        runtime_elevation = compact_routing_elevation(edge)
        if runtime_elevation:
            runtime_edge["elevation"] = runtime_elevation
        elif elevated_graph_required:
            missing_runtime_elevation_edge_ids.append(edge["id"])
        runtime_edges.append(runtime_edge)

    share_ids_by_edge_id, share_id_validation = assign_base_edge_share_ids(
        [edge["id"] for edge in runtime_edges],
        base_edge_share_ids_path,
        base_edge_share_id_proposal_path,
    )
    effective_registry_path = (
        Path(share_id_validation["proposal"])
        if share_id_validation.get("proposal")
        else base_edge_share_ids_path
    )
    if effective_registry_path is not None and effective_registry_path.exists():
        share_id_validation["registryDigest"] = file_digest(effective_registry_path)
    for runtime_edge in runtime_edges:
        runtime_edge["shareId"] = share_ids_by_edge_id[runtime_edge["id"]]

    if missing_runtime_elevation_edge_ids:
        raise ValueError(
            "Elevated base routing graph has edges without ready endpoint "
            f"elevation: {missing_runtime_elevation_edge_ids[:10]}"
        )

    if not runtime_nodes or not runtime_edges:
        raise ValueError("Base routing asset would have no runtime nodes or edges")

    validation = {
        "graphNodes": len(runtime_nodes),
        "graphEdges": len(runtime_edges),
        "acceptedMappings": len(accepted_segment_ids),
        "cyclewaysEdges": sum(
            1
            for edge in runtime_edges
            if (
                any(edge.get("cwAlignments", {}).get(direction) for direction in ("forward", "reverse"))
                if routing_profile == "staged-v2"
                else edge.get("cwSegmentIds")
            )
        ),
        "elevationEdges": sum(1 for edge in runtime_edges if edge.get("elevation")),
        "shareIds": share_id_validation,
        "bicycleTraversalShadow": {
            "policyId": POLICY_ID,
            "policyDigest": POLICY_DIGEST,
            "states": dict(sorted(traversal_shadow_states.items())),
            "reasons": dict(sorted(traversal_shadow_reasons.items())),
            "enforced": routing_profile == "staged-v2",
        },
        "unresolvedSegmentIds": unresolved_segment_ids,
        "unresolvedSegments": len(unresolved_segment_ids),
        "duplicateAcceptedEdges": len(duplicate_edges),
        "duplicateAcceptedDirectedEdges": len(duplicate_directed_edges),
        "routingProfile": routing_profile,
        "warnings": warnings,
        "blockers": [],
    }
    routing_contract = None
    if routing_profile == "staged-v2":
        legacy_compatibility_metadata = load_json(
            ROUTING_COMPAT_DIR / "cw-base-index-v1.metadata.json", {}
        )
        legacy_registry_digest = legacy_compatibility_metadata.get(
            "baseEdgeShareRegistryDigest"
        )
        legacy_graph_hash = legacy_compatibility_metadata.get(
            "legacyGraphVersionHash"
        )
        if not legacy_registry_digest or not legacy_graph_hash:
            raise ValueError("staged V3 build requires released legacy compatibility metadata")
        semantic_components = {
            "graph": {"nodes": graph_nodes, "edges": graph_edges},
            "policyId": POLICY_ID,
            "policyDigest": POLICY_DIGEST,
            "overlay": overlay,
            "shareIdSchemaVersion": BASE_ROUTING_SHARE_ID_SCHEMA_VERSION,
            "baseEdgeShareRegistryDigest": share_id_validation.get(
                "registryDigest"
            ),
            "runtimeSchemaVersion": 3,
        }
        routing_context_digest = hashlib.sha256(
            json.dumps(
                semantic_components,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        routing_contract = {
            "schemaVersion": 1,
            "baseRoutingSchemaVersion": 3,
            "policyId": POLICY_ID,
            "policyDigest": POLICY_DIGEST,
            "routingContextDigest": routing_context_digest,
            "strictTraversalPolicy": True,
            "baseEdgeShareRegistryDigest": share_id_validation.get(
                "registryDigest"
            ),
            "legacyCompatibilityRegistryDigest": legacy_registry_digest,
            "legacyCompatibilityGraphVersionHashes": {
                str(legacy_graph_hash).lower(): legacy_registry_digest
            },
            "legacyCwBaseIndexSha256": legacy_compatibility_metadata.get(
                "sourceSha256"
            ),
        }
    asset = {
        "schemaVersion": 3 if routing_profile == "staged-v2" else 2,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "nodes": runtime_nodes,
        "edges": runtime_edges,
        "summary": {
            "nodes": len(runtime_nodes),
            "edges": len(runtime_edges),
            "cyclewaysEdges": validation["cyclewaysEdges"],
            "elevationEdges": validation["elevationEdges"],
            "acceptedMappings": validation["acceptedMappings"],
            "unresolvedSegments": validation["unresolvedSegments"],
        },
    }
    if routing_contract is not None:
        asset["graphVersion"] = routing_contract["routingContextDigest"]
        asset["policyId"] = POLICY_ID
        asset["policyDigest"] = POLICY_DIGEST
        asset["routingContract"] = routing_contract
    return asset, validation


def base_routing_edge_bounds(edge: dict[str, Any]) -> list[float] | None:
    coordinates = [
        coordinate
        for coordinate in edge.get("coordinates", [])
        if (
            isinstance(coordinate, list)
            and len(coordinate) >= 2
            and isinstance(coordinate[0], (int, float))
            and isinstance(coordinate[1], (int, float))
        )
    ]
    if len(coordinates) < 2:
        return None
    longitudes = [float(coordinate[0]) for coordinate in coordinates]
    latitudes = [float(coordinate[1]) for coordinate in coordinates]
    return [
        min(longitudes),
        min(latitudes),
        max(longitudes),
        max(latitudes),
    ]


def base_routing_shard_cell(value: float, shard_size_degrees: float) -> int:
    return math.floor(float(value) / shard_size_degrees)


def base_routing_shard_id(lng_cell: int, lat_cell: int) -> str:
    return f"g{lng_cell}_{lat_cell}"


def base_routing_shard_bounds(
    lng_cell: int,
    lat_cell: int,
    shard_size_degrees: float,
) -> list[float]:
    return [
        rounded_number(lng_cell * shard_size_degrees, SITE_GEOJSON_COORDINATE_DECIMALS),
        rounded_number(lat_cell * shard_size_degrees, SITE_GEOJSON_COORDINATE_DECIMALS),
        rounded_number((lng_cell + 1) * shard_size_degrees, SITE_GEOJSON_COORDINATE_DECIMALS),
        rounded_number((lat_cell + 1) * shard_size_degrees, SITE_GEOJSON_COORDINATE_DECIMALS),
    ]


def base_routing_shard_cells(
    bounds: list[float],
    shard_size_degrees: float,
) -> list[tuple[int, int]]:
    min_lng_cell = base_routing_shard_cell(bounds[0], shard_size_degrees)
    min_lat_cell = base_routing_shard_cell(bounds[1], shard_size_degrees)
    max_lng_cell = base_routing_shard_cell(bounds[2], shard_size_degrees)
    max_lat_cell = base_routing_shard_cell(bounds[3], shard_size_degrees)
    return [
        (lng_cell, lat_cell)
        for lng_cell in range(min_lng_cell, max_lng_cell + 1)
        for lat_cell in range(min_lat_cell, max_lat_cell + 1)
    ]


def build_base_routing_shards(
    base_routing_asset: dict[str, Any],
    shard_size_degrees: float = BASE_ROUTING_SHARD_SIZE_DEGREES,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], dict[str, Any]]:
    """Partition a runtime base-routing asset into static spatial shards."""
    if shard_size_degrees <= 0:
        raise ValueError("Base routing shard size must be positive")

    runtime_nodes = [
        node
        for node in base_routing_asset.get("nodes", [])
        if isinstance(node, dict) and isinstance(node.get("id"), str)
    ]
    runtime_edges = [
        edge
        for edge in base_routing_asset.get("edges", [])
        if isinstance(edge, dict) and isinstance(edge.get("id"), str)
    ]
    nodes_by_id = {node["id"]: node for node in runtime_nodes}
    shards: dict[str, dict[str, Any]] = {}
    source_edge_shards: dict[str, list[str]] = defaultdict(list)

    for edge in runtime_edges:
        edge_bounds = base_routing_edge_bounds(edge)
        if edge_bounds is None:
            continue
        from_node_id = edge.get("from")
        to_node_id = edge.get("to")
        if from_node_id not in nodes_by_id or to_node_id not in nodes_by_id:
            raise ValueError(
                "Base routing shard builder cannot resolve edge endpoint nodes: "
                f"{edge['id']}"
            )

        for lng_cell, lat_cell in base_routing_shard_cells(edge_bounds, shard_size_degrees):
            shard_id = base_routing_shard_id(lng_cell, lat_cell)
            shard = shards.setdefault(
                shard_id,
                {
                    "id": shard_id,
                    "bounds": base_routing_shard_bounds(
                        lng_cell,
                        lat_cell,
                        shard_size_degrees,
                    ),
                    "nodes": {},
                    "edges": {},
                },
            )
            shard["edges"][edge["id"]] = edge
            shard["nodes"][from_node_id] = nodes_by_id[from_node_id]
            shard["nodes"][to_node_id] = nodes_by_id[to_node_id]
            source_edge_shards[edge["id"]].append(shard_id)

    if not shards:
        raise ValueError("Base routing shard builder produced no shards")

    shard_assets: dict[str, dict[str, Any]] = {}
    manifest_shards = []
    for shard_id, shard in sorted(shards.items()):
        shard_nodes = [
            shard["nodes"][node_id]
            for node_id in sorted(shard["nodes"])
        ]
        shard_edges = [
            shard["edges"][edge_id]
            for edge_id in sorted(shard["edges"])
        ]
        shard_asset = {
            "schemaVersion": BASE_ROUTING_SHARD_SCHEMA_VERSION,
            "sourceRoutingSchemaVersion": base_routing_asset.get("schemaVersion"),
            "id": shard_id,
            "bounds": shard["bounds"],
            "nodes": shard_nodes,
            "edges": shard_edges,
            "summary": {
                "nodes": len(shard_nodes),
                "edges": len(shard_edges),
            },
        }
        compact_bytes = json_size_bytes(shard_asset, compact=True)
        messagepack_bytes = len(messagepack_pack(shard_asset))
        compact_binary_payload = pack_compact_base_routing_shard(shard_asset)
        compact_binary_bytes = len(compact_binary_payload)
        compact_binary_hash = hashlib.sha256(compact_binary_payload).hexdigest()
        shard_assets[shard_id] = shard_asset
        manifest_shards.append(
            {
                "id": shard_id,
                "path": f"shards/{shard_id}.cwb",
                "format": "compact",
                "formats": {
                    "compact": {
                        "path": f"shards/{shard_id}.cwb",
                        "bytes": compact_binary_bytes,
                        "sha256": compact_binary_hash,
                    }
                },
                "bounds": shard["bounds"],
                "nodes": len(shard_nodes),
                "edges": len(shard_edges),
                "compactBytes": compact_bytes,
                "messagePackBytes": messagepack_bytes,
                "compactBinaryBytes": compact_binary_bytes,
            }
        )

    source_edge_count = len(runtime_edges)
    represented_edge_count = len(source_edge_shards)
    duplicated_edge_ids = sorted(
        edge_id
        for edge_id, shard_ids in source_edge_shards.items()
        if len(set(shard_ids)) > 1
    )
    edge_references = sum(len(set(shard_ids)) for shard_ids in source_edge_shards.values())
    summary = {
        "shards": len(manifest_shards),
        "sourceNodes": len(runtime_nodes),
        "sourceEdges": source_edge_count,
        "representedEdges": represented_edge_count,
        "edgeReferences": edge_references,
        "duplicatedSourceEdges": len(duplicated_edge_ids),
        "compactShardBytes": sum(shard["compactBytes"] for shard in manifest_shards),
        "messagePackShardBytes": sum(
            shard["messagePackBytes"] for shard in manifest_shards
        ),
        "compactBinaryShardBytes": sum(
            shard["compactBinaryBytes"] for shard in manifest_shards
        ),
    }
    manifest = {
        "schemaVersion": BASE_ROUTING_SHARD_MANIFEST_SCHEMA_VERSION,
        "shardSchemaVersion": BASE_ROUTING_SHARD_SCHEMA_VERSION,
        "generatedAt": base_routing_asset.get("generatedAt"),
        "sourceRoutingSchemaVersion": base_routing_asset.get("schemaVersion"),
        "defaultFormat": "compact",
        "routeShare": {
            "edgeShareIdSchemaVersion": BASE_ROUTING_SHARE_ID_SCHEMA_VERSION,
            "edgeShareIds": "embedded-in-shards",
        },
        "scheme": {
            "type": "lng-lat-grid",
            "shardSizeDegrees": shard_size_degrees,
            "edgeBoundaryPolicy": "duplicate-edge-bbox-intersections",
        },
        "summary": summary,
        "shards": manifest_shards,
    }
    if int(base_routing_asset.get("schemaVersion") or 0) >= 3:
        manifest.update(
            {
                "graphVersion": base_routing_asset.get("graphVersion"),
                "policyId": base_routing_asset.get("policyId"),
                "policyDigest": base_routing_asset.get("policyDigest"),
                "routingContract": base_routing_asset.get("routingContract"),
            }
        )
    report = {
        "manifest": {
            "schemaVersion": manifest["schemaVersion"],
            "shardSchemaVersion": manifest["shardSchemaVersion"],
            "routeShare": manifest["routeShare"],
            "scheme": manifest["scheme"],
        },
        "summary": summary,
        "largestShards": sorted(
            (
                {
                    "id": shard["id"],
                    "nodes": shard["nodes"],
                    "edges": shard["edges"],
                }
                for shard in manifest_shards
            ),
            key=lambda shard: (-shard["edges"], -shard["nodes"], shard["id"]),
        )[:20],
        "duplicatedSourceEdgeExamples": duplicated_edge_ids[:20],
    }
    return manifest, shard_assets, report


def write_base_routing_shards(
    output_dir: Path,
    base_routing_asset: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    manifest, shard_assets, report = build_base_routing_shards(base_routing_asset)
    manifest_path = output_dir / "manifest.json"
    report_path = output_dir / "report.json"
    shards_dir = output_dir / "shards"
    if shards_dir.exists():
        shutil.rmtree(shards_dir)
    write_json(manifest_path, manifest)
    write_json(report_path, report)
    for shard_id, shard_asset in shard_assets.items():
        write_compact_base_routing_shard(shards_dir / f"{shard_id}.cwb", shard_asset)

    return {
        "manifest": str(manifest_path),
        "report": str(report_path),
        "shardsDirectory": str(shards_dir),
    }, report["summary"]


def public_feature_segment_id(
    feature: dict[str, Any],
    segments_data: dict[str, Any],
) -> int | None:
    properties = feature.get("properties")
    if not isinstance(properties, dict):
        return None

    segment_id = properties.get("id")
    if isinstance(segment_id, int) and not isinstance(segment_id, bool):
        return segment_id

    segment_name = properties.get("name")
    segment_data = segments_data.get(segment_name) if isinstance(segment_name, str) else None
    metadata_id = segment_data.get("id") if isinstance(segment_data, dict) else None
    if isinstance(metadata_id, int) and not isinstance(metadata_id, bool):
        return metadata_id
    return None


def oriented_public_edge_coordinates(
    edge: dict[str, Any],
    direction: str | None,
) -> list[list[float]]:
    coordinates = [
        coord
        for coord in (
            compact_routing_coordinate(coord)
            for coord in edge.get("coordinates", [])
        )
        if coord is not None
    ]
    return list(reversed(coordinates)) if direction == "reverse" else coordinates


def append_public_edge_coordinates(
    assembled_coordinates: list[list[float]],
    edge_coordinates: list[list[float]],
) -> None:
    if not edge_coordinates:
        return
    start_index = 0
    if assembled_coordinates and assembled_coordinates[-1] == edge_coordinates[0]:
        start_index = 1
    assembled_coordinates.extend(edge_coordinates[start_index:])


def source_elevation_samples(source_coordinates: Any) -> list[list[float]]:
    if not isinstance(source_coordinates, list):
        return []
    samples = []
    for coord in source_coordinates:
        if (
            isinstance(coord, list)
            and len(coord) >= 3
            and isinstance(coord[0], (int, float))
            and isinstance(coord[1], (int, float))
            and isinstance(coord[2], (int, float))
        ):
            samples.append([float(coord[0]), float(coord[1]), float(coord[2])])
    return samples


def closest_source_elevation(
    coordinate: list[float],
    source_coordinates: list[list[float]],
) -> float | None:
    if not source_coordinates:
        return None
    if len(source_coordinates) == 1:
        return source_coordinates[0][2]

    closest_elevation = None
    closest_distance = math.inf
    for index in range(1, len(source_coordinates)):
        start = source_coordinates[index - 1]
        end = source_coordinates[index]
        delta_lng = end[0] - start[0]
        delta_lat = end[1] - start[1]
        length_squared = delta_lng * delta_lng + delta_lat * delta_lat
        if length_squared == 0:
            fraction = 0.0
        else:
            fraction = (
                (coordinate[0] - start[0]) * delta_lng
                + (coordinate[1] - start[1]) * delta_lat
            ) / length_squared
            fraction = max(0.0, min(1.0, fraction))

        projected = [
            start[0] + delta_lng * fraction,
            start[1] + delta_lat * fraction,
        ]
        distance = routing_coordinate_distance_m(coordinate, projected)
        if distance < closest_distance:
            closest_distance = distance
            closest_elevation = start[2] + (end[2] - start[2]) * fraction

    return closest_elevation


def drape_source_elevations_on_public_coordinates(
    display_coordinates: list[list[float]],
    source_coordinates: Any,
) -> list[list[float]]:
    source_samples = source_elevation_samples(source_coordinates)
    if not source_samples:
        return display_coordinates

    draped_coordinates = []
    for coordinate in display_coordinates:
        elevation = closest_source_elevation(coordinate, source_samples)
        if elevation is None:
            draped_coordinates.append(coordinate)
            continue
        draped_coordinates.append(
            [
                coordinate[0],
                coordinate[1],
                rounded_number(elevation, SITE_GEOJSON_ELEVATION_DECIMALS),
            ]
        )
    return draped_coordinates


def build_public_cycleways_display_geojson(
    source_geojson: dict[str, Any],
    base_routing_asset: dict[str, Any],
    overlay_path: Path,
    segments_data: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Replace accepted public CycleWays feature geometry with overlay edge geometry."""
    if not overlay_path.exists():
        raise FileNotFoundError(f"CW base overlay not found: {overlay_path}")

    overlay = load_json(overlay_path, {})
    active_ids = active_segment_ids(segments_data)
    accepted_mappings_by_segment_id = {
        mapping["segmentId"]: mapping
        for mapping in (overlay.get("segments") or {}).values()
        if (
            isinstance(mapping, dict)
            and isinstance(mapping.get("segmentId"), int)
            and mapping.get("segmentId") in active_ids
            and mapping.get("status") in ("accepted_auto_match", "accepted_edge_set")
        )
    }
    runtime_edges_by_id = {
        edge["id"]: edge
        for edge in base_routing_asset.get("edges", [])
        if isinstance(edge, dict) and isinstance(edge.get("id"), str)
    }

    output_features: list[dict[str, Any]] = []
    derived_segment_ids: list[int] = []
    source_fallback_segment_ids: list[int] = []
    source_fallback_names: list[str] = []
    rendered_segment_ids: set[int] = set()

    for feature in source_geojson.get("features", []):
        if not isinstance(feature, dict):
            output_features.append(feature)
            continue

        geometry = feature.get("geometry")
        if not isinstance(geometry, dict) or geometry.get("type") != "LineString":
            output_features.append(feature)
            continue

        feature_copy = dict(feature)
        segment_id = public_feature_segment_id(feature, segments_data)
        mapping = accepted_mappings_by_segment_id.get(segment_id)
        if not mapping:
            output_features.append(feature_copy)
            if segment_id in active_ids:
                source_fallback_segment_ids.append(segment_id)
                source_fallback_names.append(
                    str(feature.get("properties", {}).get("name") or segment_id)
                )
            continue

        assembled_coordinates: list[list[float]] = []
        for edge_ref in sorted_overlay_edge_refs(mapping):
            edge_id = edge_ref.get("edgeId")
            edge = runtime_edges_by_id.get(edge_id)
            if edge is None:
                raise ValueError(
                    "Public CycleWays display geometry has an accepted edge ref "
                    f"that does not resolve: segment {segment_id}, edge {edge_id}"
                )
            append_public_edge_coordinates(
                assembled_coordinates,
                oriented_public_edge_coordinates(edge, edge_ref.get("direction")),
            )

        if len(assembled_coordinates) < 2:
            raise ValueError(
                "Public CycleWays display geometry has an accepted mapping with "
                f"no renderable edge coordinates: segment {segment_id}"
            )

        feature_copy["geometry"] = {
            **geometry,
            "coordinates": drape_source_elevations_on_public_coordinates(
                assembled_coordinates,
                geometry.get("coordinates"),
            ),
        }
        output_features.append(feature_copy)
        derived_segment_ids.append(segment_id)
        rendered_segment_ids.add(segment_id)

    unrendered_accepted_segment_ids = sorted(
        set(accepted_mappings_by_segment_id) - rendered_segment_ids
    )
    if unrendered_accepted_segment_ids:
        raise ValueError(
            "Public CycleWays display geometry could not find source features for "
            f"accepted segments: {unrendered_accepted_segment_ids[:10]}"
        )

    output = dict(source_geojson)
    output["features"] = output_features
    validation = {
        "derivedSegments": len(derived_segment_ids),
        "derivedSegmentIds": sorted(derived_segment_ids),
        "sourceFallbackSegments": len(source_fallback_segment_ids),
        "sourceFallbackSegmentIds": sorted(source_fallback_segment_ids),
        "sourceFallbackNames": source_fallback_names[:20],
        "unrenderedAcceptedSegmentIds": [],
    }
    return output, validation


def build_public_cw_base_index(
    base_routing_asset: dict[str, Any],
    overlay_path: Path,
    segments_data: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    if not overlay_path.exists():
        raise FileNotFoundError(f"CW base overlay not found: {overlay_path}")

    overlay = load_json(overlay_path, {})
    active_ids = active_segment_ids(segments_data)
    runtime_edges_by_id = {
        edge["id"]: edge
        for edge in base_routing_asset.get("edges", [])
        if isinstance(edge, dict) and isinstance(edge.get("id"), str)
    }
    segments: dict[str, Any] = {}
    missing_share_ids: list[dict[str, Any]] = []

    overlay_schema_version = int(overlay.get("schemaVersion") or 1)
    accepted_mappings = (
        accepted_v2_alignment_mappings(overlay, active_ids)
        if overlay_schema_version == 2
        else [
            mapping
            for mapping in (overlay.get("segments") or {}).values()
            if (
                isinstance(mapping, dict)
                and isinstance(mapping.get("segmentId"), int)
                and mapping.get("segmentId") in active_ids
                and mapping.get("status") in ("accepted_auto_match", "accepted_edge_set")
            )
        ]
    )
    accepted_mappings.sort(key=lambda mapping: int(mapping.get("segmentId") or 0))

    for mapping in accepted_mappings:
        segment_id = int(mapping["segmentId"])
        edge_refs = []
        alignment_shard_ids: set[str] = set()
        for edge_ref in sorted_overlay_edge_refs(mapping):
            edge_id = edge_ref.get("edgeId")
            runtime_edge = runtime_edges_by_id.get(edge_id)
            share_id = runtime_edge.get("shareId") if runtime_edge else None
            if not isinstance(share_id, int) or share_id <= 0:
                missing_share_ids.append(
                    {"segmentId": segment_id, "edgeId": edge_id}
                )
                continue
            direction_bit = 1 if edge_ref.get("direction") == "reverse" else 0
            edge_refs.append([share_id, direction_bit])
            if overlay_schema_version == 2 and runtime_edge:
                bounds = base_routing_edge_bounds(runtime_edge)
                if bounds is not None:
                    alignment_shard_ids.update(
                        base_routing_shard_id(lng_cell, lat_cell)
                        for lng_cell, lat_cell in base_routing_shard_cells(
                            bounds,
                            BASE_ROUTING_SHARD_SIZE_DEGREES,
                        )
                    )
        if edge_refs:
            if overlay_schema_version == 2:
                segment_entry = segments.setdefault(
                    str(segment_id),
                    {"segmentId": segment_id, "alignments": {}},
                )
                segment_entry["alignments"][mapping["alignmentKey"]] = {
                    "disposition": "accepted",
                    "mappingDigest": mapping.get("mappingDigest"),
                    "edgeRefs": edge_refs,
                    "shardIds": sorted(alignment_shard_ids),
                }
            else:
                segments[str(segment_id)] = edge_refs

    if missing_share_ids:
        examples = "; ".join(
            json.dumps(item, ensure_ascii=False, separators=(",", ":"))
            for item in missing_share_ids[:5]
        )
        raise ValueError(
            "Public CW base index has edge refs without share IDs: "
            f"{examples}"
        )

    if overlay_schema_version == 2:
        for raw_segment_id, overlay_segment in (overlay.get("segments") or {}).items():
            segment_id = int(raw_segment_id)
            if segment_id not in active_ids or not isinstance(overlay_segment, dict):
                continue
            entry = segments.setdefault(
                str(segment_id),
                {"segmentId": segment_id, "alignments": {}},
            )
            entry["routingDisposition"] = overlay_segment.get("routingDisposition")
            entry["endpoints"] = overlay_segment.get("endpoints")
            for alignment_key in ("aToB", "bToA"):
                if alignment_key in entry["alignments"]:
                    continue
                published = (
                    (overlay_segment.get("alignments") or {})
                    .get(alignment_key, {})
                    .get("published")
                )
                if isinstance(published, dict) and published.get("disposition") == "unavailable":
                    entry["alignments"][alignment_key] = {
                        "disposition": "unavailable",
                        "unavailableReasonCode": published.get("unavailableReasonCode"),
                    }
                else:
                    entry["alignments"][alignment_key] = {"disposition": "needs_review"}

    index = {
        "schemaVersion": 2 if overlay_schema_version == 2 else 1,
        "edgeShareIdSchemaVersion": BASE_ROUTING_SHARE_ID_SCHEMA_VERSION,
        "segments": segments,
    }
    if overlay_schema_version == 2:
        index["policyId"] = base_routing_asset.get("policyId")
        index["policyDigest"] = base_routing_asset.get("policyDigest")
        index["routingContextDigest"] = (
            base_routing_asset.get("routingContract") or {}
        ).get("routingContextDigest")
    validation = {
        "segments": len(segments),
        "alignments": (
            sum(
                1
                for segment in segments.values()
                for alignment in segment.get("alignments", {}).values()
                if alignment.get("disposition") == "accepted"
            )
            if overlay_schema_version == 2
            else len(segments)
        ),
        "edgeRefs": (
            sum(
                len(alignment.get("edgeRefs") or [])
                for segment in segments.values()
                for alignment in segment.get("alignments", {}).values()
            )
            if overlay_schema_version == 2
            else sum(len(edge_refs) for edge_refs in segments.values())
        ),
    }
    return index, validation


def build_public_cw_alignment_geometry(
    base_routing_asset: dict[str, Any],
    overlay_path: Path,
    segments_data: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Project each accepted V2 alignment into a direction-detail map layer."""
    overlay = load_json(overlay_path, {})
    if int(overlay.get("schemaVersion") or 1) != 2:
        return {"schemaVersion": 1, "type": "FeatureCollection", "features": []}, {
            "alignments": 0,
            "edgeRefs": 0,
        }

    runtime_edges = {
        edge["id"]: edge
        for edge in base_routing_asset.get("edges", [])
        if isinstance(edge, dict) and isinstance(edge.get("id"), str)
    }
    mappings = accepted_v2_alignment_mappings(overlay, active_segment_ids(segments_data))
    features = []
    for mapping in mappings:
        coordinates: list[list[float]] = []
        refs = sorted_overlay_edge_refs(mapping)
        for ref in refs:
            edge = runtime_edges.get(ref.get("edgeId"))
            if edge is None:
                raise ValueError(
                    "CW alignment geometry references a missing runtime edge: "
                    f"{mapping['segmentId']} {mapping['alignmentKey']} {ref.get('edgeId')}"
                )
            append_public_edge_coordinates(
                coordinates,
                oriented_public_edge_coordinates(edge, ref.get("direction")),
            )
        if len(coordinates) < 2:
            raise ValueError(
                "CW alignment geometry contains no renderable coordinates: "
                f"{mapping['segmentId']} {mapping['alignmentKey']}"
            )
        segment = (overlay.get("segments") or {}).get(str(mapping["segmentId"])) or {}
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "segmentId": mapping["segmentId"],
                    "segmentName": mapping.get("segmentName"),
                    "alignmentKey": mapping["alignmentKey"],
                    "mappingDigest": mapping.get("mappingDigest"),
                    "endpoints": segment.get("endpoints"),
                },
                "geometry": {"type": "LineString", "coordinates": coordinates},
            }
        )
    return {
        "schemaVersion": 1,
        "policyId": base_routing_asset.get("policyId"),
        "policyDigest": base_routing_asset.get("policyDigest"),
        "routingContextDigest": (base_routing_asset.get("routingContract") or {}).get(
            "routingContextDigest"
        ),
        "type": "FeatureCollection",
        "features": features,
    }, {
        "alignments": len(features),
        "edgeRefs": sum(
            len(sorted_overlay_edge_refs(mapping)) for mapping in mappings
        ),
    }


def write_runtime_manifest(
    public_data_dir: Path,
    output_geojson: Path,
    output_segments: Path,
    output_cw_base_index: Path,
    output_kml: Path,
    output_base_routing_shards: Path,
    elevation_stats: dict[str, Any],
    validation: dict[str, Any],
    output_roundabouts: Path | None = None,
    output_crossings: Path | None = None,
    output_junctions: Path | None = None,
    output_cw_alignment_geometry: Path | None = None,
    legacy_compatibility: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], Path]:
    base_routing_shard_manifest = output_base_routing_shards / "manifest.json"
    version_inputs = [
            output_geojson,
            output_segments,
            output_cw_base_index,
            output_kml,
            base_routing_shard_manifest,
        ]
    if output_roundabouts and output_roundabouts.exists():
        version_inputs.append(output_roundabouts)
    if output_crossings and output_crossings.exists():
        version_inputs.append(output_crossings)
    if output_junctions and output_junctions.exists():
        version_inputs.append(output_junctions)
    if output_cw_alignment_geometry and output_cw_alignment_geometry.exists():
        version_inputs.append(output_cw_alignment_geometry)
    if legacy_compatibility:
        version_inputs.extend(
            Path(value)
            for key, value in legacy_compatibility.items()
            if key.endswith("Path")
        )
    version = combined_digest(version_inputs)[:12]
    manifest_path = public_data_dir / "map-manifest.json"

    # Enforced V3 releases are immutable bundles. Keep the stable build outputs
    # as convenient local inspection artifacts, but point the manifest at
    # content-versioned copies so publishing a new release cannot mutate files
    # still referenced by an older manifest/client.
    if output_cw_alignment_geometry is not None and legacy_compatibility:
        def versioned_file(path: Path) -> Path:
            return path.with_name(f"{path.stem}.{version}{path.suffix}")

        immutable_geojson = versioned_file(output_geojson)
        immutable_segments = versioned_file(output_segments)
        immutable_cw_base_index = versioned_file(output_cw_base_index)
        immutable_kml = versioned_file(output_kml)
        immutable_alignment_geometry = versioned_file(output_cw_alignment_geometry)
        immutable_shards = output_base_routing_shards.with_name(
            f"{output_base_routing_shards.name}.{version}"
        )
        for source, target in (
            (output_geojson, immutable_geojson),
            (output_segments, immutable_segments),
            (output_cw_base_index, immutable_cw_base_index),
            (output_kml, immutable_kml),
            (output_cw_alignment_geometry, immutable_alignment_geometry),
        ):
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        if immutable_shards.exists():
            shutil.rmtree(immutable_shards)
        shutil.copytree(output_base_routing_shards, immutable_shards)
        output_geojson = immutable_geojson
        output_segments = immutable_segments
        output_cw_base_index = immutable_cw_base_index
        output_kml = immutable_kml
        output_cw_alignment_geometry = immutable_alignment_geometry
        output_base_routing_shards = immutable_shards
        base_routing_shard_manifest = output_base_routing_shards / "manifest.json"
        if output_roundabouts and output_roundabouts.exists():
            immutable_roundabouts = versioned_file(output_roundabouts)
            shutil.copyfile(output_roundabouts, immutable_roundabouts)
            output_roundabouts = immutable_roundabouts
        if output_crossings and output_crossings.exists():
            immutable_crossings = versioned_file(output_crossings)
            shutil.copyfile(output_crossings, immutable_crossings)
            output_crossings = immutable_crossings
        if output_junctions and output_junctions.exists():
            immutable_junctions = versioned_file(output_junctions)
            shutil.copyfile(output_junctions, immutable_junctions)
            output_junctions = immutable_junctions

    def public_relative(path: Path) -> str:
        return path.relative_to(public_data_dir).as_posix()

    manifest = {
        "version": version,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "bikeRoads": public_relative(output_geojson),
        "segments": public_relative(output_segments),
        "cwBaseIndex": public_relative(output_cw_base_index),
        "kml": public_relative(output_kml),
        "baseRoutingShards": public_relative(base_routing_shard_manifest),
        "hashes": {
            "bikeRoads": file_digest(output_geojson),
            "segments": file_digest(output_segments),
            "cwBaseIndex": file_digest(output_cw_base_index),
            "kml": file_digest(output_kml),
            "baseRoutingShards": file_digest(base_routing_shard_manifest),
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
            "routingEdges": validation.get("baseRouting", {}).get("graphEdges"),
            "unresolvedRoutingSegments": validation.get("baseRouting", {}).get("unresolvedSegments"),
            "baseRoutingWarnings": len(validation.get("baseRouting", {}).get("warnings", [])),
            "baseRoutingBlockers": len(validation.get("baseRouting", {}).get("blockers", [])),
            "overlayDisplaySegments": validation.get("cyclewaysDisplayGeometry", {}).get("derivedSegments"),
            "sourceDisplayFallbackSegments": validation.get("cyclewaysDisplayGeometry", {}).get(
                "sourceFallbackSegments"
            ),
            "cwBaseIndexSegments": validation.get("cwBaseIndex", {}).get("segments"),
            "networkJunctions": validation.get("networkJunctions", {}).get("summary", {}).get("junctions", 0),
            "networkJunctionMovements": validation.get("networkJunctions", {}).get("summary", {}).get("movements", 0),
            "networkJunctionDirectedEdges": validation.get("networkJunctions", {}).get("summary", {}).get("compiledDirectedEdges", 0),
        },
    }
    if output_roundabouts and output_roundabouts.exists():
        manifest["roundabouts"] = public_relative(output_roundabouts)
        manifest["hashes"]["roundabouts"] = file_digest(output_roundabouts)
    if output_crossings and output_crossings.exists():
        manifest["crossings"] = public_relative(output_crossings)
        manifest["hashes"]["crossings"] = file_digest(output_crossings)
    if output_junctions and output_junctions.exists():
        manifest["networkJunctions"] = public_relative(output_junctions)
        manifest["hashes"]["networkJunctions"] = file_digest(output_junctions)
    if output_cw_alignment_geometry and output_cw_alignment_geometry.exists():
        manifest["cwAlignmentGeometry"] = public_relative(output_cw_alignment_geometry)
        manifest["hashes"]["cwAlignmentGeometry"] = file_digest(
            output_cw_alignment_geometry
        )
    if legacy_compatibility:
        index_path = Path(legacy_compatibility["indexPath"])
        metadata_path = Path(legacy_compatibility["metadataPath"])
        manifest["legacyRoutingCompatibility"] = {
            "schemaVersion": 1,
            "cwBaseIndex": public_relative(index_path),
            "metadata": public_relative(metadata_path),
            "cwBaseIndexSha256": file_digest(index_path),
            "metadataSha256": file_digest(metadata_path),
            "registryDigest": legacy_compatibility["registryDigest"],
            "graphVersionHashes": legacy_compatibility["graphVersionHashes"],
        }
        manifest["hashes"]["legacyCwBaseIndex"] = file_digest(index_path)
        manifest["hashes"]["legacyRoutingCompatibilityMetadata"] = file_digest(
            metadata_path
        )
    write_json(manifest_path, manifest)
    runtime = {
        "version": version,
        "manifest": str(manifest_path),
        "geojson": str(output_geojson),
        "segments": str(output_segments),
        "cwBaseIndex": str(output_cw_base_index),
        "kml": str(output_kml),
        "baseRoutingShards": str(base_routing_shard_manifest),
    }
    if output_roundabouts and output_roundabouts.exists():
        runtime["roundabouts"] = str(output_roundabouts)
    if output_crossings and output_crossings.exists():
        runtime["crossings"] = str(output_crossings)
    if output_junctions and output_junctions.exists():
        runtime["networkJunctions"] = str(output_junctions)
    if output_cw_alignment_geometry and output_cw_alignment_geometry.exists():
        runtime["cwAlignmentGeometry"] = str(output_cw_alignment_geometry)
    return runtime, manifest_path


def stage_legacy_routing_compatibility(
    public_data_dir: Path, routing_profile: str
) -> dict[str, Any] | None:
    if routing_profile != "staged-v2":
        return None
    source_index = ROUTING_COMPAT_DIR / "cw-base-index-v1.json"
    source_metadata = ROUTING_COMPAT_DIR / "cw-base-index-v1.metadata.json"
    metadata = load_json(source_metadata, {})
    if not source_index.exists() or not metadata:
        raise ValueError("released V1 routing compatibility bundle is missing")
    actual_index_digest = file_digest(source_index)
    if actual_index_digest != metadata.get("sourceSha256"):
        raise ValueError("released V1 CW compatibility index digest mismatch")
    registry_digest = metadata.get("baseEdgeShareRegistryDigest")
    graph_hash = str(metadata.get("legacyGraphVersionHash") or "").lower()
    if not registry_digest or not re.fullmatch(r"[0-9a-f]{8}", graph_hash):
        raise ValueError("released V1 routing compatibility identity is invalid")
    target_dir = public_data_dir / "routing-compat"
    target_dir.mkdir(parents=True, exist_ok=True)
    target_index = target_dir / source_index.name
    target_metadata = target_dir / source_metadata.name
    shutil.copyfile(source_index, target_index)
    shutil.copyfile(source_metadata, target_metadata)
    return {
        "indexPath": str(target_index),
        "metadataPath": str(target_metadata),
        "registryDigest": registry_digest,
        "graphVersionHashes": {graph_hash: registry_digest},
    }


def build_reviewed_roundabouts(
    candidates_path: Path,
    review_path: Path,
    overpass_path: Path,
    query_path: Path,
    output_path: Path,
) -> tuple[dict[str, Any], Path | None]:
    if not candidates_path.exists():
        return {
            "summary": {"total": 0, "accepted": 0, "rejected": 0, "pending": 0, "stale": 0, "orphaned": 0, "warnings": 0},
            "coverage": {},
            "warnings": [],
            "blockingIssues": [{"code": "missing_roundabout_candidates"}],
            "sourceFresh": False,
        }, None
    candidates = load_json(candidates_path, {})
    reviews = load_json(review_path, {"schemaVersion": 1, "reviews": {}})
    joined = join_roundabout_reviews(candidates, reviews)
    source_fresh = False
    if overpass_path.exists() and query_path.exists():
        source_fresh = (
            candidates.get("sourceDigest") == f"sha256:{file_digest(overpass_path)}"
            and candidates.get("queryDigest") == f"sha256:{file_digest(query_path)}"
        )
    if not source_fresh:
        joined["blockingIssues"].append({"code": "stale_roundabout_candidates"})
    runtime_records = []
    for candidate in joined["accepted"]:
        runtime_records.append({
            key: candidate[key]
            for key in ("id", "classification", "center", "radiusM", "bbox", "paths")
            if key in candidate
        })
    payload = {
        "schemaVersion": 1,
        "sourceDigest": candidates.get("sourceDigest"),
        "queryDigest": candidates.get("queryDigest"),
        "coverage": candidates.get("coverage") or {},
        "roundabouts": runtime_records,
    }
    write_json(output_path, payload, compact=True)
    validation = {
        "summary": joined["summary"],
        "coverage": joined["coverage"],
        "warnings": joined["warnings"],
        "blockingIssues": joined["blockingIssues"],
        "sourceFresh": source_fresh,
    }
    return validation, output_path


def build_network_junctions(
    candidates_path: Path,
    reviews_path: Path,
    base_routing_asset: dict[str, Any],
    output_path: Path,
) -> tuple[dict[str, Any], Path | None]:
    candidates = load_json(candidates_path, {})
    reviews_payload = load_json(reviews_path, {"schemaVersion": 1, "reviews": {}})
    blocking_issues: list[dict[str, Any]] = []
    if candidates.get("schemaVersion") != 1:
        blocking_issues.append({"code": "invalid_junction_candidate_schema"})
    if reviews_payload.get("schemaVersion") != 1:
        blocking_issues.append({"code": "invalid_junction_review_schema"})
    reviews = reviews_payload.get("reviews") if isinstance(reviews_payload.get("reviews"), dict) else {}
    runtime_edges = base_routing_asset.get("edges") if isinstance(base_routing_asset.get("edges"), list) else []
    edge_by_id = {str(edge.get("id")): edge for edge in runtime_edges if isinstance(edge, dict)}
    runtime_junctions: list[dict[str, Any]] = []
    seen_junction_ids: set[str] = set()
    compiled_directed_edges: set[tuple[str, str, str]] = set()

    for junction in candidates.get("junctions") or []:
        junction_id = str(junction.get("id") or "")
        fingerprint = str(junction.get("fingerprint") or "")
        if not junction_id or not fingerprint or junction_id in seen_junction_ids:
            blocking_issues.append({"code": "invalid_junction_identity", "junctionId": junction_id})
            continue
        seen_junction_ids.add(junction_id)
        movement_reviews = ((reviews.get(junction_id) or {}).get("movements") or {})
        runtime_movements: list[dict[str, Any]] = []
        for movement in junction.get("movements") or []:
            movement_id = str(movement.get("id") or "")
            review = movement_reviews.get(movement_id)
            if review and review.get("junctionFingerprint") != fingerprint:
                blocking_issues.append({
                    "code": "stale_junction_movement_review",
                    "junctionId": junction_id,
                    "movementId": movement_id,
                })
                continue
            status = "unavailable" if review and review.get("status") == "unavailable" else movement.get("status")
            if status == "ambiguous" and not (review and review.get("status") == "selected"):
                blocking_issues.append({
                    "code": "ambiguous_junction_movement",
                    "junctionId": junction_id,
                    "movementId": movement_id,
                })
                continue
            if status == "unavailable":
                runtime_movements.append({
                    "id": movement_id,
                    "entryPortId": movement.get("entryPortId"),
                    "exitPortId": movement.get("exitPortId"),
                    "status": "unavailable",
                })
                continue
            runtime_refs: list[dict[str, Any]] = []
            for ref in movement.get("edgeRefs") or []:
                edge_id = str(ref.get("edgeId") or "")
                direction = "reverse" if ref.get("direction") == "reverse" else "forward"
                edge = edge_by_id.get(edge_id)
                if edge is None or not edge.get("shareId"):
                    blocking_issues.append({
                        "code": "missing_junction_runtime_edge",
                        "junctionId": junction_id,
                        "movementId": movement_id,
                        "edgeId": edge_id,
                    })
                    continue
                traversal = edge.get("bicycleTraversal") or {}
                if traversal.get(direction) != "allowed":
                    blocking_issues.append({
                        "code": "junction_movement_not_allowed",
                        "junctionId": junction_id,
                        "movementId": movement_id,
                        "edgeId": edge_id,
                        "direction": direction,
                    })
                    continue
                runtime_refs.append({
                    "edgeShareId": edge.get("shareId"),
                    "direction": direction,
                })
                compiled_directed_edges.add((edge_id, direction, junction_id))
            if len(runtime_refs) != len(movement.get("edgeRefs") or []):
                continue
            runtime_movements.append({
                "id": movement_id,
                "entryPortId": movement.get("entryPortId"),
                "exitPortId": movement.get("exitPortId"),
                "status": "allowed",
                "distanceMeters": movement.get("distanceMeters"),
                "edgeRefs": runtime_refs,
            })
        runtime_junctions.append({
            "id": junction_id,
            "kind": junction.get("kind"),
            "roundaboutId": junction.get("roundaboutId"),
            "classification": junction.get("classification"),
            "fingerprint": fingerprint,
            "segmentIds": junction.get("segmentIds") or [],
            "ports": [
                {
                    "id": port.get("id"),
                    "usage": port.get("usage"),
                    "direction": port.get("direction"),
                    "edgeShareId": edge_by_id.get(str(port.get("edgeId") or ""), {}).get("shareId"),
                }
                for port in junction.get("ports") or []
            ],
            "movements": runtime_movements,
        })

    for edge in runtime_edges:
        edge_id = str(edge.get("id") or "")
        edge["cwJunctions"] = {
            direction: [
                {"junctionId": junction_id, "fingerprint": next(
                    (item["fingerprint"] for item in runtime_junctions if item["id"] == junction_id),
                    None,
                )}
                for candidate_edge_id, candidate_direction, junction_id in sorted(compiled_directed_edges)
                if candidate_edge_id == edge_id and candidate_direction == direction
            ]
            for direction in ("forward", "reverse")
        }

    if blocking_issues:
        codes = ", ".join(issue["code"] for issue in blocking_issues[:6])
        raise ValueError(
            f"Network junction publication blocked by {len(blocking_issues)} issue(s): {codes}"
        )
    if not runtime_junctions:
        output_path.unlink(missing_ok=True)
        return {
            "summary": {"junctions": 0, "movements": 0, "compiledDirectedEdges": 0},
            "blockingIssues": [],
        }, None
    payload = {
        "schemaVersion": 1,
        "graphVersion": base_routing_asset.get("graphVersion"),
        "junctions": runtime_junctions,
    }
    write_json(output_path, payload, compact=True)
    return {
        "summary": {
            "junctions": len(runtime_junctions),
            "movements": sum(len(junction["movements"]) for junction in runtime_junctions),
            "compiledDirectedEdges": len(compiled_directed_edges),
        },
        "blockingIssues": [],
    }, output_path


def build_reviewed_crossings(
    candidates_path: Path,
    review_path: Path,
    graph_path: Path,
    share_registry_path: Path,
    graph_version: str,
    output_path: Path,
) -> tuple[dict[str, Any], Path | None]:
    empty_summary = {
        "total": 0, "accepted": 0, "rejected": 0, "pending": 0,
        "staleAccepted": 0, "staleRejected": 0, "manual": 0,
        "invalid": 0, "orphaned": 0, "warnings": 0,
    }
    if not candidates_path.exists():
        output_path.unlink(missing_ok=True)
        return {
            "summary": empty_summary,
            "coverage": {},
            "warnings": [{"code": "missing_crossing_candidates"}],
            "blockingIssues": [],
            "sourceFresh": False,
        }, None
    candidates = load_json(candidates_path, {})
    reviews = load_json(review_path, {"schemaVersion": 1, "reviews": {}, "manualCrossings": []})
    joined = join_crossing_reviews(candidates, reviews)
    expected_graph_digest = f"sha256:{file_digest(graph_path)}"
    expected_registry_digest = f"sha256:{file_digest(share_registry_path)}"
    source_fresh = (
        candidates.get("sourceGraphDigest") == expected_graph_digest
        and candidates.get("edgeShareRegistryDigest") == expected_registry_digest
        and candidates.get("traversalPolicyDigest") == POLICY_DIGEST
    )
    if not source_fresh:
        joined["blockingIssues"].append({"code": "stale_crossing_candidates"})

    graph = load_json(graph_path, {})
    share_registry = load_json(share_registry_path, {})
    share_by_edge = share_registry.get("edges") or {}
    edge_by_share: dict[int, dict[str, Any]] = {}
    for edge in graph.get("edges") or []:
        share_id = share_by_edge.get(edge.get("id"))
        if isinstance(share_id, int):
            edge_by_share[share_id] = edge

    seen_mapping_ids: set[str] = set()
    seen_mapping_signatures: dict[str, str] = {}
    action_signatures: dict[str, str] = {}

    def slice_position(edge: dict[str, Any], share_id: int, fraction_q: int) -> tuple[Any, ...]:
        if fraction_q == 0:
            return ("node", edge.get("fromNodeId"))
        if fraction_q == 1_000_000:
            return ("node", edge.get("toNodeId"))
        return ("edge", share_id, fraction_q)

    for crossing in joined["runtimeCrossings"]:
        for mapping in crossing.get("mappings") or []:
            mapping_id = mapping.get("id")
            if mapping_id in seen_mapping_ids:
                joined["blockingIssues"].append({
                    "code": "duplicate_runtime_mapping_id", "id": crossing.get("id"),
                    "mappingId": mapping_id,
                })
            seen_mapping_ids.add(mapping_id)
            match = mapping.get("match") or {}
            mapping_signature = json.dumps(match, sort_keys=True, separators=(",", ":"))
            if mapping_signature in seen_mapping_signatures:
                joined["blockingIssues"].append({
                    "code": "duplicate_crossing_mapping_signature", "id": crossing.get("id"),
                    "mappingId": mapping_id,
                    "otherMappingId": seen_mapping_signatures[mapping_signature],
                })
            else:
                seen_mapping_signatures[mapping_signature] = str(mapping_id)
            action_slices = match.get("action") or []
            # Junction transitions intentionally have no physical action edge;
            # their before+after signature is already checked for duplicates.
            # Treating every empty list as one action would make all reviewed
            # centerline junctions conflict globally.
            if action_slices:
                action_signature = json.dumps(action_slices, sort_keys=True, separators=(",", ":"))
                other_crossing_id = action_signatures.get(action_signature)
                if other_crossing_id is not None and other_crossing_id != crossing.get("id"):
                    joined["blockingIssues"].append({
                        "code": "conflicting_crossing_action_signature", "id": crossing.get("id"),
                        "mappingId": mapping_id, "otherCrossingId": other_crossing_id,
                    })
                else:
                    action_signatures[action_signature] = str(crossing.get("id"))
            ordered_slices: list[tuple[dict[str, Any], dict[str, Any]]] = []
            repeated_slices: set[tuple[int, int, int]] = set()
            for section in ("before", "action", "after"):
                slices = ((mapping.get("match") or {}).get(section) or [])
                for item in slices:
                    edge = edge_by_share.get(item.get("edgeShareId"))
                    if edge is None:
                        joined["blockingIssues"].append({
                            "code": "missing_crossing_edge_share", "id": crossing.get("id"),
                            "mappingId": mapping_id, "edgeShareId": item.get("edgeShareId"),
                        })
                        continue
                    direction = "forward" if item["toFractionQ"] > item["fromFractionQ"] else "reverse"
                    shadow = edge.get("bicycleTraversalShadow") or {}
                    state = shadow.get(direction) if shadow.get("policyDigest") == POLICY_DIGEST else "unknown"
                    if state != "allowed":
                        joined["blockingIssues"].append({
                            "code": "crossing_mapping_not_allowed", "id": crossing.get("id"),
                            "mappingId": mapping_id, "edgeShareId": item.get("edgeShareId"),
                            "direction": direction, "state": state or "unknown",
                        })
                    signature = (
                        item.get("edgeShareId"), item.get("fromFractionQ"), item.get("toFractionQ")
                    )
                    if signature in repeated_slices:
                        joined["blockingIssues"].append({
                            "code": "repeated_crossing_mapping_slice", "id": crossing.get("id"),
                            "mappingId": mapping_id, "edgeShareId": item.get("edgeShareId"),
                        })
                    repeated_slices.add(signature)
                    ordered_slices.append((item, edge))
            for index in range(1, len(ordered_slices)):
                previous, previous_edge = ordered_slices[index - 1]
                current, current_edge = ordered_slices[index]
                previous_end = slice_position(
                    previous_edge, previous["edgeShareId"], previous["toFractionQ"]
                )
                current_start = slice_position(
                    current_edge, current["edgeShareId"], current["fromFractionQ"]
                )
                if previous_end != current_start or previous_end == ("node", None):
                    joined["blockingIssues"].append({
                        "code": "discontinuous_crossing_mapping", "id": crossing.get("id"),
                        "mappingId": mapping_id, "atSlice": index,
                    })
    if joined["blockingIssues"]:
        codes = ", ".join(issue["code"] for issue in joined["blockingIssues"][:6])
        raise ValueError(
            f"Crossing publication blocked by {len(joined['blockingIssues'])} issue(s): {codes}"
        )
    if not joined["runtimeCrossings"]:
        output_path.unlink(missing_ok=True)
        return {
            "summary": joined["summary"],
            "coverage": joined["coverage"],
            "warnings": [*joined["warnings"], {"code": "no_confirmed_crossings"}],
            "blockingIssues": [],
            "sourceFresh": True,
        }, None
    payload = {
        "schemaVersion": 1,
        "graphVersion": graph_version,
        "sourceGraphDigest": expected_graph_digest,
        "edgeShareRegistryDigest": expected_registry_digest,
        "traversalPolicyDigest": POLICY_DIGEST,
        "reviewSummary": joined["summary"],
        "crossings": joined["runtimeCrossings"],
    }
    write_json(output_path, payload, compact=True)
    return {
        "summary": joined["summary"],
        "coverage": joined["coverage"],
        "warnings": joined["warnings"],
        "blockingIssues": [],
        "sourceFresh": True,
    }, output_path


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
    public_data_dir = out_dir / PUBLIC_DATA_DIR
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
    output_kml = public_data_dir / "exports" / "map.kml"
    output_geojson = public_data_dir / "bike_roads.geojson"
    output_segments = public_data_dir / "segments.json"
    output_cw_base_index = public_data_dir / "cw-base-index.json"
    output_cw_alignment_geometry = (
        public_data_dir / "cw-alignment-geometry.json"
        if args.routing_profile == "staged-v2"
        else None
    )
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

    base_routing_asset, base_routing_validation = build_base_routing_asset(
        args.routing_graph.resolve(),
        args.cw_base_overlay.resolve(),
        args.manual_base_edges.resolve(),
        generated_segments,
        args.routing_base_graph.resolve(),
        geojson_data,
        args.base_edge_share_ids.resolve(),
        args.base_edge_share_id_proposal.resolve(),
        args.routing_profile,
    )
    junction_validation, output_junctions = build_network_junctions(
        args.network_junction_candidates.resolve(),
        args.network_junction_reviews.resolve(),
        base_routing_asset,
        public_data_dir / "network-junctions.json",
    )
    site_geojson_data, display_geometry_validation = build_public_cycleways_display_geojson(
        compact_geojson_for_site(geojson_data),
        base_routing_asset,
        args.cw_base_overlay.resolve(),
        generated_segments,
    )
    site_geojson_optimization = site_geojson_optimization_report(geojson_data, site_geojson_data)
    emit_progress(
        args.verbose,
        "Site GeoJSON compacted: "
        f"{site_geojson_optimization['previousPrettyBytes']} -> "
        f"{site_geojson_optimization['diffableBytes']} bytes "
        f"({site_geojson_optimization['reductionPercent']}% smaller, "
        f"{site_geojson_optimization['compactBytes']} compact bytes)",
    )

    emit_progress(args.verbose, "Writing public GeoJSON, segments JSON, and runtime manifest")
    write_site_geojson(output_geojson, site_geojson_data)
    write_json(output_segments, generated_segments)
    cw_base_index, cw_base_index_validation = build_public_cw_base_index(
        base_routing_asset,
        args.cw_base_overlay.resolve(),
        generated_segments,
    )
    write_json(output_cw_base_index, cw_base_index, compact=True)
    if output_cw_alignment_geometry is not None:
        cw_alignment_geometry, cw_alignment_geometry_validation = (
            build_public_cw_alignment_geometry(
                base_routing_asset,
                args.cw_base_overlay.resolve(),
                generated_segments,
            )
        )
        write_json(output_cw_alignment_geometry, cw_alignment_geometry, compact=True)
    else:
        cw_alignment_geometry_validation = {"alignments": 0, "edgeRefs": 0}

    validation = validate_outputs(
        site_geojson_data,
        generated_segments,
        source_segments,
        new_segments,
        args.topology_threshold,
    )
    validation["baseRouting"] = base_routing_validation
    validation["networkJunctions"] = junction_validation
    validation["cyclewaysDisplayGeometry"] = display_geometry_validation
    validation["cwBaseIndex"] = cw_base_index_validation
    validation["cwAlignmentGeometry"] = cw_alignment_geometry_validation
    base_routing_shard_outputs, base_routing_shard_validation = write_base_routing_shards(
        public_data_dir / "base-routing-shards",
        base_routing_asset,
    )
    validation["baseRoutingShards"] = base_routing_shard_validation
    roundabout_validation, output_roundabouts = build_reviewed_roundabouts(
        args.roundabout_candidates.resolve(),
        args.roundabout_reviews.resolve(),
        args.overpass_response.resolve(),
        args.overpass_query.resolve(),
        public_data_dir / "roundabouts.json",
    )
    validation["roundabouts"] = roundabout_validation
    crossing_validation, output_crossings = build_reviewed_crossings(
        args.crossing_candidates.resolve(),
        args.crossing_reviews.resolve(),
        args.routing_graph.resolve(),
        args.base_edge_share_ids.resolve(),
        str(base_routing_asset.get("graphVersion") or ""),
        public_data_dir / "crossings.json",
    )
    validation["crossings"] = crossing_validation
    legacy_compatibility = stage_legacy_routing_compatibility(
        public_data_dir, args.routing_profile
    )
    runtime_outputs, manifest_path = write_runtime_manifest(
        public_data_dir,
        output_geojson,
        output_segments,
        output_cw_base_index,
        output_kml,
        public_data_dir / "base-routing-shards",
        elevation_stats,
        validation,
        output_roundabouts,
        output_crossings,
        output_junctions,
        output_cw_alignment_geometry,
        legacy_compatibility,
    )
    emit_progress(args.verbose, f"Build version: {runtime_outputs['version']}")
    report = {
        "inputs": {
            "kml": str(input_kml),
            "segments": str(segments_file),
            "routingGraph": str(args.routing_graph.resolve()),
            "routingBaseGraph": str(args.routing_base_graph.resolve()),
            "cwBaseOverlay": str(args.cw_base_overlay.resolve()),
            "manualBaseEdges": str(args.manual_base_edges.resolve()),
            "baseEdgeShareIds": str(args.base_edge_share_ids.resolve()),
        },
        "outputs": {
            "uniformKml": str(uniform_kml),
            "kml": str(output_kml),
            "geojson": str(output_geojson),
            "segments": str(output_segments),
            "cwBaseIndex": str(output_cw_base_index),
            "cwAlignmentGeometry": (
                str(output_cw_alignment_geometry)
                if output_cw_alignment_geometry is not None
                else None
            ),
            "baseRoutingShards": base_routing_shard_outputs,
            "manifest": str(manifest_path),
            "runtime": runtime_outputs,
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
        "siteGeojsonOptimization": site_geojson_optimization,
        "validation": validation,
    }
    write_json(output_report, report)
    return report


def build_from_source_geojson(args: argparse.Namespace) -> dict[str, Any]:
    input_geojson = args.input_geojson.resolve()
    out_dir = args.out_dir.resolve()
    public_data_dir = out_dir / PUBLIC_DATA_DIR
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
    output_kml = public_data_dir / "exports" / "map.kml"
    output_geojson = public_data_dir / "bike_roads.geojson"
    output_segments = public_data_dir / "segments.json"
    output_cw_base_index = public_data_dir / "cw-base-index.json"
    output_cw_alignment_geometry = (
        public_data_dir / "cw-alignment-geometry.json"
        if args.routing_profile == "staged-v2"
        else None
    )
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

    base_routing_asset, base_routing_validation = build_base_routing_asset(
        args.routing_graph.resolve(),
        args.cw_base_overlay.resolve(),
        args.manual_base_edges.resolve(),
        generated_segments,
        args.routing_base_graph.resolve(),
        geojson_data,
        args.base_edge_share_ids.resolve(),
        args.base_edge_share_id_proposal.resolve(),
        args.routing_profile,
    )
    junction_validation, output_junctions = build_network_junctions(
        args.network_junction_candidates.resolve(),
        args.network_junction_reviews.resolve(),
        base_routing_asset,
        public_data_dir / "network-junctions.json",
    )
    site_geojson_data, display_geometry_validation = build_public_cycleways_display_geojson(
        compact_geojson_for_site(geojson_data),
        base_routing_asset,
        args.cw_base_overlay.resolve(),
        generated_segments,
    )
    site_geojson_optimization = site_geojson_optimization_report(geojson_data, site_geojson_data)
    emit_progress(
        args.verbose,
        "Site GeoJSON compacted: "
        f"{site_geojson_optimization['previousPrettyBytes']} -> "
        f"{site_geojson_optimization['diffableBytes']} bytes "
        f"({site_geojson_optimization['reductionPercent']}% smaller, "
        f"{site_geojson_optimization['compactBytes']} compact bytes)",
    )

    emit_progress(args.verbose, "Writing public GeoJSON, segments JSON, KML, and runtime manifest")
    write_site_geojson(output_geojson, site_geojson_data)
    write_json(output_segments, generated_segments)
    cw_base_index, cw_base_index_validation = build_public_cw_base_index(
        base_routing_asset,
        args.cw_base_overlay.resolve(),
        generated_segments,
    )
    write_json(output_cw_base_index, cw_base_index, compact=True)
    if output_cw_alignment_geometry is not None:
        cw_alignment_geometry, cw_alignment_geometry_validation = (
            build_public_cw_alignment_geometry(
                base_routing_asset,
                args.cw_base_overlay.resolve(),
                generated_segments,
            )
        )
        write_json(output_cw_alignment_geometry, cw_alignment_geometry, compact=True)
    else:
        cw_alignment_geometry_validation = {"alignments": 0, "edgeRefs": 0}
    write_kml_from_geojson(geojson_data, output_kml)

    validation = validate_outputs(
        site_geojson_data,
        generated_segments,
        source_segments,
        new_segments,
        args.topology_threshold,
    )
    validation["baseRouting"] = base_routing_validation
    validation["networkJunctions"] = junction_validation
    validation["cyclewaysDisplayGeometry"] = display_geometry_validation
    validation["cwBaseIndex"] = cw_base_index_validation
    validation["cwAlignmentGeometry"] = cw_alignment_geometry_validation
    base_routing_shard_outputs, base_routing_shard_validation = write_base_routing_shards(
        public_data_dir / "base-routing-shards",
        base_routing_asset,
    )
    validation["baseRoutingShards"] = base_routing_shard_validation
    roundabout_validation, output_roundabouts = build_reviewed_roundabouts(
        args.roundabout_candidates.resolve(),
        args.roundabout_reviews.resolve(),
        args.overpass_response.resolve(),
        args.overpass_query.resolve(),
        public_data_dir / "roundabouts.json",
    )
    validation["roundabouts"] = roundabout_validation
    crossing_validation, output_crossings = build_reviewed_crossings(
        args.crossing_candidates.resolve(),
        args.crossing_reviews.resolve(),
        args.routing_graph.resolve(),
        args.base_edge_share_ids.resolve(),
        str(base_routing_asset.get("graphVersion") or ""),
        public_data_dir / "crossings.json",
    )
    validation["crossings"] = crossing_validation
    legacy_compatibility = stage_legacy_routing_compatibility(
        public_data_dir, args.routing_profile
    )
    runtime_outputs, manifest_path = write_runtime_manifest(
        public_data_dir,
        output_geojson,
        output_segments,
        output_cw_base_index,
        output_kml,
        public_data_dir / "base-routing-shards",
        elevation_stats,
        validation,
        output_roundabouts,
        output_crossings,
        output_junctions,
        output_cw_alignment_geometry,
        legacy_compatibility,
    )
    emit_progress(args.verbose, f"Build version: {runtime_outputs['version']}")
    report = {
        "inputs": {
            "geojson": str(input_geojson),
            "routingGraph": str(args.routing_graph.resolve()),
            "routingBaseGraph": str(args.routing_base_graph.resolve()),
            "cwBaseOverlay": str(args.cw_base_overlay.resolve()),
            "manualBaseEdges": str(args.manual_base_edges.resolve()),
            "baseEdgeShareIds": str(args.base_edge_share_ids.resolve()),
        },
        "outputs": {
            "kml": str(output_kml),
            "geojson": str(output_geojson),
            "segments": str(output_segments),
            "cwBaseIndex": str(output_cw_base_index),
            "cwAlignmentGeometry": (
                str(output_cw_alignment_geometry)
                if output_cw_alignment_geometry is not None
                else None
            ),
            "baseRoutingShards": base_routing_shard_outputs,
            "manifest": str(manifest_path),
            "runtime": runtime_outputs,
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
        "siteGeojsonOptimization": site_geojson_optimization,
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
    parser.add_argument("--segments", type=Path, default=Path("public-data/segments.json"))
    parser.add_argument("--out-dir", type=Path, default=Path("build"))
    parser.add_argument("--cache-file", type=Path, default=DEFAULT_CACHE_FILE)
    parser.add_argument(
        "--routing-graph",
        type=Path,
        default=Path("build/osm/osm-base-graph-elevated.json"),
        help="Generated elevated OSM/manual base graph JSON for the public routing asset.",
    )
    parser.add_argument(
        "--routing-base-graph",
        type=Path,
        default=Path("build/osm/osm-base-graph.json"),
        help="Current 2D base graph used to validate the elevated routing graph.",
    )
    parser.add_argument(
        "--cw-base-overlay",
        type=Path,
        default=Path("data/cw-base-overlay.json"),
        help="Reviewed CW base overlay JSON for the public routing asset.",
    )
    parser.add_argument(
        "--manual-base-edges",
        type=Path,
        default=Path("data/manual-base-edges.geojson"),
        help="Manual base edges used for base graph freshness checks.",
    )
    parser.add_argument(
        "--base-edge-share-ids",
        type=Path,
        default=Path("data/base-edge-share-ids.json"),
        help="Authoring-only stable base edge share-id registry.",
    )
    parser.add_argument(
        "--base-edge-share-id-proposal",
        type=Path,
        default=Path("build/base-edge-share-ids.proposal.json"),
        help="Staged share-ID proposal written when the released registry lacks current edges.",
    )
    parser.add_argument(
        "--routing-profile",
        choices=("production-v1", "staged-v2"),
        default="production-v1",
        help="Select exactly one routing schema/input profile; V1 and V2 records cannot be mixed.",
    )
    parser.add_argument(
        "--roundabout-candidates",
        type=Path,
        default=Path("build/osm/roundabout-candidates.json"),
    )
    parser.add_argument(
        "--roundabout-reviews",
        type=Path,
        default=Path("data/roundabout-review.json"),
    )
    parser.add_argument(
        "--crossing-candidates",
        type=Path,
        default=Path("build/crossings/candidates.json"),
    )
    parser.add_argument(
        "--crossing-reviews",
        type=Path,
        default=Path("data/crossing-review.json"),
    )
    parser.add_argument(
        "--network-junction-candidates",
        type=Path,
        default=Path("build/network-junctions/candidates.json"),
    )
    parser.add_argument(
        "--network-junction-reviews",
        type=Path,
        default=Path("data/network-junction-review.json"),
    )
    parser.add_argument(
        "--overpass-response",
        type=Path,
        default=Path("build/osm/overpass-response.json"),
    )
    parser.add_argument(
        "--overpass-query",
        type=Path,
        default=Path("build/osm/overpass-query.ql"),
    )
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
    print(f"Base routing shard manifest: {outputs['baseRoutingShards']['manifest']}")
    print(f"Manifest: {outputs['manifest']}")
    print(f"Report: {outputs['report']}")
    optimization = report.get("siteGeojsonOptimization", {})
    if optimization:
        print(
            "Site GeoJSON: "
            f"{optimization.get('previousPrettyBytes')} -> "
            f"{optimization.get('compactBytes')} bytes "
            f"({optimization.get('reductionPercent')}% smaller)"
        )
    print(
        "Validation: "
        f"{validation['featureCount']} features, "
        f"{validation['segmentsCount']} segment records, "
        f"{len(validation['newSegments'])} new segments"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
