#!/usr/bin/env python3
"""Build or verify an immutable base-edge share-ID compatibility registry.

The old registry maps mutable build edge IDs to compact numeric IDs.  That is
not enough to prove that an old route token still names the same physical edge.
This command binds every released numeric ID to an oriented geometry descriptor
and writes a proposal; ordinary map builds must not rewrite released history.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
FRACTION_BASIS = "oriented_polyline_length"


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def fnv1a_32(text: str) -> int:
    value = 2166136261
    for byte in text.encode("utf-8"):
        value ^= byte
        value = (value * 16777619) & 0xFFFFFFFF
    return value


def _coordinate(value: Any) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        raise ValueError(f"invalid edge coordinate: {value!r}")
    lng = float(value[0])
    lat = float(value[1])
    # Seven decimal places is finer than the released source precision while
    # eliminating irrelevant float parser noise.
    return [round(lng, 7), round(lat, 7)]


def canonical_edge_descriptor(edge: dict[str, Any], share_id: int) -> dict[str, Any]:
    coordinates = [_coordinate(value) for value in edge.get("coordinates", [])]
    if len(coordinates) < 2:
        raise ValueError(f"edge {edge.get('id')!r} has no oriented polyline")
    edge_id = str(edge.get("id") or "")
    from_node = str(edge.get("fromNodeId") or edge.get("from") or "")
    to_node = str(edge.get("toNodeId") or edge.get("to") or "")
    if not edge_id or not from_node or not to_node:
        raise ValueError(f"edge descriptor is incomplete: {edge_id!r}")

    source = str(edge.get("source") or "unknown")
    source_identity: dict[str, Any] = {"source": source}
    if edge.get("osmWayId") is not None:
        source_identity["osmWayId"] = int(edge["osmWayId"])
    if edge.get("sliceIndex") is not None:
        source_identity["sliceIndex"] = int(edge["sliceIndex"])
    if edge.get("manualEdgeId") is not None:
        source_identity["manualEdgeId"] = str(edge["manualEdgeId"])

    descriptor = {
        "shareId": int(share_id),
        "edgeId": edge_id,
        "sourceIdentity": source_identity,
        "fromNodeId": from_node,
        "toNodeId": to_node,
        "coordinates": coordinates,
        "lengthMeters": round(float(edge.get("distanceMeters") or edge.get("lengthMeters") or 0), 3),
        "fractionBasis": FRACTION_BASIS,
    }
    descriptor["descriptorDigest"] = sha256_json(descriptor)
    return descriptor


def build_registry(
    graph: dict[str, Any],
    legacy_registry: dict[str, Any],
    *,
    release_id: str,
    graph_version: str,
) -> dict[str, Any]:
    edge_to_share = legacy_registry.get("edges")
    if not isinstance(edge_to_share, dict):
        raise ValueError("legacy registry must contain an edges object")
    graph_edges = graph.get("edges")
    if not isinstance(graph_edges, list):
        raise ValueError("graph must contain an edges array")

    graph_by_id: dict[str, dict[str, Any]] = {}
    for edge in graph_edges:
        edge_id = str(edge.get("id") or "")
        if not edge_id or edge_id in graph_by_id:
            raise ValueError(f"missing or duplicate graph edge ID: {edge_id!r}")
        graph_by_id[edge_id] = edge

    by_share_id: dict[str, dict[str, Any]] = {}
    seen_share_ids: dict[int, str] = {}
    missing: list[str] = []
    for edge_id, raw_share_id in sorted(edge_to_share.items()):
        share_id = int(raw_share_id)
        if share_id <= 0:
            raise ValueError(f"edge {edge_id!r} has invalid share ID {share_id}")
        previous = seen_share_ids.get(share_id)
        if previous is not None:
            raise ValueError(
                f"share ID collision {share_id}: {previous!r} and {edge_id!r}"
            )
        seen_share_ids[share_id] = edge_id
        edge = graph_by_id.get(edge_id)
        if edge is None:
            missing.append(edge_id)
            by_share_id[str(share_id)] = {
                "shareId": share_id,
                "edgeId": edge_id,
                "tombstone": True,
                "reason": "not_present_in_release_graph",
            }
            continue
        by_share_id[str(share_id)] = canonical_edge_descriptor(edge, share_id)

    graph_metadata = graph.get("metadata") if isinstance(graph.get("metadata"), dict) else {}
    registry = {
        "schemaVersion": SCHEMA_VERSION,
        "releaseId": release_id,
        "graphVersion": graph_version,
        "sourceGraphDigest": sha256_json(
            {
                "metadata": graph_metadata,
                "edges": graph_edges,
            }
        ),
        "legacyRegistryDigest": sha256_json(legacy_registry),
        "nextShareId": int(legacy_registry.get("nextShareId") or (max(seen_share_ids, default=0) + 1)),
        "fractionBasis": FRACTION_BASIS,
        "entries": by_share_id,
        "summary": {
            "entries": len(by_share_id),
            "descriptors": len(by_share_id) - len(missing),
            "tombstones": len(missing),
        },
    }
    registry_digest = sha256_json(registry)
    registry["registryDigest"] = registry_digest
    if graph_version:
        version_hash = fnv1a_32(graph_version)
        registry["legacyGraphVersionHashes"] = {
            f"{version_hash:08x}": registry_digest,
        }
    return registry


def write_or_check(path: Path, registry: dict[str, Any], check: bool) -> None:
    # This is a large compatibility artifact. Keep it canonical and compact so
    # retaining complete oriented polylines does not triple repository size.
    content = canonical_json(registry) + "\n"
    if check:
        if not path.exists() or path.read_text(encoding="utf-8") != content:
            raise SystemExit(f"registry check failed: {path} is not the expected proposal")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--graph", type=Path, required=True)
    parser.add_argument("--legacy-registry", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--graph-version", required=True)
    parser.add_argument("--check", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    graph = json.loads(args.graph.read_text(encoding="utf-8"))
    legacy_registry = json.loads(args.legacy_registry.read_text(encoding="utf-8"))
    registry = build_registry(
        graph,
        legacy_registry,
        release_id=args.release_id,
        graph_version=args.graph_version,
    )
    write_or_check(args.output, registry, args.check)
    print(
        f"base-edge registry {registry['registryDigest']} "
        f"({registry['summary']['descriptors']} descriptors, "
        f"{registry['summary']['tombstones']} tombstones)"
    )


if __name__ == "__main__":
    main()
