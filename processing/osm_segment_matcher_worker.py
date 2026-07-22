#!/usr/bin/env python3
"""Long-lived NDJSON worker for CycleWays single-segment OSM matching.

The production CLI remains the full-build and equivalence path. This worker
keeps the parsed graph plus spatial/connectivity indexes warm for editor
requests. Stdout is protocol-only NDJSON; diagnostics go to stderr.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any

try:
    from .match_cycleways_to_osm_graph import (
        DEFAULT_DIRECTION_LIMIT_DEGREES,
        DEFAULT_DIRECTION_PENALTY_M,
        DEFAULT_GRID_CELL_M,
        DEFAULT_MAX_DISTANCE_M,
        DEFAULT_SAMPLE_SPACING_M,
        EdgeConnectivityIndex,
        EdgeSpatialIndex,
        build_single_segment_preview,
        coordinate_bounds,
        finalize_single_segment_performance,
        make_projection,
        match_segment,
        record_performance_phase,
    )
except ImportError:  # Direct script execution: processing/ is on sys.path.
    from match_cycleways_to_osm_graph import (  # type: ignore
        DEFAULT_DIRECTION_LIMIT_DEGREES,
        DEFAULT_DIRECTION_PENALTY_M,
        DEFAULT_GRID_CELL_M,
        DEFAULT_MAX_DISTANCE_M,
        DEFAULT_SAMPLE_SPACING_M,
        EdgeConnectivityIndex,
        EdgeSpatialIndex,
        build_single_segment_preview,
        coordinate_bounds,
        finalize_single_segment_performance,
        make_projection,
        match_segment,
        record_performance_phase,
    )


PROTOCOL_VERSION = 1


class PreparedSegmentMatcher:
    """Reusable graph projection and indexes for editor segment matches."""

    def __init__(
        self,
        graph_edges_geojson: dict[str, Any],
        *,
        graph_digest: str,
        sample_spacing_m: float = DEFAULT_SAMPLE_SPACING_M,
        max_distance_m: float = DEFAULT_MAX_DISTANCE_M,
        direction_limit_degrees: float = DEFAULT_DIRECTION_LIMIT_DEGREES,
        direction_penalty_m: float = DEFAULT_DIRECTION_PENALTY_M,
        grid_cell_m: float = DEFAULT_GRID_CELL_M,
    ) -> None:
        started_at = perf_counter()
        self.graph_edges_geojson = graph_edges_geojson
        self.graph_digest = graph_digest
        self.sample_spacing_m = sample_spacing_m
        self.max_distance_m = max_distance_m
        self.direction_limit_degrees = direction_limit_degrees
        self.direction_penalty_m = direction_penalty_m
        self.grid_cell_m = grid_cell_m
        self.setup_performance: dict[str, Any] = {
            "schemaVersion": 1,
            "phasesMs": {},
        }

        phase_started_at = perf_counter()
        self.edge_features = [
            feature
            for feature in graph_edges_geojson.get("features", [])
            if feature.get("geometry", {}).get("type") == "LineString"
        ]
        record_performance_phase(self.setup_performance, "edgeFilter", phase_started_at)

        phase_started_at = perf_counter()
        self.graph_bounds = coordinate_bounds(
            [{"type": "FeatureCollection", "features": self.edge_features}]
        )
        record_performance_phase(self.setup_performance, "coordinateBounds", phase_started_at)

        phase_started_at = perf_counter()
        self.project = make_projection(self.graph_bounds)
        record_performance_phase(self.setup_performance, "projectionSetup", phase_started_at)

        phase_started_at = perf_counter()
        self.edge_index = EdgeSpatialIndex(
            self.edge_features,
            self.project,
            cell_size_m=grid_cell_m,
            max_distance_m=max_distance_m,
        )
        record_performance_phase(self.setup_performance, "spatialIndexBuild", phase_started_at)

        phase_started_at = perf_counter()
        self.connectivity_index = EdgeConnectivityIndex(self.edge_features)
        record_performance_phase(self.setup_performance, "connectivityIndexBuild", phase_started_at)

        phases = self.setup_performance["phasesMs"]
        self.setup_performance["reusableGraphSetupMs"] = round(
            sum(float(value) for value in phases.values()),
            3,
        )
        self.setup_performance["totalMs"] = round((perf_counter() - started_at) * 1000, 3)
        self.setup_performance["counts"] = self._counts()

    def _counts(self, *, segment_samples: int | None = None) -> dict[str, int]:
        counts = {
            "graphFeatures": len(self.graph_edges_geojson.get("features", [])),
            "graphEdges": len(self.edge_features),
            "spatialSegments": len(self.edge_index.segments),
            "spatialGridCells": len(self.edge_index.grid),
            "connectivityEdges": len(self.connectivity_index.edge_by_id),
            "connectivityNodes": len(self.connectivity_index.adjacency),
        }
        if segment_samples is not None:
            counts["segmentSamples"] = segment_samples
        return counts

    def supports_cached_projection(self, segment_feature: dict[str, Any]) -> bool:
        """True when the CLI's graph+segment bounds equal the graph bounds.

        The one-shot CLI includes the segment in coordinate-bounds calculation.
        A segment completely inside graph bounds therefore uses the exact same
        projection. Out-of-bounds drafts take the one-shot fallback so worker
        and CLI behavior remain equivalent.
        """
        geometry = segment_feature.get("geometry") or {}
        if geometry.get("type") != "LineString":
            return False
        min_lng, min_lat, max_lng, max_lat = self.graph_bounds
        coordinates = geometry.get("coordinates") or []
        if not coordinates:
            return False
        return all(
            len(coord) >= 2
            and min_lng <= float(coord[0]) <= max_lng
            and min_lat <= float(coord[1]) <= max_lat
            for coord in coordinates
        )

    def match(
        self,
        segment_feature: dict[str, Any],
    ) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
        measured_started_at = perf_counter()
        performance: dict[str, Any] = {
            "schemaVersion": 1,
            "phasesMs": {},
        }
        cache_hit = self.supports_cached_projection(segment_feature)

        if cache_hit:
            phase_started_at = perf_counter()
            summary, preview_features = match_segment(
                segment_feature,
                self.edge_index,
                self.connectivity_index,
                self.edge_features,
                self.project,
                sample_spacing_m=self.sample_spacing_m,
                max_distance_m=self.max_distance_m,
                direction_limit_degrees=self.direction_limit_degrees,
                direction_penalty_m=self.direction_penalty_m,
            )
            record_performance_phase(performance, "segmentMatch", phase_started_at)
            performance["counts"] = self._counts(
                segment_samples=int(summary.get("sampleCount") or 0),
            )
        else:
            summary, preview_features = build_single_segment_preview(
                segment_feature,
                self.graph_edges_geojson,
                sample_spacing_m=self.sample_spacing_m,
                max_distance_m=self.max_distance_m,
                direction_limit_degrees=self.direction_limit_degrees,
                direction_penalty_m=self.direction_penalty_m,
                grid_cell_m=self.grid_cell_m,
                performance=performance,
            )

        performance["worker"] = {
            "protocolVersion": PROTOCOL_VERSION,
            "cacheHit": cache_hit,
            "graphDigest": self.graph_digest,
            "preparedSetupMs": self.setup_performance["totalMs"],
        }
        finalize_single_segment_performance(performance, measured_started_at)
        return summary, preview_features, performance


def load_prepared_matcher(args: argparse.Namespace) -> PreparedSegmentMatcher:
    started_at = perf_counter()
    contents = args.graph_edges.read_bytes()
    read_ms = round((perf_counter() - started_at) * 1000, 3)
    started_at = perf_counter()
    graph_edges_geojson = json.loads(contents)
    parse_ms = round((perf_counter() - started_at) * 1000, 3)
    digest = f"sha256:{hashlib.sha256(contents).hexdigest()}"
    matcher = PreparedSegmentMatcher(
        graph_edges_geojson,
        graph_digest=digest,
        sample_spacing_m=args.sample_spacing_m,
        max_distance_m=args.max_distance_m,
        direction_limit_degrees=args.direction_limit_degrees,
        direction_penalty_m=args.direction_penalty_m,
        grid_cell_m=args.grid_cell_m,
    )
    matcher.setup_performance["phasesMs"] = {
        "graphRead": read_ms,
        "graphParse": parse_ms,
        **matcher.setup_performance["phasesMs"],
    }
    matcher.setup_performance["totalMs"] = round(
        read_ms + parse_ms + matcher.setup_performance["totalMs"],
        3,
    )
    return matcher


def protocol_write(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def serve(matcher: PreparedSegmentMatcher) -> None:
    protocol_write(
        {
            "type": "ready",
            "protocolVersion": PROTOCOL_VERSION,
            "graphDigest": matcher.graph_digest,
            "performance": matcher.setup_performance,
        }
    )
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        request_id: str | int | None = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            action = request.get("action")
            if action == "close":
                protocol_write({"type": "closed", "id": request_id})
                return
            if action == "ping":
                protocol_write(
                    {
                        "type": "pong",
                        "id": request_id,
                        "graphDigest": matcher.graph_digest,
                    }
                )
                continue
            if action != "match":
                raise ValueError(f"Unknown worker action: {action}")
            feature = request.get("feature")
            if not isinstance(feature, dict):
                raise ValueError("match requires a GeoJSON feature")
            summary, preview_features, performance = matcher.match(feature)
            protocol_write(
                {
                    "type": "result",
                    "id": request_id,
                    "result": {
                        "generatedAt": datetime.now(timezone.utc).isoformat(),
                        "summary": summary,
                        "preview": {
                            "type": "FeatureCollection",
                            "features": preview_features,
                        },
                        "performance": performance,
                    },
                }
            )
        except Exception as error:  # Keep the worker alive after one bad request.
            protocol_write(
                {
                    "type": "error",
                    "id": request_id,
                    "error": str(error),
                    "errorType": type(error).__name__,
                }
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--graph-edges",
        type=Path,
        default=Path("build/osm/osm-base-edges.geojson"),
    )
    parser.add_argument("--sample-spacing-m", type=float, default=DEFAULT_SAMPLE_SPACING_M)
    parser.add_argument("--max-distance-m", type=float, default=DEFAULT_MAX_DISTANCE_M)
    parser.add_argument(
        "--direction-limit-degrees",
        type=float,
        default=DEFAULT_DIRECTION_LIMIT_DEGREES,
    )
    parser.add_argument("--direction-penalty-m", type=float, default=DEFAULT_DIRECTION_PENALTY_M)
    parser.add_argument("--grid-cell-m", type=float, default=DEFAULT_GRID_CELL_M)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    matcher = load_prepared_matcher(args)
    serve(matcher)


if __name__ == "__main__":
    main()
