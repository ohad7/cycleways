#!/usr/bin/env python3
"""Build an elevated OSM/manual base graph artifact for validation.

This stage augments the generated 2D base graph with compact offset/elevation
profiles and edge-level elevation metrics. It does not change public routing
assets yet; the report is the quality gate before the elevated graph becomes a
runtime input.
"""

from __future__ import annotations

import argparse
import hashlib
import math
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from processing.sample_base_graph_elevation import (
        DEFAULT_BATCH_SIZE,
        DEFAULT_CACHE_FILE,
        DEFAULT_ELEVATION_URL,
        DEFAULT_MAX_RETAINED_GAP_M,
        DEFAULT_VERTICAL_TOLERANCE_M,
        ELEVATION_DECIMALS,
        ElevationClient,
        build_profiles,
        coordinate_key,
        graph_edges,
        load_json,
        profile_metrics,
        rounded,
        simplify_elevation_profile,
        write_json,
    )
except ModuleNotFoundError:
    from sample_base_graph_elevation import (  # type: ignore
        DEFAULT_BATCH_SIZE,
        DEFAULT_CACHE_FILE,
        DEFAULT_ELEVATION_URL,
        DEFAULT_MAX_RETAINED_GAP_M,
        DEFAULT_VERTICAL_TOLERANCE_M,
        ELEVATION_DECIMALS,
        ElevationClient,
        build_profiles,
        coordinate_key,
        graph_edges,
        load_json,
        profile_metrics,
        rounded,
        simplify_elevation_profile,
        write_json,
    )


DEFAULT_GRAPH_PATH = Path("build/osm/osm-base-graph.json")
DEFAULT_OUTPUT_GRAPH_PATH = Path("build/osm/osm-base-graph-elevated.json")
DEFAULT_REPORT_PATH = Path("build/osm/osm-base-graph-elevation-report.json")
DEFAULT_SAMPLE_SPACING_M = 10.0
PROFILE_OFFSET_DECIMALS = 3
MAX_REPORT_EDGE_EXAMPLES = 20
GRADE_WINDOWS_M = (25.0, 50.0, 100.0)
GRADE_THRESHOLDS = (0.15, 0.25, 0.5, 1.0)


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


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


def numeric_summary(values: list[float]) -> dict[str, float | int]:
    if not values:
        return {"count": 0}
    return {
        "count": len(values),
        "total": rounded(sum(values), 1),
        "min": rounded(min(values), 1),
        "p50": rounded(percentile(values, 0.5), 1),
        "p90": rounded(percentile(values, 0.9), 1),
        "p95": rounded(percentile(values, 0.95), 1),
        "max": rounded(max(values), 1),
    }


def grade_summary(values: list[float]) -> dict[str, float | int]:
    if not values:
        return {"count": 0}
    return {
        "count": len(values),
        "min": rounded(min(values), 4),
        "p50": rounded(percentile(values, 0.5), 4),
        "p90": rounded(percentile(values, 0.9), 4),
        "p95": rounded(percentile(values, 0.95), 4),
        "p99": rounded(percentile(values, 0.99), 4),
        "max": rounded(max(values), 4),
    }


def grade_threshold_counts(values: list[float]) -> dict[str, int]:
    return {
        f"atLeast{round(threshold * 100)}Percent": sum(value >= threshold for value in values)
        for threshold in GRADE_THRESHOLDS
    }


def hydrate_profiles_from_cache(
    profiles: list[dict[str, Any]],
    cache_file: Path,
) -> dict[str, Any]:
    cache = load_json(cache_file, {}) or {}
    if not isinstance(cache, dict):
        cache = {}

    requested_keys = [
        coordinate_key(sample["coordinate"])
        for profile in profiles
        for sample in profile["samples"]
    ]
    unique_keys = sorted(set(requested_keys))
    cache_hits = 0
    missing_keys = []
    for key in unique_keys:
        elevation = cache.get(key)
        if isinstance(elevation, (int, float)):
            cache_hits += 1
        else:
            missing_keys.append(key)

    for profile in profiles:
        for sample in profile["samples"]:
            elevation = cache.get(coordinate_key(sample["coordinate"]))
            if isinstance(elevation, (int, float)):
                sample["elevationMeters"] = rounded(float(elevation), ELEVATION_DECIMALS)

    return {
        "cacheFile": str(cache_file),
        "fetchSkipped": True,
        "requestedCoordinates": len(requested_keys),
        "uniqueCoordinates": len(unique_keys),
        "cacheHits": cache_hits,
        "lookups": 0,
        "batches": 0,
        "failures": 0,
        "missingUniqueCoordinates": len(missing_keys),
        "missingCoordinateExamples": missing_keys[:MAX_REPORT_EDGE_EXAMPLES],
    }


def missing_profile_sample_count(profile: dict[str, Any]) -> int:
    return sum(
        1
        for sample in profile.get("samples", [])
        if not isinstance(sample.get("elevationMeters"), (int, float))
    )


def compact_profile(samples: list[dict[str, Any]]) -> list[list[float]]:
    output = []
    for sample in samples:
        output.append(
            [
                rounded(float(sample["offsetMeters"]), PROFILE_OFFSET_DECIMALS),
                rounded(float(sample["elevationMeters"]), ELEVATION_DECIMALS),
            ]
        )
    return output


def fixed_window_grade_metrics(
    samples: list[dict[str, Any]],
    window_m: float,
) -> dict[str, float | int] | None:
    if window_m <= 0 or len(samples) < 2 or missing_profile_sample_count({"samples": samples}):
        return None

    last_offset = float(samples[-1]["offsetMeters"])
    if last_offset < window_m:
        return None

    grades = []
    end_index = 1
    for start_index, start in enumerate(samples[:-1]):
        start_offset = float(start["offsetMeters"])
        target_offset = start_offset + window_m
        if target_offset > last_offset:
            break
        end_index = max(end_index, start_index + 1)
        while (
            end_index < len(samples)
            and float(samples[end_index]["offsetMeters"]) < target_offset
        ):
            end_index += 1
        if end_index >= len(samples):
            break

        previous = samples[end_index - 1]
        current = samples[end_index]
        previous_offset = float(previous["offsetMeters"])
        current_offset = float(current["offsetMeters"])
        if current_offset <= previous_offset:
            target_elevation = float(current["elevationMeters"])
        else:
            fraction = (target_offset - previous_offset) / (current_offset - previous_offset)
            target_elevation = float(previous["elevationMeters"]) + (
                float(current["elevationMeters"]) - float(previous["elevationMeters"])
            ) * fraction
        grades.append((target_elevation - float(start["elevationMeters"])) / window_m)

    if not grades:
        return None
    max_uphill = max(grades)
    max_downhill = -min(grades)
    return {
        "windows": len(grades),
        "maxUphillGrade": rounded(max(0.0, max_uphill), 4),
        "maxDownhillGrade": rounded(max(0.0, max_downhill), 4),
        "maxAbsGrade": rounded(max(abs(grade) for grade in grades), 4),
    }


def completed_profiles_by_edge_id(profiles: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        profile["edgeId"]: profile
        for profile in profiles
        if isinstance(profile.get("edgeId"), str)
        and not missing_profile_sample_count(profile)
        and profile_metrics(profile["samples"]) is not None
    }


def graph_edge_incidents(edges: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    incidents: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for edge in edges:
        edge_id = edge.get("id")
        from_node_id = edge.get("fromNodeId")
        to_node_id = edge.get("toNodeId")
        if not all(isinstance(value, str) for value in (edge_id, from_node_id, to_node_id)):
            continue
        incidents[from_node_id].append(edge)
        incidents[to_node_id].append(edge)
    return incidents


def oriented_chain_edge(edge: dict[str, Any], start_node_id: str) -> dict[str, Any]:
    if edge["fromNodeId"] == start_node_id:
        return {
            "edgeId": edge["id"],
            "fromNodeId": edge["fromNodeId"],
            "toNodeId": edge["toNodeId"],
            "reverse": False,
        }
    return {
        "edgeId": edge["id"],
        "fromNodeId": edge["toNodeId"],
        "toNodeId": edge["fromNodeId"],
        "reverse": True,
    }


def degree_two_edge_chains(edges: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    edges_by_id = {edge["id"]: edge for edge in edges if isinstance(edge.get("id"), str)}
    incidents = graph_edge_incidents(list(edges_by_id.values()))
    visited_edge_ids = set()
    chains = []

    def walk(start_edge: dict[str, Any], start_node_id: str) -> list[dict[str, Any]]:
        chain = []
        current_edge = start_edge
        current_node_id = start_node_id
        while current_edge["id"] not in visited_edge_ids:
            next_edge = oriented_chain_edge(current_edge, current_node_id)
            chain.append(next_edge)
            visited_edge_ids.add(current_edge["id"])
            current_node_id = next_edge["toNodeId"]
            node_incidents = incidents[current_node_id]
            if len(node_incidents) != 2:
                break
            candidates = [edge for edge in node_incidents if edge["id"] != current_edge["id"]]
            if not candidates or candidates[0]["id"] in visited_edge_ids:
                break
            current_edge = candidates[0]
        return chain

    for node_id, node_incidents in sorted(incidents.items()):
        if len(node_incidents) == 2:
            continue
        for edge in sorted(node_incidents, key=lambda candidate: candidate["id"]):
            if edge["id"] in visited_edge_ids:
                continue
            chain = walk(edge, node_id)
            if chain:
                chains.append(chain)

    for edge_id in sorted(edges_by_id):
        if edge_id in visited_edge_ids:
            continue
        edge = edges_by_id[edge_id]
        chain = walk(edge, edge["fromNodeId"])
        if chain:
            chains.append(chain)
    return chains


def oriented_profile_samples(
    profile: dict[str, Any],
    *,
    reverse: bool,
    offset_start_m: float,
) -> list[dict[str, float]]:
    samples = profile["samples"]
    edge_length_m = float(samples[-1]["offsetMeters"])
    oriented = list(reversed(samples)) if reverse else samples
    output = []
    for sample in oriented:
        edge_offset_m = float(sample["offsetMeters"])
        if reverse:
            edge_offset_m = edge_length_m - edge_offset_m
        output.append(
            {
                "offsetMeters": offset_start_m + edge_offset_m,
                "elevationMeters": float(sample["elevationMeters"]),
            }
        )
    return output


def stitched_chain_samples(
    chain: list[dict[str, Any]],
    profiles_by_edge_id: dict[str, dict[str, Any]],
) -> list[dict[str, float]]:
    samples = []
    offset_start_m = 0.0
    for chain_edge in chain:
        profile = profiles_by_edge_id.get(chain_edge["edgeId"])
        if profile is None:
            return []
        edge_samples = oriented_profile_samples(
            profile,
            reverse=bool(chain_edge["reverse"]),
            offset_start_m=offset_start_m,
        )
        if not edge_samples:
            return []
        for sample in edge_samples:
            if samples and math.isclose(sample["offsetMeters"], samples[-1]["offsetMeters"], abs_tol=0.001):
                continue
            samples.append(sample)
        offset_start_m = samples[-1]["offsetMeters"]
    return samples


def fixed_window_distribution(
    samples_by_subject: list[list[dict[str, Any]]],
    *,
    subject_label: str,
) -> dict[str, Any]:
    fixed_window_values = {window_m: [] for window_m in GRADE_WINDOWS_M}
    fixed_window_counts = {window_m: 0 for window_m in GRADE_WINDOWS_M}
    for samples in samples_by_subject:
        for window_m in GRADE_WINDOWS_M:
            sustained = fixed_window_grade_metrics(samples, window_m)
            if sustained is None:
                continue
            fixed_window_counts[window_m] += int(sustained["windows"])
            fixed_window_values[window_m].append(float(sustained["maxAbsGrade"]))
    return {
        f"{int(window_m)}m": {
            f"eligible{subject_label}": len(fixed_window_values[window_m]),
            "windows": fixed_window_counts[window_m],
            subject_label.lower(): grade_summary(fixed_window_values[window_m]),
            "thresholdCounts": grade_threshold_counts(fixed_window_values[window_m]),
        }
        for window_m in GRADE_WINDOWS_M
    }


def degree_two_chain_grade_diagnostics(
    edges: list[dict[str, Any]],
    profiles_by_edge_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    stitchable_edges = [
        edge
        for edge in edges
        if edge.get("id") in profiles_by_edge_id
        and isinstance(edge.get("fromNodeId"), str)
        and isinstance(edge.get("toNodeId"), str)
    ]
    chains = degree_two_edge_chains(stitchable_edges)
    chain_samples = [
        samples
        for samples in (
            stitched_chain_samples(chain, profiles_by_edge_id)
            for chain in chains
        )
        if len(samples) >= 2
    ]
    return {
        "scope": (
            "Chains cross only nodes with two incident completed elevated edges; "
            "junction continuations stay route-dependent."
        ),
        "stitchableEdges": len(stitchable_edges),
        "chains": len(chain_samples),
        "edgeCountsPerChain": numeric_summary([len(chain) for chain in chains]),
        "distanceMeters": numeric_summary([samples[-1]["offsetMeters"] for samples in chain_samples]),
        "fixedWindowMaxAbsGrade": fixed_window_distribution(chain_samples, subject_label="Chains"),
    }


def profile_grade_diagnostics(
    profiles: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> dict[str, Any]:
    point_grade_values = []
    average_abs_net_grade_values = []
    sampled_gain_density_values = []
    sampled_loss_density_values = []
    completed_profiles = completed_profiles_by_edge_id(profiles)
    complete_samples = []
    examples = []

    for profile in completed_profiles.values():
        raw_metrics = profile_metrics(profile["samples"])
        if raw_metrics is None:
            continue
        distance_m = float(raw_metrics["distanceMeters"])
        if distance_m <= 0:
            continue
        point_grade = float(raw_metrics.get("maxObservedAbsGrade") or 0)
        point_grade_values.append(point_grade)
        average_abs_net_grade_values.append(abs(float(raw_metrics["netMeters"])) / distance_m)
        sampled_gain_density_values.append(float(raw_metrics["gainMeters"]) / distance_m)
        sampled_loss_density_values.append(float(raw_metrics["lossMeters"]) / distance_m)
        complete_samples.append(profile["samples"])
        example = {
            "edgeId": profile["edgeId"],
            "source": profile["source"],
            "distanceMeters": rounded(distance_m, 1),
            "pointMaxAbsGrade": rounded(point_grade, 4),
            "fixedWindowMaxAbsGrade": {},
        }
        for window_m in GRADE_WINDOWS_M:
            sustained = fixed_window_grade_metrics(profile["samples"], window_m)
            if sustained is None:
                continue
            example["fixedWindowMaxAbsGrade"][f"{int(window_m)}m"] = sustained["maxAbsGrade"]
        examples.append(example)

    examples.sort(
        key=lambda example: (
            float(example["pointMaxAbsGrade"]),
            float(example["distanceMeters"]),
            example["edgeId"],
        ),
        reverse=True,
    )
    return {
        "metricScope": (
            "Point grade is adjacent sampled-point grade. Fixed-window grade is "
            "elevation change over an exact distance window and is diagnostics-only."
        ),
        "pointToPointMaxAbsGrade": {
            "edges": grade_summary(point_grade_values),
            "thresholdCounts": grade_threshold_counts(point_grade_values),
        },
        "edgeAggregateCandidates": {
            "averageAbsNetGrade": {
                "edges": grade_summary(average_abs_net_grade_values),
                "thresholdCounts": grade_threshold_counts(average_abs_net_grade_values),
            },
            "sampledGainPerDistance": {
                "edges": grade_summary(sampled_gain_density_values),
                "thresholdCounts": grade_threshold_counts(sampled_gain_density_values),
            },
            "sampledLossPerDistance": {
                "edges": grade_summary(sampled_loss_density_values),
                "thresholdCounts": grade_threshold_counts(sampled_loss_density_values),
            },
        },
        "fixedWindowMaxAbsGrade": fixed_window_distribution(complete_samples, subject_label="Edges"),
        "degreeTwoChainStitchedMaxAbsGrade": degree_two_chain_grade_diagnostics(
            edges,
            completed_profiles,
        ),
        "highestPointGradeExamples": examples[:MAX_REPORT_EDGE_EXAMPLES],
    }


def elevated_edge(
    edge: dict[str, Any],
    profile: dict[str, Any] | None,
    *,
    sample_spacing_m: float,
    vertical_tolerance_m: float,
    max_retained_gap_m: float,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    output = dict(edge)
    if profile is None:
        output["elevation"] = {
            "status": "missing",
            "sampleSpacingMeters": sample_spacing_m,
            "sampleCount": 0,
            "retainedSampleCount": 0,
            "missingSampleCount": 0,
            "profile": [],
        }
        return output, None

    missing_samples = missing_profile_sample_count(profile)
    if missing_samples:
        output["elevation"] = {
            "status": "missing",
            "sampleSpacingMeters": sample_spacing_m,
            "sampleCount": len(profile["samples"]),
            "retainedSampleCount": 0,
            "missingSampleCount": missing_samples,
            "profile": [],
        }
        return output, None

    retained = simplify_elevation_profile(
        profile["samples"],
        vertical_tolerance_m=vertical_tolerance_m,
        max_retained_gap_m=max_retained_gap_m,
    )
    metrics = profile_metrics(profile["samples"])
    output["elevation"] = {
        "status": "ready",
        "sampleSpacingMeters": sample_spacing_m,
        "sampleCount": len(profile["samples"]),
        "retainedSampleCount": len(retained),
        "profile": compact_profile(retained),
        "metrics": metrics,
    }
    return output, metrics


def source_coverage_summary(
    elevated_edges: list[dict[str, Any]],
) -> dict[str, dict[str, int]]:
    totals = Counter()
    ready = Counter()
    for edge in elevated_edges:
        source = str(edge.get("source") or "unknown")
        totals[source] += 1
        if (edge.get("elevation") or {}).get("status") == "ready":
            ready[source] += 1
    return {
        source: {"edges": count, "ready": ready.get(source, 0)}
        for source, count in sorted(totals.items())
    }


def build_validation(
    elevated_edges: list[dict[str, Any]],
    profile_by_edge_id: dict[str, dict[str, Any]],
    metrics_by_edge_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    ready_edge_ids = []
    missing_edge_ids = []
    sample_count = 0
    ready_sample_count = 0
    retained_count = 0
    missing_sample_count = 0
    for edge in elevated_edges:
        edge_id = edge.get("id")
        elevation = edge.get("elevation") if isinstance(edge.get("elevation"), dict) else {}
        sample_count += int(elevation.get("sampleCount") or 0)
        retained_count += int(elevation.get("retainedSampleCount") or 0)
        missing_sample_count += int(elevation.get("missingSampleCount") or 0)
        if elevation.get("status") == "ready":
            ready_edge_ids.append(edge_id)
            ready_sample_count += int(elevation.get("sampleCount") or 0)
        else:
            missing_edge_ids.append(edge_id)

    metrics = list(metrics_by_edge_id.values())
    retained_reduction_percent = 0.0
    if ready_sample_count:
        retained_reduction_percent = 100 - (retained_count / ready_sample_count * 100)

    return {
        "edges": len(elevated_edges),
        "profileCandidateEdges": len(profile_by_edge_id),
        "readyEdges": len(ready_edge_ids),
        "missingEdges": len(missing_edge_ids),
        "readyCoveragePercent": rounded(len(ready_edge_ids) / max(len(elevated_edges), 1) * 100, 3),
        "sampleOccurrences": sample_count,
        "readySampleOccurrences": ready_sample_count,
        "retainedProfilePoints": retained_count,
        "retainedReductionPercent": rounded(retained_reduction_percent, 1),
        "missingSampleOccurrences": missing_sample_count,
        "missingEdgeIds": missing_edge_ids[:MAX_REPORT_EDGE_EXAMPLES],
        "edgeSources": source_coverage_summary(elevated_edges),
        "metricDistributions": {
            "distanceMeters": numeric_summary(
                [float(metric.get("distanceMeters") or 0) for metric in metrics]
            ),
            "gainMeters": numeric_summary(
                [float(metric.get("gainMeters") or 0) for metric in metrics]
            ),
            "lossMeters": numeric_summary(
                [float(metric.get("lossMeters") or 0) for metric in metrics]
            ),
            "netMeters": numeric_summary(
                [float(metric.get("netMeters") or 0) for metric in metrics]
            ),
        },
    }


def build_elevated_base_graph(args: argparse.Namespace) -> dict[str, Any]:
    graph_path = args.graph.resolve()
    if not graph_path.exists():
        raise FileNotFoundError(f"Base graph not found: {graph_path}")

    graph = load_json(graph_path, {})
    candidate_edges = graph_edges(graph)
    if not candidate_edges:
        raise ValueError(f"Base graph has no edges with geometry: {graph_path}")

    profiles = build_profiles(candidate_edges, [args.sample_spacing])
    if args.cache_only:
        elevation_stats = hydrate_profiles_from_cache(profiles, args.cache_file.resolve())
    else:
        client = ElevationClient(
            elevation_url=args.elevation_url,
            cache_file=args.cache_file.resolve(),
            batch_size=args.batch_size,
        )
        client.hydrate_profiles(profiles)
        elevation_stats = {"fetchSkipped": False, **client.stats}

    profile_by_edge_id = {profile["edgeId"]: profile for profile in profiles}
    metrics_by_edge_id = {}
    elevated_edges = []
    for edge in graph.get("edges", []):
        edge_id = edge.get("id") if isinstance(edge, dict) else None
        profile = profile_by_edge_id.get(edge_id) if isinstance(edge_id, str) else None
        next_edge, metrics = elevated_edge(
            edge,
            profile,
            sample_spacing_m=args.sample_spacing,
            vertical_tolerance_m=args.vertical_tolerance,
            max_retained_gap_m=args.max_retained_gap,
        )
        elevated_edges.append(next_edge)
        if isinstance(edge_id, str) and metrics is not None:
            metrics_by_edge_id[edge_id] = metrics

    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    source_metadata = graph.get("metadata") if isinstance(graph.get("metadata"), dict) else {}
    metadata = dict(source_metadata)
    metadata["elevation"] = {
        "generatedAt": generated_at,
        "sourceGraph": str(graph_path),
        "sourceGraphDigest": file_digest(graph_path),
        "sourceGraphGeneratedAt": source_metadata.get("generatedAt"),
        "profileEncoding": "[offsetMeters,elevationMeters]",
        "sampleSpacingMeters": args.sample_spacing,
        "verticalToleranceMeters": args.vertical_tolerance,
        "maxRetainedGapMeters": args.max_retained_gap,
    }

    elevated_graph = dict(graph)
    elevated_graph["metadata"] = metadata
    elevated_graph["edges"] = elevated_edges

    validation = build_validation(elevated_edges, profile_by_edge_id, metrics_by_edge_id)
    output_graph = args.output_graph.resolve()
    report_path = args.report.resolve()
    report = {
        "generatedAt": generated_at,
        "inputs": {
            "graph": str(graph_path),
            "graphDigest": metadata["elevation"]["sourceGraphDigest"],
        },
        "outputs": {
            "graph": str(output_graph),
            "report": str(report_path),
        },
        "settings": {
            "sampleSpacingMeters": args.sample_spacing,
            "verticalToleranceMeters": args.vertical_tolerance,
            "maxRetainedGapMeters": args.max_retained_gap,
            "cacheOnly": args.cache_only,
        },
        "elevation": elevation_stats,
        "validation": validation,
        "gradeDiagnostics": profile_grade_diagnostics(profiles, candidate_edges),
    }
    write_json(output_graph, elevated_graph, compact=True)
    write_json(report_path, report)
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", type=Path, default=DEFAULT_GRAPH_PATH, help="2D base graph JSON input.")
    parser.add_argument(
        "--output-graph",
        type=Path,
        default=DEFAULT_OUTPUT_GRAPH_PATH,
        help="Elevated base graph JSON output.",
    )
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_PATH, help="Build report JSON output.")
    parser.add_argument(
        "--sample-spacing",
        type=float,
        default=DEFAULT_SAMPLE_SPACING_M,
        help="Acquisition spacing in meters before profile simplification.",
    )
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
        help="Maximum retained profile point gap target in meters.",
    )
    parser.add_argument("--elevation-url", default=DEFAULT_ELEVATION_URL, help="Elevation API lookup URL.")
    parser.add_argument(
        "--cache-file",
        type=Path,
        default=DEFAULT_CACHE_FILE,
        help="Persistent elevation sampling cache shared with the elevation lab.",
    )
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="POST batch size.")
    parser.add_argument(
        "--cache-only",
        action="store_true",
        help="Use only cached elevation samples and report missing profiles without network lookup.",
    )
    parser.add_argument(
        "--allow-missing-elevation",
        action="store_true",
        help="Exit successfully even when one or more graph edges lack a complete elevation profile.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.sample_spacing <= 0:
        parser.error("--sample-spacing must be greater than zero")
    if args.vertical_tolerance < 0:
        parser.error("--vertical-tolerance must be zero or greater")
    if args.max_retained_gap <= 0:
        parser.error("--max-retained-gap must be greater than zero")
    if args.batch_size <= 0:
        parser.error("--batch-size must be greater than zero")

    try:
        report = build_elevated_base_graph(args)
    except Exception as exc:
        print(f"Elevated base graph build failed: {exc}", file=sys.stderr)
        return 1

    validation = report["validation"]
    print(f"Elevated base graph: {report['outputs']['graph']}")
    print(f"Elevation report: {report['outputs']['report']}")
    print(
        "Coverage: "
        f"{validation['readyEdges']}/{validation['edges']} ready edges "
        f"({validation['readyCoveragePercent']}%)"
    )
    print(
        "Ready profile points: "
        f"{validation['readySampleOccurrences']} sampled -> "
        f"{validation['retainedProfilePoints']} retained "
        f"({validation['retainedReductionPercent']}% reduction); "
        f"{validation['sampleOccurrences']} planned sample occurrences"
    )
    if validation["missingEdges"] and not args.allow_missing_elevation:
        print(
            "Elevated base graph build has incomplete profiles. "
            "Inspect the report, restore the elevation service/cache, or rerun "
            "with --allow-missing-elevation for a partial inspection artifact.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
