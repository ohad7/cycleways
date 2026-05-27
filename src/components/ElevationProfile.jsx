import { useEffect, useMemo, useRef } from "react";
import { smoothElevations } from "../../utils/elevations.js";
import { getDistance } from "../../utils/distance.js";
import { GRADE_COLORS, pointSmoothedGrades, classifyGrade } from "../utils/grade.js";
import { clusterByGrade } from "../utils/slopeClustering.js";

export default function ElevationProfile({ animator, distance, geometry, onElevationHover }) {
  const profile = useMemo(() => buildElevationProfile(geometry), [geometry]);
  const markerLineRef = useRef(null);

  useEffect(() => {
    if (!animator) return undefined;
    const unsubscribe = animator.subscribe("elevation", (payload) => {
      const line = markerLineRef.current;
      if (!line) return;
      if (!payload) {
        line.setAttribute("opacity", "0");
        return;
      }
      const x = Math.max(0, Math.min(100, payload.t * 100));
      line.setAttribute("x1", x);
      line.setAttribute("x2", x);
      line.setAttribute("opacity", "1");
    });
    return unsubscribe;
  }, [animator]);

  if (!profile) return null;

  const handleInteraction = (event) => {
    const clientX = event.touches?.[0]?.clientX ?? event.clientX;
    if (!Number.isFinite(clientX)) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const xPercent = ((clientX - rect.left) / rect.width) * 100;
    const closestPoint = findClosestElevationPoint(profile.elevationData, xPercent);
    if (!closestPoint) return;

    onElevationHover?.({
      coord: closestPoint.coord,
      distance: closestPoint.distance,
      elevation: closestPoint.elevation,
    });
  };

  const clearHover = () => {
    onElevationHover?.(null);
  };

  return (
    <div className="elevation-profile">
      <h4>גרף גובה (Elevation Profile)</h4>
      <div className="elevation-chart" id="elevation-chart">
        <svg
          aria-hidden="true"
          focusable="false"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          {profile.clusterPaths.map((cluster, index) => (
            <path
              key={`${cluster.gradeClass}-${index}`}
              d={cluster.d}
              fill={cluster.color}
              fillOpacity="0.45"
              stroke="none"
            />
          ))}
          <path
            d={profile.outlinePath}
            fill="none"
            stroke="#3d3d3d"
            strokeOpacity="0.5"
            strokeWidth="0.4"
          />
          <line
            ref={markerLineRef}
            x1="0"
            x2="0"
            y1="0"
            y2="100"
            stroke="#ffd54a"
            strokeWidth="0.6"
            strokeLinecap="round"
            opacity="0"
            style={{ pointerEvents: "none" }}
          />
        </svg>
        <div
          className="elevation-hover-overlay"
          onMouseMove={handleInteraction}
          onMouseLeave={clearHover}
          onTouchStart={handleInteraction}
          onTouchMove={handleInteraction}
          onTouchEnd={clearHover}
        />
      </div>
      <div className="elevation-labels">
        <span className="distance-label">{formatLegacyDistance(distance)}</span>
        <span className="distance-label">0 ק"מ</span>
      </div>
    </div>
  );
}

function buildElevationProfile(geometry) {
  const routeWithElevation = (geometry || []).map((point) => ({
    lat: point.lat,
    lng: point.lng,
    elevation: Number(point.elevation ?? point.ele ?? point.altitude),
  }));

  if (
    routeWithElevation.length < 2 ||
    routeWithElevation.some(
      (point) =>
        !Number.isFinite(point.lat) ||
        !Number.isFinite(point.lng) ||
        !Number.isFinite(point.elevation),
    )
  ) {
    return null;
  }

  const smoothedRouteCoords = smoothElevations(routeWithElevation, 100);
  const totalDistance = smoothedRouteCoords.reduce((total, coord, index) => {
    if (index === 0) return 0;
    return total + getDistance(smoothedRouteCoords[index - 1], coord);
  }, 0);

  if (totalDistance === 0) return null;

  const coordsWithElevation = smoothedRouteCoords.map((coord, index) => {
    const pointDistance =
      index === 0
        ? 0
        : smoothedRouteCoords.slice(0, index + 1).reduce((total, candidate, idx) => {
            if (idx === 0) return 0;
            return total + getDistance(smoothedRouteCoords[idx - 1], candidate);
          }, 0);
    return { ...coord, distance: pointDistance };
  });

  const cumDistances = coordsWithElevation.map((p) => p.distance);
  const elevations = coordsWithElevation.map((p) => p.elevation);
  const smoothedGrades = pointSmoothedGrades(cumDistances, elevations, 200);
  const clusters = clusterByGrade(cumDistances, elevations, { minDistanceM: 100 });

  const MIN_VERTICAL_RANGE_M = 100;
  const observedMin = Math.min(...coordsWithElevation.map((point) => point.elevation));
  const observedMax = Math.max(...coordsWithElevation.map((point) => point.elevation));
  const observedRange = observedMax - observedMin;
  const renderedRange = Math.max(observedRange, MIN_VERTICAL_RANGE_M);
  const center = (observedMin + observedMax) / 2;
  const minElevation = center - renderedRange / 2;
  const range = renderedRange;
  const profileWidth = 300;
  const elevationData = [];

  for (let x = 0; x <= profileWidth; x++) {
    const distanceAtX = (x / profileWidth) * totalDistance;
    let beforePoint = null;
    let afterPoint = null;

    for (let index = 0; index < coordsWithElevation.length - 1; index++) {
      if (
        coordsWithElevation[index].distance <= distanceAtX &&
        coordsWithElevation[index + 1].distance >= distanceAtX
      ) {
        beforePoint = coordsWithElevation[index];
        afterPoint = coordsWithElevation[index + 1];
        break;
      }
    }

    let elevation;
    let coord;
    if (beforePoint && afterPoint) {
      const ratio =
        (distanceAtX - beforePoint.distance) /
        (afterPoint.distance - beforePoint.distance || 1);
      elevation =
        beforePoint.elevation +
        (afterPoint.elevation - beforePoint.elevation) * ratio;
      coord = {
        lat: beforePoint.lat + (afterPoint.lat - beforePoint.lat) * ratio,
        lng: beforePoint.lng + (afterPoint.lng - beforePoint.lng) * ratio,
      };
    } else if (beforePoint) {
      elevation = beforePoint.elevation;
      coord = beforePoint;
    } else {
      elevation = coordsWithElevation[0].elevation;
      coord = coordsWithElevation[0];
    }

    const heightPercent = ((elevation - minElevation) / range) * 80 + 10;
    const distancePercent = (x / profileWidth) * 100;
    elevationData.push({
      elevation,
      distance: distanceAtX,
      coord,
      heightPercent,
      distancePercent,
    });
  }

  // Annotate each rendered data point with grade info from the closest
  // original geometry index (linear scan over original distances is O(n*m)
  // but n=301 and m is typically <2000; acceptable for now).
  let lastIdx = 0;
  for (const point of elevationData) {
    while (
      lastIdx < cumDistances.length - 1 &&
      cumDistances[lastIdx + 1] < point.distance
    ) {
      lastIdx++;
    }
    point.grade = smoothedGrades[lastIdx];
    point.gradeClass = classifyGrade(point.grade);
  }

  // Build one area-under-curve path per cluster. The path uses the
  // resampled elevationData points that fall within each cluster's
  // distance range, plus the cluster boundary x values for clean edges.
  const totalDistanceForClusters = cumDistances[cumDistances.length - 1];
  const clusterPaths = clusters.map((cluster) => {
    const startD = cumDistances[cluster.startIdx];
    const endD = cumDistances[cluster.endIdx];
    const startX = (startD / totalDistanceForClusters) * 100;
    const endX = (endD / totalDistanceForClusters) * 100;
    const slice = elevationData.filter(
      (p) => p.distancePercent >= startX && p.distancePercent <= endX,
    );
    if (slice.length < 2) return null;
    let d = `M ${slice[0].distancePercent} 100`;
    for (const p of slice) {
      d += ` L ${p.distancePercent} ${100 - p.heightPercent}`;
    }
    d += ` L ${slice[slice.length - 1].distancePercent} 100 Z`;
    return {
      d,
      color: GRADE_COLORS[cluster.gradeClass],
      gradeClass: cluster.gradeClass,
    };
  }).filter(Boolean);

  // Outline of the full elevation curve over the top of the cluster fills.
  let outlinePath = "";
  elevationData.forEach((point, index) => {
    const x = point.distancePercent;
    const y = 100 - point.heightPercent;
    outlinePath += `${index === 0 ? "M" : " L"} ${x} ${y}`;
  });

  return {
    elevationData,
    clusterPaths,
    outlinePath,
  };
}

function findClosestElevationPoint(elevationData, xPercent) {
  if (!Array.isArray(elevationData) || elevationData.length === 0) return null;

  return elevationData.reduce((closest, point) => {
    const distanceFromPointer = Math.abs(point.distancePercent - xPercent);
    if (!closest || distanceFromPointer < closest.distanceFromPointer) {
      return { ...point, distanceFromPointer };
    }
    return closest;
  }, null);
}

export function formatLegacyDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return "0 ק\"מ";
  return `${(distanceMeters / 1000).toFixed(1)} ק"מ`;
}
