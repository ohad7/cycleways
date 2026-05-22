#!/usr/bin/env python3
"""Sample base graph edges for an elevation-density study.

This processor is intentionally a lab stage. It does not rewrite the base graph
or public map assets. It reports graph-wide sampling counts for candidate
spacings and can fetch elevations for a preview edge set so profile retention
can be compared before the elevated base graph contract is chosen.
"""

from __future__ import annotations

import argparse
import json
import math
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_GRAPH_PATH = Path("build/osm/osm-base-graph.json")
DEFAULT_OUT_DIR = Path("build/osm/elevation-sampling")
DEFAULT_CACHE_FILE = Path("processing/cache/base_graph_elevation_sampling_cache.json")
DEFAULT_STUDY_EDGE_SET_FILE = Path("data/osm-elevation-study-edges.json")
DEFAULT_ELEVATION_URL = "http://localhost/api/v1/lookup"
DEFAULT_SAMPLE_SPACINGS_M = (1.0, 5.0, 10.0, 25.0)
DEFAULT_PREVIEW_EDGES = 12
DEFAULT_VERTICAL_TOLERANCE_M = 1.0
DEFAULT_MAX_RETAINED_GAP_M = 50.0
DEFAULT_BATCH_SIZE = 1000
COORDINATE_DECIMALS = 7
ELEVATION_DECIMALS = 1
OFFSET_DECIMALS = 3


def load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
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


def rounded(value: float, decimals: int) -> float:
    output = round(float(value), decimals)
    return 0.0 if output == -0.0 else output


def normalized_coordinate(coord: Any) -> list[float] | None:
    if not isinstance(coord, list) or len(coord) < 2:
        return None
    try:
        return [
            rounded(float(coord[0]), COORDINATE_DECIMALS),
            rounded(float(coord[1]), COORDINATE_DECIMALS),
        ]
    except (TypeError, ValueError):
        return None


def edge_coordinates(edge: dict[str, Any]) -> list[list[float]]:
    return [
        coord
        for coord in (normalized_coordinate(raw) for raw in edge.get("coordinates", []))
        if coord is not None
    ]


def haversine_m(coord_a: list[float], coord_b: list[float]) -> float:
    radius_m = 6_371_000
    lng1, lat1 = coord_a[:2]
    lng2, lat2 = coord_b[:2]
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    value = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return radius_m * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def cumulative_lengths(coordinates: list[list[float]]) -> list[float]:
    lengths = [0.0]
    for index in range(1, len(coordinates)):
        lengths.append(lengths[-1] + haversine_m(coordinates[index - 1], coordinates[index]))
    return lengths


def interpolate_coordinate(
    coordinates: list[list[float]],
    cumulative: list[float],
    offset_m: float,
) -> list[float]:
    if offset_m <= 0:
        return list(coordinates[0])
    total_length = cumulative[-1]
    if offset_m >= total_length:
        return list(coordinates[-1])

    segment_index = 1
    while segment_index < len(cumulative) and cumulative[segment_index] < offset_m:
        segment_index += 1
    start_index = segment_index - 1
    start_offset = cumulative[start_index]
    end_offset = cumulative[segment_index]
    if end_offset <= start_offset:
        return list(coordinates[segment_index])

    fraction = (offset_m - start_offset) / (end_offset - start_offset)
    start = coordinates[start_index]
    end = coordinates[segment_index]
    return [
        rounded(start[0] + (end[0] - start[0]) * fraction, COORDINATE_DECIMALS),
        rounded(start[1] + (end[1] - start[1]) * fraction, COORDINATE_DECIMALS),
    ]


def offset_key(offset_m: float) -> float:
    return rounded(offset_m, OFFSET_DECIMALS)


def interval_offsets(total_length_m: float, spacing_m: float) -> list[float]:
    if total_length_m <= 0:
        return [0.0]
    offsets = [0.0]
    offset_m = spacing_m
    while offset_m < total_length_m:
        offsets.append(offset_m)
        offset_m += spacing_m
    offsets.append(total_length_m)
    return offsets


def sample_edge(edge: dict[str, Any], spacing_m: float) -> list[dict[str, Any]]:
    if spacing_m <= 0:
        raise ValueError("sample spacing must be greater than zero")

    coordinates = edge_coordinates(edge)
    if len(coordinates) < 2:
        return []

    cumulative = cumulative_lengths(coordinates)
    total_length_m = cumulative[-1]
    if total_length_m <= 0:
        return []

    candidates: dict[float, dict[str, Any]] = {}

    def add_offset(offset_m: float, *, geometry_vertex: bool) -> None:
        key = offset_key(offset_m)
        candidate = candidates.setdefault(
            key,
            {
                "offsetMeters": key,
                "geometryVertex": False,
            },
        )
        candidate["geometryVertex"] = candidate["geometryVertex"] or geometry_vertex

    for offset_m in interval_offsets(total_length_m, spacing_m):
        add_offset(offset_m, geometry_vertex=False)
    for offset_m in cumulative:
        add_offset(offset_m, geometry_vertex=True)

    samples = []
    for key in sorted(candidates):
        sample = candidates[key]
        sample["coordinate"] = interpolate_coordinate(coordinates, cumulative, key)
        samples.append(sample)
    if samples:
        samples[0]["geometryVertex"] = True
        samples[-1]["geometryVertex"] = True
    return samples


def count_edge_samples(edge: dict[str, Any], spacing_m: float) -> int:
    if spacing_m <= 0:
        raise ValueError("sample spacing must be greater than zero")
    coordinates = edge_coordinates(edge)
    if len(coordinates) < 2:
        return 0
    cumulative = cumulative_lengths(coordinates)
    if cumulative[-1] <= 0:
        return 0
    offsets = {offset_key(offset_m) for offset_m in interval_offsets(cumulative[-1], spacing_m)}
    offsets.update(offset_key(offset_m) for offset_m in cumulative)
    return len(offsets)


def coordinate_key(coord: list[float]) -> str:
    return f"{float(coord[1]):.{COORDINATE_DECIMALS}f},{float(coord[0]):.{COORDINATE_DECIMALS}f}"


def parse_coordinate_key(key: str) -> tuple[float, float]:
    lat_text, lng_text = key.split(",", 1)
    return float(lat_text), float(lng_text)


def profile_metrics(samples: list[dict[str, Any]]) -> dict[str, Any] | None:
    if len(samples) < 2:
        return None
    elevations = [sample.get("elevationMeters") for sample in samples]
    if any(not isinstance(elevation, (int, float)) for elevation in elevations):
        return None

    gain_m = 0.0
    loss_m = 0.0
    max_abs_grade = 0.0
    for index in range(1, len(samples)):
        previous = samples[index - 1]
        current = samples[index]
        delta_elevation = float(current["elevationMeters"]) - float(previous["elevationMeters"])
        if delta_elevation >= 0:
            gain_m += delta_elevation
        else:
            loss_m += abs(delta_elevation)
        delta_distance = float(current["offsetMeters"]) - float(previous["offsetMeters"])
        if delta_distance > 0:
            max_abs_grade = max(max_abs_grade, abs(delta_elevation / delta_distance))

    return {
        "distanceMeters": rounded(float(samples[-1]["offsetMeters"]), 1),
        "gainMeters": rounded(gain_m, 1),
        "lossMeters": rounded(loss_m, 1),
        "netMeters": rounded(float(elevations[-1]) - float(elevations[0]), 1),
        "maxObservedAbsGrade": rounded(max_abs_grade, 4),
    }


def linear_elevation_error(
    samples: list[dict[str, Any]],
    start_index: int,
    end_index: int,
    candidate_index: int,
) -> float:
    start = samples[start_index]
    end = samples[end_index]
    candidate = samples[candidate_index]
    width = float(end["offsetMeters"]) - float(start["offsetMeters"])
    if width <= 0:
        return 0.0
    fraction = (float(candidate["offsetMeters"]) - float(start["offsetMeters"])) / width
    expected = float(start["elevationMeters"]) + (
        float(end["elevationMeters"]) - float(start["elevationMeters"])
    ) * fraction
    return abs(float(candidate["elevationMeters"]) - expected)


def max_gap_mandatory_indices(
    samples: list[dict[str, Any]],
    max_retained_gap_m: float,
) -> set[int]:
    if max_retained_gap_m <= 0 or len(samples) < 2:
        return set()

    mandatory = set()
    last_required_offset = 0.0
    sample_index = 1
    while sample_index < len(samples) - 1:
        target_offset = last_required_offset + max_retained_gap_m
        while (
            sample_index < len(samples) - 1
            and float(samples[sample_index]["offsetMeters"]) < target_offset
        ):
            sample_index += 1
        if sample_index >= len(samples) - 1:
            break
        mandatory.add(sample_index)
        last_required_offset = float(samples[sample_index]["offsetMeters"])
        sample_index += 1
    return mandatory


def rdp_profile_indices(
    samples: list[dict[str, Any]],
    start_index: int,
    end_index: int,
    vertical_tolerance_m: float,
) -> set[int]:
    if end_index - start_index <= 1:
        return {start_index, end_index}

    max_error = -1.0
    max_index = None
    for candidate_index in range(start_index + 1, end_index):
        error = linear_elevation_error(samples, start_index, end_index, candidate_index)
        if error > max_error:
            max_error = error
            max_index = candidate_index

    if max_index is None or max_error <= vertical_tolerance_m:
        return {start_index, end_index}

    return rdp_profile_indices(samples, start_index, max_index, vertical_tolerance_m) | rdp_profile_indices(
        samples,
        max_index,
        end_index,
        vertical_tolerance_m,
    )


def simplify_elevation_profile(
    samples: list[dict[str, Any]],
    *,
    vertical_tolerance_m: float,
    max_retained_gap_m: float,
) -> list[dict[str, Any]]:
    if len(samples) < 3:
        return list(samples)
    if any(not isinstance(sample.get("elevationMeters"), (int, float)) for sample in samples):
        return list(samples)

    mandatory = {0, len(samples) - 1}
    mandatory.update(
        index for index, sample in enumerate(samples) if bool(sample.get("geometryVertex"))
    )
    mandatory.update(max_gap_mandatory_indices(samples, max_retained_gap_m))

    retained = set(mandatory)
    mandatory_indices = sorted(mandatory)
    for index in range(1, len(mandatory_indices)):
        retained.update(
            rdp_profile_indices(
                samples,
                mandatory_indices[index - 1],
                mandatory_indices[index],
                vertical_tolerance_m,
            )
        )
    return [samples[index] for index in sorted(retained)]


class ElevationClient:
    def __init__(
        self,
        *,
        elevation_url: str,
        cache_file: Path,
        batch_size: int,
    ):
        self.elevation_url = elevation_url
        self.cache_file = cache_file
        self.batch_size = batch_size
        self.cache = load_json(cache_file, {}) or {}
        if not isinstance(self.cache, dict):
            self.cache = {}
        self.stats = {
            "cacheFile": str(cache_file),
            "url": elevation_url,
            "requestedCoordinates": 0,
            "uniqueCoordinates": 0,
            "cacheHits": 0,
            "lookups": 0,
            "batches": 0,
            "failures": 0,
            "failureExamples": [],
        }

    def fetch_batch(self, keys: list[str]) -> None:
        payload = {
            "locations": [
                {"latitude": lat, "longitude": lng}
                for lat, lng in (parse_coordinate_key(key) for key in keys)
            ]
        }
        request = urllib.request.Request(
            self.elevation_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        self.stats["batches"] += 1
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode(response.headers.get_content_charset() or "utf-8"))
            results = data.get("results") if isinstance(data, dict) else None
            if not isinstance(results, list) or len(results) != len(keys):
                raise ValueError("elevation service returned an unexpected results array")
            for key, result in zip(keys, results):
                elevation = result.get("elevation") if isinstance(result, dict) else None
                if not isinstance(elevation, (int, float)):
                    raise ValueError(f"missing numeric elevation for {key}")
                self.cache[key] = rounded(float(elevation), ELEVATION_DECIMALS)
                self.stats["lookups"] += 1
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
            self.stats["failures"] += len(keys)
            if len(self.stats["failureExamples"]) < 10:
                self.stats["failureExamples"].append(
                    {
                        "batchSize": len(keys),
                        "firstCoordinate": keys[0] if keys else None,
                        "error": str(exc),
                    }
                )

    def hydrate_profiles(self, profiles: list[dict[str, Any]]) -> None:
        all_keys = [
            coordinate_key(sample["coordinate"])
            for profile in profiles
            for sample in profile["samples"]
        ]
        self.stats["requestedCoordinates"] = len(all_keys)
        unique_keys = sorted(set(all_keys))
        self.stats["uniqueCoordinates"] = len(unique_keys)
        missing_keys = []
        for key in unique_keys:
            if isinstance(self.cache.get(key), (int, float)):
                self.stats["cacheHits"] += 1
            else:
                missing_keys.append(key)

        for batch_start in range(0, len(missing_keys), self.batch_size):
            self.fetch_batch(missing_keys[batch_start : batch_start + self.batch_size])
        write_json(self.cache_file, self.cache)

        for profile in profiles:
            for sample in profile["samples"]:
                elevation = self.cache.get(coordinate_key(sample["coordinate"]))
                if isinstance(elevation, (int, float)):
                    sample["elevationMeters"] = rounded(float(elevation), ELEVATION_DECIMALS)


def parse_spacings(value: str) -> list[float]:
    spacings = []
    for token in value.split(","):
        try:
            spacing_m = float(token.strip())
        except ValueError as exc:
            raise argparse.ArgumentTypeError(f"invalid sample spacing: {token}") from exc
        if spacing_m <= 0:
            raise argparse.ArgumentTypeError("sample spacings must be greater than zero")
        spacings.append(spacing_m)
    if not spacings:
        raise argparse.ArgumentTypeError("at least one sample spacing is required")
    return sorted(set(spacings))


def graph_edges(graph: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        edge
        for edge in graph.get("edges", [])
        if isinstance(edge, dict)
        and isinstance(edge.get("id"), str)
        and len(edge_coordinates(edge)) >= 2
    ]


def select_preview_edges(
    edges: list[dict[str, Any]],
    requested_edge_ids: list[str],
    max_preview_edges: int,
) -> list[dict[str, Any]]:
    edges_by_id = {edge["id"]: edge for edge in edges}
    if requested_edge_ids:
        missing = [edge_id for edge_id in requested_edge_ids if edge_id not in edges_by_id]
        if missing:
            raise ValueError(f"Unknown preview edge ids: {', '.join(missing)}")
        return [edges_by_id[edge_id] for edge_id in requested_edge_ids]

    ranked = sorted(
        edges,
        key=lambda edge: (float(edge.get("distanceMeters") or 0), edge["id"]),
        reverse=True,
    )
    return ranked[: max(0, max_preview_edges)]


def load_edge_set(path: Path | None) -> list[dict[str, str]]:
    if path is None:
        return []
    edge_set = load_json(path, {})
    edge_entries = edge_set.get("edges") if isinstance(edge_set, dict) else None
    if not isinstance(edge_entries, list):
        raise ValueError(f"Edge set must contain an edges array: {path}")

    entries = []
    seen_ids = set()
    for entry in edge_entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
            raise ValueError(f"Edge set entry is missing string id: {path}")
        edge_id = entry["id"]
        if edge_id in seen_ids:
            continue
        seen_ids.add(edge_id)
        entries.append(
            {
                "id": edge_id,
                "label": str(entry.get("label") or edge_id),
                "terrain": str(entry.get("terrain") or "unspecified"),
                "reason": str(entry.get("reason") or ""),
            }
        )
    return entries


def unique_edge_ids(*edge_id_groups: list[str]) -> list[str]:
    edge_ids = []
    seen_ids = set()
    for group in edge_id_groups:
        for edge_id in group:
            if edge_id in seen_ids:
                continue
            seen_ids.add(edge_id)
            edge_ids.append(edge_id)
    return edge_ids


def sampling_report(
    edges: list[dict[str, Any]],
    sample_spacings_m: list[float],
) -> dict[str, Any]:
    total_distance_m = 0.0
    existing_coordinate_occurrences = 0
    unique_coordinate_keys = set()
    source_counts = Counter()
    for edge in edges:
        coordinates = edge_coordinates(edge)
        existing_coordinate_occurrences += len(coordinates)
        unique_coordinate_keys.update(coordinate_key(coord) for coord in coordinates)
        total_distance_m += float(edge.get("distanceMeters") or cumulative_lengths(coordinates)[-1])
        source_counts[str(edge.get("source") or "unknown")] += 1

    spacing_reports = []
    for spacing_m in sample_spacings_m:
        sample_count = sum(count_edge_samples(edge, spacing_m) for edge in edges)
        spacing_reports.append(
            {
                "spacingMeters": spacing_m,
                "sampleOccurrences": sample_count,
                "occurrenceMultiplierVsExistingGeometry": rounded(
                    sample_count / max(existing_coordinate_occurrences, 1),
                    3,
                ),
            }
        )

    return {
        "edges": len(edges),
        "totalDistanceMeters": rounded(total_distance_m, 1),
        "totalDistanceKm": rounded(total_distance_m / 1000, 1),
        "existingCoordinateOccurrences": existing_coordinate_occurrences,
        "existingUniqueCoordinates": len(unique_coordinate_keys),
        "edgeSources": dict(sorted(source_counts.items())),
        "sampleSpacings": spacing_reports,
    }


def build_profiles(
    edges: list[dict[str, Any]],
    sample_spacings_m: list[float],
    study_cases_by_edge_id: dict[str, dict[str, str]] | None = None,
) -> list[dict[str, Any]]:
    profiles = []
    study_cases_by_edge_id = study_cases_by_edge_id or {}
    for edge in edges:
        for spacing_m in sample_spacings_m:
            samples = sample_edge(edge, spacing_m)
            if not samples:
                continue
            profiles.append(
                {
                    "edgeId": edge["id"],
                    "source": edge.get("source") or "unknown",
                    "distanceMeters": float(edge.get("distanceMeters") or samples[-1]["offsetMeters"]),
                    "spacingMeters": spacing_m,
                    "geometryCoordinateCount": len(edge_coordinates(edge)),
                    "samples": samples,
                    "studyCase": study_cases_by_edge_id.get(edge["id"]),
                }
            )
    return profiles


def summarize_profiles(
    profiles: list[dict[str, Any]],
    *,
    vertical_tolerance_m: float,
    max_retained_gap_m: float,
) -> list[dict[str, Any]]:
    summaries = []
    for profile in profiles:
        retained = simplify_elevation_profile(
            profile["samples"],
            vertical_tolerance_m=vertical_tolerance_m,
            max_retained_gap_m=max_retained_gap_m,
        )
        profile["retainedSamples"] = retained
        summaries.append(
            {
                "edgeId": profile["edgeId"],
                "source": profile["source"],
                "studyCase": profile.get("studyCase"),
                "distanceMeters": rounded(profile["distanceMeters"], 1),
                "spacingMeters": profile["spacingMeters"],
                "geometryCoordinateCount": profile["geometryCoordinateCount"],
                "sampleCount": len(profile["samples"]),
                "retainedCount": len(retained),
                "retainedRatio": rounded(len(retained) / max(len(profile["samples"]), 1), 3),
                "sampleMetrics": profile_metrics(profile["samples"]),
                "retainedMetrics": profile_metrics(retained),
            }
        )
    return summaries


def sample_coordinates_for_geojson(samples: list[dict[str, Any]]) -> list[list[float]]:
    coordinates = []
    for sample in samples:
        coordinate = list(sample["coordinate"])
        elevation = sample.get("elevationMeters")
        if isinstance(elevation, (int, float)):
            coordinate.append(rounded(float(elevation), ELEVATION_DECIMALS))
        coordinates.append(coordinate)
    return coordinates


def preview_geojson(
    profiles: list[dict[str, Any]],
    *,
    include_points: bool,
) -> dict[str, Any]:
    features = []
    for profile in profiles:
        retained = profile.get("retainedSamples") or profile["samples"]
        features.append(
            {
                "type": "Feature",
                "id": f"{profile['edgeId']}-{profile['spacingMeters']}m-profile",
                "geometry": {
                    "type": "LineString",
                    "coordinates": sample_coordinates_for_geojson(retained),
                },
                "properties": {
                    "kind": "elevation_profile",
                    "edgeId": profile["edgeId"],
                    "source": profile["source"],
                    "studyLabel": (profile.get("studyCase") or {}).get("label"),
                    "studyTerrain": (profile.get("studyCase") or {}).get("terrain"),
                    "spacingMeters": profile["spacingMeters"],
                    "sampleCount": len(profile["samples"]),
                    "retainedCount": len(retained),
                },
            }
        )
        if not include_points:
            continue
        for sample_index, sample in enumerate(retained):
            features.append(
                {
                    "type": "Feature",
                    "id": f"{profile['edgeId']}-{profile['spacingMeters']}m-sample-{sample_index}",
                    "geometry": {
                        "type": "Point",
                        "coordinates": sample_coordinates_for_geojson([sample])[0],
                    },
                    "properties": {
                        "kind": "retained_elevation_sample",
                        "edgeId": profile["edgeId"],
                        "studyLabel": (profile.get("studyCase") or {}).get("label"),
                        "studyTerrain": (profile.get("studyCase") or {}).get("terrain"),
                        "spacingMeters": profile["spacingMeters"],
                        "offsetMeters": sample["offsetMeters"],
                        "geometryVertex": bool(sample.get("geometryVertex")),
                        "elevationMeters": sample.get("elevationMeters"),
                    },
                }
            )
    return {"type": "FeatureCollection", "features": features}


def run_sampling_lab(args: argparse.Namespace) -> dict[str, Any]:
    graph = load_json(args.graph, {})
    edges = graph_edges(graph)
    if not edges:
        raise ValueError(f"Base graph has no edges with geometry: {args.graph}")

    edge_set_entries = load_edge_set(args.edge_set_file)
    edge_set_ids = [entry["id"] for entry in edge_set_entries]
    requested_edge_ids = unique_edge_ids(edge_set_ids, args.edge_ids)
    study_cases_by_edge_id = {entry["id"]: entry for entry in edge_set_entries}
    selected_edges = select_preview_edges(edges, requested_edge_ids, args.max_preview_edges)
    profiles = build_profiles(selected_edges, args.sample_spacings, study_cases_by_edge_id)
    elevation_stats = {
        "fetched": False,
        "requestedCoordinates": sum(len(profile["samples"]) for profile in profiles),
    }
    if args.fetch_elevation:
        client = ElevationClient(
            elevation_url=args.elevation_url,
            cache_file=args.cache_file,
            batch_size=args.batch_size,
        )
        client.hydrate_profiles(profiles)
        elevation_stats = {"fetched": True, **client.stats}

    profile_summaries = summarize_profiles(
        profiles,
        vertical_tolerance_m=args.vertical_tolerance,
        max_retained_gap_m=args.max_retained_gap,
    )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    preview_path = args.out_dir / "sampling-preview.geojson"
    report_path = args.out_dir / "sampling-report.json"
    write_json(preview_path, preview_geojson(profiles, include_points=args.preview_points), compact=True)

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "inputs": {
            "graph": str(args.graph.resolve()),
        },
        "settings": {
            "sampleSpacingsMeters": args.sample_spacings,
            "verticalToleranceMeters": args.vertical_tolerance,
            "maxRetainedGapMeters": args.max_retained_gap,
            "previewEdgeIds": [edge["id"] for edge in selected_edges],
            "edgeSetFile": str(args.edge_set_file.resolve()) if args.edge_set_file else None,
            "edgeSetCases": edge_set_entries,
            "fetchElevation": args.fetch_elevation,
        },
        "outputs": {
            "report": str(report_path.resolve()),
            "previewGeojson": str(preview_path.resolve()),
        },
        "graph": sampling_report(edges, args.sample_spacings),
        "preview": {
            "edges": len(selected_edges),
            "profiles": profile_summaries,
        },
        "elevation": elevation_stats,
    }
    write_json(report_path, report)
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", type=Path, default=DEFAULT_GRAPH_PATH, help="Base graph JSON input.")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR, help="Lab artifact directory.")
    parser.add_argument(
        "--sample-spacings",
        type=parse_spacings,
        default=list(DEFAULT_SAMPLE_SPACINGS_M),
        help="Comma-separated candidate sample spacings in meters.",
    )
    parser.add_argument(
        "--edge-id",
        dest="edge_ids",
        action="append",
        default=[],
        help="Preview one graph edge id. Repeat to preview multiple edges.",
    )
    parser.add_argument(
        "--edge-set-file",
        type=Path,
        help=(
            "JSON edge study set. Combine with --edge-id or use "
            f"{DEFAULT_STUDY_EDGE_SET_FILE} for the current representative set."
        ),
    )
    parser.add_argument(
        "--max-preview-edges",
        type=int,
        default=DEFAULT_PREVIEW_EDGES,
        help="Longest edges to preview when no --edge-id is provided.",
    )
    parser.add_argument(
        "--fetch-elevation",
        action="store_true",
        help="Fetch preview edge sample elevations through the configured service.",
    )
    parser.add_argument("--elevation-url", default=DEFAULT_ELEVATION_URL, help="Elevation API lookup URL.")
    parser.add_argument(
        "--cache-file",
        type=Path,
        default=DEFAULT_CACHE_FILE,
        help="Persistent elevation sampling cache.",
    )
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="POST batch size.")
    parser.add_argument(
        "--vertical-tolerance",
        type=float,
        default=DEFAULT_VERTICAL_TOLERANCE_M,
        help="Vertical simplification tolerance in meters.",
    )
    parser.add_argument(
        "--max-retained-gap",
        type=float,
        default=DEFAULT_MAX_RETAINED_GAP_M,
        help="Maximum spacing target for simplified retained samples.",
    )
    parser.add_argument(
        "--preview-points",
        action="store_true",
        help="Include retained sample point features in preview GeoJSON.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if args.max_preview_edges < 0:
        parser.error("--max-preview-edges must be zero or greater")
    if args.batch_size <= 0:
        parser.error("--batch-size must be greater than zero")
    if args.vertical_tolerance < 0:
        parser.error("--vertical-tolerance must be zero or greater")
    report = run_sampling_lab(args)
    graph = report["graph"]
    print(f"Graph edges: {graph['edges']}")
    print(f"Graph distance: {graph['totalDistanceKm']} km")
    for spacing in graph["sampleSpacings"]:
        print(
            f"{spacing['spacingMeters']} m samples: "
            f"{spacing['sampleOccurrences']} occurrences "
            f"({spacing['occurrenceMultiplierVsExistingGeometry']}x current geometry)"
        )
    print(f"Preview edges: {report['preview']['edges']}")
    elevation = report["elevation"]
    if elevation.get("fetched"):
        print(
            "Preview elevation: "
            f"{elevation.get('lookups', 0)} lookups, "
            f"{elevation.get('cacheHits', 0)} cache hits, "
            f"{elevation.get('failures', 0)} failures"
        )
    print(f"Report: {report['outputs']['report']}")
    print(f"Preview GeoJSON: {report['outputs']['previewGeojson']}")


if __name__ == "__main__":
    main()
