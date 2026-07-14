#!/usr/bin/env python3
"""Generate conservative, graph-wide side-change crossing review candidates.

This command is deliberately local-only: it reads an existing base graph and
stable edge-share registry and writes a review queue. It never fetches OSM and
never publishes runtime data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

try:
    from .bicycle_traversal_policy import POLICY_DIGEST
except ImportError:
    from bicycle_traversal_policy import POLICY_DIGEST

FRACTION_SCALE = 1_000_000
MIN_ACTION_M = 4.0
MAX_ACTION_M = 60.0
NEARBY_ROAD_M = 28.0
MOTOR_HIGHWAYS = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary",
    "primary_link", "secondary", "secondary_link", "tertiary",
    "tertiary_link", "residential", "unclassified", "living_street", "service",
}
MOTOR_PRIORITY = {
    "motorway": 0, "motorway_link": 1, "trunk": 2, "trunk_link": 3,
    "primary": 4, "primary_link": 5, "secondary": 6, "secondary_link": 7,
    "tertiary": 8, "tertiary_link": 9, "residential": 10,
    "unclassified": 11, "living_street": 12, "service": 13,
}
PATH_HIGHWAYS = {"cycleway", "path", "footway", "track", "pedestrian", "steps", "manual"}


def canonical_digest(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def file_digest(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def coord(value: list[float]) -> dict[str, float]:
    return {"lat": round(float(value[1]), 7), "lng": round(float(value[0]), 7)}


def haversine(a: list[float], b: list[float]) -> float:
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    dlat = lat2 - lat1
    dlng = math.radians(b[0] - a[0])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 6_371_000 * 2 * math.atan2(math.sqrt(h), math.sqrt(max(0, 1 - h)))


def bearing(a: list[float], b: list[float]) -> float:
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    dlng = math.radians(b[0] - a[0])
    y = math.sin(dlng) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlng)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def heading_delta(first: float, second: float) -> float:
    return abs((second - first + 180) % 360 - 180)


def point_segment_distance(point: list[float], a: list[float], b: list[float]) -> float:
    lat = math.radians(point[1])
    x_scale = 111_320 * max(0.1, math.cos(lat))
    px, py = point[0] * x_scale, point[1] * 111_320
    ax, ay = a[0] * x_scale, a[1] * 111_320
    bx, by = b[0] * x_scale, b[1] * 111_320
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def signed_side_m(point: list[float], a: list[float], b: list[float]) -> float:
    lat = math.radians(point[1])
    x_scale = 111_320 * max(0.1, math.cos(lat))
    ax, ay = a[0] * x_scale, a[1] * 111_320
    bx, by = b[0] * x_scale, b[1] * 111_320
    px, py = point[0] * x_scale, point[1] * 111_320
    length = math.hypot(bx - ax, by - ay)
    return 0 if length == 0 else ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / length


def highway(edge: dict[str, Any]) -> str:
    return str((edge.get("tags") or {}).get("highway") or "").lower()


def is_motor(edge: dict[str, Any]) -> bool:
    return highway(edge) in MOTOR_HIGHWAYS


def is_candidate_action(edge: dict[str, Any]) -> bool:
    length = float(edge.get("distanceMeters") or 0)
    tags = edge.get("tags") or {}
    explicitly_crossing = bool(tags.get("crossing")) or str(tags.get("footway") or "").lower() == "crossing"
    return MIN_ACTION_M <= length <= MAX_ACTION_M and (
        highway(edge) in PATH_HIGHWAYS
        or edge.get("source") == "manual"
        or explicitly_crossing
    )


def truthy_osm_tag(value: Any) -> bool:
    return str(value or "").lower() not in {"", "0", "no", "false", "none"}


def known_grade_separated(action_edges: list[dict[str, Any]], road: dict[str, Any]) -> bool:
    road_tags = road.get("tags") or {}
    road_layer_raw = road_tags.get("layer")
    road_layer = str(road_layer_raw) if road_layer_raw is not None else "0"
    road_bridge = truthy_osm_tag(road_tags.get("bridge"))
    road_tunnel = truthy_osm_tag(road_tags.get("tunnel"))
    for action in action_edges:
        tags = action.get("tags") or {}
        layer_raw = tags.get("layer")
        layer = str(layer_raw) if layer_raw is not None else "0"
        action_bridge = truthy_osm_tag(tags.get("bridge"))
        action_tunnel = truthy_osm_tag(tags.get("tunnel"))
        if (road_layer_raw is not None or layer_raw is not None) and road_layer != layer:
            return True
        if road_bridge != action_bridge and (road_bridge or action_bridge):
            return True
        if road_tunnel != action_tunnel and (road_tunnel or action_tunnel):
            return True
    return False


def policy_state(edge: dict[str, Any], direction_name: str) -> str:
    shadow = edge.get("bicycleTraversalShadow") or {}
    if shadow.get("policyDigest") != POLICY_DIGEST:
        return "unknown"
    return str(shadow.get(direction_name) or "unknown")


def oriented(edge: dict[str, Any], start_node: str, end_node: str) -> dict[str, Any] | None:
    if edge.get("fromNodeId") == start_node and edge.get("toNodeId") == end_node:
        direction_name, start_q, end_q = "forward", 0, FRACTION_SCALE
        coordinates = edge.get("coordinates") or []
    elif edge.get("toNodeId") == start_node and edge.get("fromNodeId") == end_node:
        direction_name, start_q, end_q = "reverse", FRACTION_SCALE, 0
        coordinates = list(reversed(edge.get("coordinates") or []))
    else:
        return None
    return {
        "edge": edge,
        "direction": direction_name,
        "state": policy_state(edge, direction_name),
        "fromFractionQ": start_q,
        "toFractionQ": end_q,
        "coordinates": coordinates,
    }


def action_path_endpoints(edges: list[dict[str, Any]]) -> tuple[str, str] | None:
    if len(edges) == 1:
        return str(edges[0].get("fromNodeId")), str(edges[0].get("toNodeId"))
    first_nodes = {str(edges[0].get("fromNodeId")), str(edges[0].get("toNodeId"))}
    second_nodes = {str(edges[1].get("fromNodeId")), str(edges[1].get("toNodeId"))}
    shared = first_nodes & second_nodes
    if len(shared) != 1:
        return None
    shared_node = next(iter(shared))
    return next(node for node in first_nodes if node != shared_node), next(node for node in second_nodes if node != shared_node)


def orient_action_path(edges: list[dict[str, Any]], start_node: str, end_node: str) -> list[dict[str, Any]] | None:
    if len(edges) == 1:
        value = oriented(edges[0], start_node, end_node)
        return [value] if value else None
    endpoints = action_path_endpoints(edges)
    if not endpoints:
        return None
    first_nodes = {str(edges[0].get("fromNodeId")), str(edges[0].get("toNodeId"))}
    second_nodes = {str(edges[1].get("fromNodeId")), str(edges[1].get("toNodeId"))}
    shared = next(iter(first_nodes & second_nodes))
    if start_node in first_nodes and end_node in second_nodes:
        sequence = [oriented(edges[0], start_node, shared), oriented(edges[1], shared, end_node)]
    elif start_node in second_nodes and end_node in first_nodes:
        sequence = [oriented(edges[1], start_node, shared), oriented(edges[0], shared, end_node)]
    else:
        return None
    return sequence if all(sequence) else None


def action_paths(edges: list[dict[str, Any]], adjacency: dict[str, list[dict[str, Any]]]) -> list[list[dict[str, Any]]]:
    eligible = [edge for edge in edges if is_candidate_action(edge)]
    paths = [[edge] for edge in eligible]
    eligible_ids = {str(edge.get("id")) for edge in eligible}
    seen_pairs: set[tuple[str, str]] = set()
    for edge in eligible:
        tags = edge.get("tags") or {}
        edge_explicit = bool(tags.get("crossing")) or str(tags.get("footway") or "").lower() == "crossing"
        for node in (str(edge.get("fromNodeId")), str(edge.get("toNodeId"))):
            for other in adjacency.get(node, []):
                other_id = str(other.get("id"))
                if other_id == str(edge.get("id")) or other_id not in eligible_ids:
                    continue
                key = tuple(sorted((str(edge.get("id")), other_id)))
                if key in seen_pairs:
                    continue
                seen_pairs.add(key)
                other_tags = other.get("tags") or {}
                other_explicit = bool(other_tags.get("crossing")) or str(other_tags.get("footway") or "").lower() == "crossing"
                total = float(edge.get("distanceMeters") or 0) + float(other.get("distanceMeters") or 0)
                if total <= MAX_ACTION_M and (edge_explicit or other_explicit):
                    paths.append([edge, other])
    return sorted(paths, key=lambda values: tuple(str(value.get("id")) for value in values))


def incident_orientations(
    node: str,
    adjacency: dict[str, list[dict[str, Any]]],
    *,
    entering: bool,
    excluded: set[str],
) -> list[dict[str, Any]]:
    result = []
    for edge in adjacency.get(node, []):
        if edge.get("id") in excluded:
            continue
        other = edge.get("fromNodeId") if edge.get("toNodeId") == node else edge.get("toNodeId")
        value = oriented(edge, other, node) if entering else oriented(edge, node, other)
        if value and value["state"] in {"allowed", "unknown"}:
            result.append(value)
    return sorted(result, key=lambda value: str(value["edge"].get("id")))


def spatial_key(point: list[float], cell_degrees: float = 0.001) -> tuple[int, int]:
    return math.floor(point[0] / cell_degrees), math.floor(point[1] / cell_degrees)


def motor_index(edges: Iterable[dict[str, Any]]) -> dict[tuple[int, int], list[dict[str, Any]]]:
    index: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for edge in edges:
        if not is_motor(edge) or len(edge.get("coordinates") or []) < 2:
            continue
        keys = {spatial_key(point) for point in edge["coordinates"]}
        for key in keys:
            index[key].append(edge)
    return index


def nearby_motor_edges(path_coords: list[list[float]], index: dict[tuple[int, int], list[dict[str, Any]]]) -> list[tuple[float, dict[str, Any], list[float], list[float]]]:
    midpoint = path_coords[len(path_coords) // 2]
    key = spatial_key(midpoint)
    candidates: dict[str, dict[str, Any]] = {}
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for edge in index.get((key[0] + dx, key[1] + dy), []):
                candidates[str(edge.get("id"))] = edge
    distances = []
    for edge in candidates.values():
        coordinates = edge.get("coordinates") or []
        best = min(
            (point_segment_distance(midpoint, coordinates[i - 1], coordinates[i]), coordinates[i - 1], coordinates[i])
            for i in range(1, len(coordinates))
        )
        if best[0] <= NEARBY_ROAD_M:
            distances.append((best[0], edge, best[1], best[2]))
    # A short connector can touch a minor side road at one endpoint while
    # crossing a major corridor a few metres away. Prefer the higher road class
    # within the bounded search radius, then the closest geometry.
    return sorted(
        distances,
        key=lambda value: (MOTOR_PRIORITY.get(highway(value[1]), 99), value[0], str(value[1].get("id"))),
    )


def slice_for(value: dict[str, Any], share_ids: dict[str, int]) -> dict[str, int]:
    return {
        "edgeShareId": int(share_ids[value["edge"]["id"]]),
        "fromFractionQ": value["fromFractionQ"],
        "toFractionQ": value["toFractionQ"],
    }


def road_identity(edge: dict[str, Any]) -> dict[str, Any]:
    tags = edge.get("tags") or {}
    source_ids = []
    source_id = edge.get("osmWayId") or edge.get("copiedFromOsmWayId") or tags.get("osmId")
    if source_id is not None:
        source_ids.append(source_id)
    return {
        "source": "osm" if source_ids else str(edge.get("source") or "unknown"),
        "sourceIds": source_ids,
        "name": tags.get("name"),
        "highway": highway(edge),
    }


def build_mapping(
    before: dict[str, Any],
    actions: list[dict[str, Any]],
    after: dict[str, Any],
    share_ids: dict[str, int],
    policy_digest: str,
) -> dict[str, Any]:
    entry = coord(actions[0]["coordinates"][0])
    exit_point = coord(actions[-1]["coordinates"][-1])
    signature = {
        "before": [slice_for(before, share_ids)],
        "action": [slice_for(value, share_ids) for value in actions],
        "after": [slice_for(after, share_ids)],
    }
    action_geometry = []
    for value in actions:
        points = [coord(point) for point in value["coordinates"]]
        action_geometry.extend(points if not action_geometry else points[1:])
    policy_states = [before["state"], *(value["state"] for value in actions), after["state"]]
    mapping = {
        "id": "mapping:" + canonical_digest(signature).split(":", 1)[1][:16],
        "direction": actions[0]["direction"],
        "match": signature,
        "entry": entry,
        "exit": exit_point,
        "geometry": action_geometry,
        "beforeGeometry": [coord(point) for point in before["coordinates"]],
        "afterGeometry": [coord(point) for point in after["coordinates"]],
        "metrics": {
            "actionLengthMeters": round(sum(float(value["edge"].get("distanceMeters") or 0) for value in actions), 1),
            "netHeadingChangeDeg": round(heading_delta(
                bearing(before["coordinates"][-2], before["coordinates"][-1]),
                bearing(after["coordinates"][0], after["coordinates"][1]),
            ), 1),
            "lateralDisplacementMeters": round(haversine(actions[0]["coordinates"][0], actions[-1]["coordinates"][-1]), 1),
        },
        "policy": {
            "state": "allowed" if all(state == "allowed" for state in policy_states) else "unknown",
            "policyDigest": policy_digest,
        },
    }
    mapping["sourceEdgeFingerprint"] = canonical_digest({
        "edges": [
            {
                "id": value["edge"].get("id"),
                "sourceGeometryDigest": value["edge"].get("sourceGeometryDigest"),
                "state": value["state"],
                "fromFractionQ": value["fromFractionQ"],
                "toFractionQ": value["toFractionQ"],
            }
            for value in [before, *actions, after]
        ],
        "policyDigest": policy_digest,
    })
    return mapping


def generate_candidates(graph: dict[str, Any], share_registry: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    edges = sorted(graph.get("edges") or [], key=lambda edge: str(edge.get("id") or ""))
    share_ids = share_registry.get("edges") or {}
    missing = [edge.get("id") for edge in edges if edge.get("id") not in share_ids]
    if missing:
        raise ValueError(f"stable edge-share registry is missing {len(missing)} graph edges; first={missing[0]}")
    if len(set(share_ids.values())) != len(share_ids):
        raise ValueError("stable edge-share registry contains duplicate share IDs")
    adjacency: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for edge in edges:
        adjacency[str(edge.get("fromNodeId"))].append(edge)
        adjacency[str(edge.get("toNodeId"))].append(edge)
    roads = motor_index(edges)
    audit: Counter[str] = Counter()
    logical: list[dict[str, Any]] = []

    for path_edges in action_paths(edges, adjacency):
        audit["consideredActionPaths"] += 1
        endpoints = action_path_endpoints(path_edges)
        if not endpoints:
            audit["rejectedInvalidPath"] += 1
            continue
        initial_actions = orient_action_path(path_edges, endpoints[0], endpoints[1])
        if not initial_actions:
            audit["rejectedInvalidPath"] += 1
            continue
        coordinates: list[list[float]] = []
        for value in initial_actions:
            points = value["coordinates"]
            coordinates.extend(points if not coordinates else points[1:])
        if len(coordinates) < 2:
            audit["rejectedMissingGeometry"] += 1
            continue
        road_matches = nearby_motor_edges(coordinates, roads)
        excluded_ids = {str(edge.get("id")) for edge in path_edges}
        incident_motor = any(is_motor(edge) for node in endpoints for edge in adjacency.get(str(node), []) if str(edge.get("id")) not in excluded_ids)
        explicit = any(
            bool((edge.get("tags") or {}).get("crossing"))
            or str((edge.get("tags") or {}).get("footway") or "").lower() == "crossing"
            for edge in path_edges
        )
        if not road_matches or (not explicit and not incident_motor):
            audit["rejectedNoCorridorEvidence"] += 1
            continue
        distance, road, corridor_a, corridor_b = road_matches[0]
        if known_grade_separated(path_edges, road):
            audit["rejectedKnownGradeSeparation"] += 1
            continue
        mappings = []
        warnings: set[str] = {"grade-separation-source-dependent"}
        for start_node, end_node in (endpoints, tuple(reversed(endpoints))):
            actions = orient_action_path(path_edges, start_node, end_node)
            if not actions or any(action["state"] == "prohibited" for action in actions):
                continue
            before_values = incident_orientations(start_node, adjacency, entering=True, excluded=excluded_ids)
            after_values = incident_orientations(end_node, adjacency, entering=False, excluded=excluded_ids)
            for before in before_values[:4]:
                if len(before["coordinates"]) < 2:
                    continue
                for after in after_values[:4]:
                    if len(after["coordinates"]) < 2:
                        continue
                    mapping = build_mapping(before, actions, after, share_ids, POLICY_DIGEST)
                    if mapping["metrics"]["netHeadingChangeDeg"] > 145:
                        audit["rejectedUTurnContext"] += 1
                        continue
                    mappings.append(mapping)
                    if mapping["policy"]["state"] != "allowed":
                        warnings.add("unknown-traversal-policy")
        unique = {mapping["id"]: mapping for mapping in mappings}
        mappings = [unique[key] for key in sorted(unique)]
        if not mappings:
            audit["rejectedNoDirectedMapping"] += 1
            continue
        entry_raw = coordinates[0]
        exit_raw = coordinates[-1]
        side_entry = signed_side_m(entry_raw, corridor_a, corridor_b)
        side_exit = signed_side_m(exit_raw, corridor_a, corridor_b)
        if side_entry * side_exit >= 0 and not incident_motor:
            audit["rejectedSameCorridorSide"] += 1
            continue
        center = coord([(entry_raw[0] + exit_raw[0]) / 2, (entry_raw[1] + exit_raw[1]) / 2])
        identity = road_identity(road)
        cell = f"{round(center['lat'], 4):.4f}-{round(center['lng'], 4):.4f}"
        road_key = identity["sourceIds"][0] if identity["sourceIds"] else str(road.get("id"))
        action_key = "-".join(str(share_ids[str(edge["id"])]) for edge in path_edges)
        crossing_id = f"crossing:{road_key}:{cell}:{action_key}"
        evidence = ["short-connector", "motor-road-corridor"]
        if explicit:
            evidence.append("osm-crossing-tag")
        if incident_motor:
            evidence.append("motor-road-incidence")
        if len(path_edges) > 1:
            evidence.append("multi-edge-action")
        candidate = {
            "id": crossing_id,
            "kind": "side-change",
            "crossedRoad": identity,
            "center": center,
            "bbox": [
                round(min(point[0] for point in coordinates), 7),
                round(min(point[1] for point in coordinates), 7),
                round(max(point[0] for point in coordinates), 7),
                round(max(point[1] for point in coordinates), 7),
            ],
            "corridorGeometry": [coord(corridor_a), coord(corridor_b)],
            "mappings": mappings,
            "evidence": sorted(evidence),
            "warnings": sorted(warnings),
            "metrics": {
                "corridorDistanceMeters": round(distance, 1),
                "signedEntrySideMeters": round(side_entry, 1),
                "signedExitSideMeters": round(side_exit, 1),
            },
        }
        candidate["fingerprint"] = canonical_digest({
            key: candidate[key]
            for key in ("kind", "crossedRoad", "center", "mappings", "evidence", "warnings")
        })
        logical.append(candidate)
        audit["logicalCrossings"] += 1
        audit["directedMappings"] += len(mappings)
    logical.sort(key=lambda crossing: crossing["id"])
    return logical, dict(sorted(audit.items()))


def build_payload(graph_path: Path, registry_path: Path) -> dict[str, Any]:
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    crossings, audit = generate_candidates(graph, registry)
    graph_policy = (graph.get("metadata") or {}).get("bicycleTraversalShadowPolicyDigest")
    if graph_policy and graph_policy != POLICY_DIGEST:
        raise ValueError("base graph traversal policy digest is stale")
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sourceGraphDigest": file_digest(graph_path),
        "edgeShareRegistryDigest": file_digest(registry_path),
        "traversalPolicyDigest": POLICY_DIGEST,
        "coverage": {
            "baseGraph": "complete",
            "stableEdgeShareIds": "complete",
            "gradeSeparationTags": "source-dependent",
            "cyclewaysOverlay": "diagnostic-only",
        },
        "audit": audit,
        "crossings": crossings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", type=Path, default=Path("build/osm/osm-base-graph-elevated.json"))
    parser.add_argument("--edge-share-registry", type=Path, default=Path("data/base-edge-share-ids.json"))
    parser.add_argument("--output", type=Path, default=Path("build/crossings/candidates.json"))
    args = parser.parse_args()
    for path in (args.graph, args.edge_share_registry):
        if not path.exists():
            raise FileNotFoundError(f"required local input is missing: {path}")
    payload = build_payload(args.graph, args.edge_share_registry)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "summary": payload["audit"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
