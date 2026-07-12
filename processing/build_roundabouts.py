#!/usr/bin/env python3
"""Build reviewed roundabout candidates from the existing saved OSM snapshot.

This command is intentionally local-only. It reads the saved Overpass response
and query and never fetches or rebuilds OSM/base-network data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
MINI_RADIUS_M = 10.0
UNUSUALLY_LARGE_RADIUS_M = 100.0
NEARBY_WARNING_M = 35.0
M_PER_DEG_LAT = 111_320.0
REVIEW_TAGS = ("junction", "highway", "name", "oneway")


def sha256_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def source_coverage(query: str) -> dict[str, str]:
    has_highway_ways = 'way["highway"' in query
    has_minis = (
        'node["highway"="mini_roundabout"]' in query
        or "node['highway'='mini_roundabout']" in query
    )
    way_status = "available" if has_highway_ways else "not-requested-by-source"
    return {
        "roundaboutWays": way_status,
        "circularWays": way_status,
        "miniRoundaboutNodes": "available" if has_minis else "not-requested-by-source",
    }


def meters(a: list[float], b: list[float]) -> float:
    lat = math.radians((a[0] + b[0]) / 2.0)
    dy = (a[0] - b[0]) * M_PER_DEG_LAT
    dx = (a[1] - b[1]) * M_PER_DEG_LAT * math.cos(lat)
    return math.hypot(dx, dy)


def normalize_geometry(element: dict[str, Any]) -> list[list[float]]:
    result: list[list[float]] = []
    for point in element.get("geometry") or []:
        try:
            lat = float(point["lat"])
            lng = float(point["lon"])
        except (KeyError, TypeError, ValueError):
            return []
        if not math.isfinite(lat) or not math.isfinite(lng):
            return []
        coord = [round(lat, 7), round(lng, 7)]
        if not result or result[-1] != coord:
            result.append(coord)
    return result


def relevant_tags(element: dict[str, Any]) -> dict[str, Any]:
    tags = element.get("tags") or {}
    result = {"osmWayId": int(element["id"])}
    for key in REVIEW_TAGS:
        if key in tags:
            result[key] = str(tags[key])
    return result


def roundabout_way(element: dict[str, Any]) -> bool:
    junction = str((element.get("tags") or {}).get("junction", "")).lower()
    return element.get("type") == "way" and junction in {"roundabout", "circular"}


def mini_node(element: dict[str, Any]) -> bool:
    tags = element.get("tags") or {}
    return element.get("type") == "node" and tags.get("highway") == "mini_roundabout"


def candidate_fingerprint(candidate: dict[str, Any]) -> str:
    identity = {
        "classification": candidate["classification"],
        "memberWayIds": candidate.get("memberWayIds", []),
        "sourceNodeId": candidate.get("sourceNodeId"),
        "sourceTags": candidate.get("sourceTags", []),
        "paths": candidate.get("paths", []),
        "center": candidate["center"],
    }
    return sha256_bytes(canonical_json(identity))


def grouped_ways(ways: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    if not ways:
        return []
    parent = list(range(len(ways)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    by_node: dict[int, list[int]] = defaultdict(list)
    for index, way in enumerate(ways):
        for node_id in set(way.get("nodes") or []):
            by_node[int(node_id)].append(index)
    for indexes in by_node.values():
        first = indexes[0]
        for other in indexes[1:]:
            root_first = find(first)
            root_other = find(other)
            if root_first != root_other:
                parent[root_other] = root_first
    groups: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for index, way in enumerate(ways):
        groups[find(index)].append(way)
    return [sorted(group, key=lambda item: int(item["id"])) for group in groups.values()]


def group_closed(group: list[dict[str, Any]]) -> bool:
    endpoint_degree: dict[int, int] = defaultdict(int)
    for way in group:
        nodes = way.get("nodes") or []
        if len(nodes) < 2:
            return False
        endpoint_degree[int(nodes[0])] += 1
        endpoint_degree[int(nodes[-1])] += 1
    return bool(endpoint_degree) and all(degree == 2 for degree in endpoint_degree.values())


def way_group_candidate(group: list[dict[str, Any]]) -> dict[str, Any] | None:
    member_ids = sorted(int(way["id"]) for way in group)
    paths = []
    all_points = []
    classifications = set()
    source_tags = []
    for way in group:
        path = normalize_geometry(way)
        nodes = way.get("nodes") or []
        if len(path) < 2 or len(nodes) != len(way.get("geometry") or []):
            return None
        # Canonical orientation keeps fingerprints stable when member order is not.
        if tuple(path[-1]) < tuple(path[0]):
            path.reverse()
        paths.append(path)
        all_points.extend(path)
        classifications.add(str((way.get("tags") or {}).get("junction", "")).lower())
        source_tags.append(relevant_tags(way))
    paths.sort(key=lambda path: (path[0], path[-1], len(path)))
    unique_points = sorted({(point[0], point[1]) for point in all_points})
    if not unique_points:
        return None
    center_lat = sum(point[0] for point in unique_points) / len(unique_points)
    center_lng = sum(point[1] for point in unique_points) / len(unique_points)
    center = [center_lat, center_lng]
    radius = max(meters(center, list(point)) for point in unique_points)
    warnings = []
    if not group_closed(group):
        warnings.append("non_closed")
    if radius > UNUSUALLY_LARGE_RADIUS_M:
        warnings.append("unusually_large")
    classification = "circular" if classifications == {"circular"} else "roundabout"
    candidate = {
        "id": f"osm-ways:{','.join(str(value) for value in member_ids)}",
        "classification": classification,
        "memberWayIds": member_ids,
        "sourceTags": source_tags,
        "center": {"lat": round(center_lat, 7), "lng": round(center_lng, 7)},
        "radiusM": round(radius, 1),
        "bbox": [
            min(point[1] for point in unique_points),
            min(point[0] for point in unique_points),
            max(point[1] for point in unique_points),
            max(point[0] for point in unique_points),
        ],
        "paths": paths,
        "warnings": warnings,
    }
    candidate["fingerprint"] = candidate_fingerprint(candidate)
    return candidate


def mini_candidate(element: dict[str, Any]) -> dict[str, Any] | None:
    try:
        lat = float(element["lat"])
        lng = float(element["lon"])
        node_id = int(element["id"])
    except (KeyError, TypeError, ValueError):
        return None
    if not all(math.isfinite(value) for value in (lat, lng)):
        return None
    lat_pad = MINI_RADIUS_M / M_PER_DEG_LAT
    lng_pad = lat_pad / max(0.1, math.cos(math.radians(lat)))
    candidate = {
        "id": f"osm-node:{node_id}",
        "classification": "mini_roundabout",
        "memberWayIds": [],
        "sourceNodeId": node_id,
        "sourceTags": [{"osmNodeId": node_id, "highway": "mini_roundabout"}],
        "center": {"lat": round(lat, 7), "lng": round(lng, 7)},
        "radiusM": MINI_RADIUS_M,
        "bbox": [lng - lng_pad, lat - lat_pad, lng + lng_pad, lat + lat_pad],
        "paths": [],
        "warnings": [],
    }
    candidate["fingerprint"] = candidate_fingerprint(candidate)
    return candidate


def add_proximity_warnings(candidates: list[dict[str, Any]]) -> None:
    for index, candidate in enumerate(candidates):
        a = [candidate["center"]["lat"], candidate["center"]["lng"]]
        for other in candidates[index + 1 :]:
            b = [other["center"]["lat"], other["center"]["lng"]]
            if meters(a, b) <= candidate["radiusM"] + other["radiusM"] + NEARBY_WARNING_M:
                for item in (candidate, other):
                    if "nearby_candidate" not in item["warnings"]:
                        item["warnings"].append("nearby_candidate")


def extract_roundabout_candidates(
    overpass_data: dict[str, Any],
    coverage: dict[str, str],
) -> list[dict[str, Any]]:
    elements = overpass_data.get("elements") if isinstance(overpass_data, dict) else []
    elements = elements if isinstance(elements, list) else []
    ways = [element for element in elements if isinstance(element, dict) and roundabout_way(element)]
    candidates = []
    for group in grouped_ways(ways):
        candidate = way_group_candidate(group)
        if candidate:
            candidates.append(candidate)
    if coverage.get("miniRoundaboutNodes") == "available":
        for element in elements:
            if isinstance(element, dict) and mini_node(element):
                candidate = mini_candidate(element)
                if candidate:
                    candidates.append(candidate)
    add_proximity_warnings(candidates)
    for candidate in candidates:
        candidate["warnings"].sort()
        # Warnings are review diagnostics and do not invalidate an otherwise
        # unchanged classification fingerprint.
    candidates.sort(key=lambda item: item["id"])
    return candidates


def build_payload(response_bytes: bytes, query_bytes: bytes) -> dict[str, Any]:
    overpass_data = json.loads(response_bytes)
    query = query_bytes.decode("utf-8")
    coverage = source_coverage(query)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sourceDigest": sha256_bytes(response_bytes),
        "queryDigest": sha256_bytes(query_bytes),
        "coverage": coverage,
        "roundabouts": extract_roundabout_candidates(overpass_data, coverage),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--overpass", type=Path, default=Path("build/osm/overpass-response.json"))
    parser.add_argument("--query", type=Path, default=Path("build/osm/overpass-query.ql"))
    parser.add_argument("--out", type=Path, default=Path("build/osm/roundabout-candidates.json"))
    args = parser.parse_args()
    missing = [str(path) for path in (args.overpass, args.query) if not path.exists()]
    if missing:
        parser.error(
            "existing saved OSM snapshot required; missing " + ", ".join(missing)
            + ". This command will not run osm:fetch."
        )
    payload = build_payload(args.overpass.read_bytes(), args.query.read_bytes())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    coverage = payload["coverage"]
    print(
        f"roundabouts: {len(payload['roundabouts'])} candidates -> {args.out} "
        f"(minis: {coverage['miniRoundaboutNodes']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
