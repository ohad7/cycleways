import { smoothElevations } from "../utils/elevations.js";
import { getDistance } from "../utils/distance.js";
import { GRADE_COLORS, classifyGrade, pointSmoothedGrades } from "../utils/grade.js";
import { clusterByGrade } from "../utils/slopeClustering.js";
import { computeBearing } from "../domain/routeDirectionAnimator.js";

export function buildElevationProfile(geometry) {
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

  const MIN_VERTICAL_RANGE_M = 60;
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
    let bearing = null;
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
      bearing = computeBearing(beforePoint, afterPoint);
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
      progress: distanceAtX / totalDistance,
      coord,
      bearing,
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
  const baseAreaPath = buildElevationAreaPath(elevationData);
  const clusterPaths = clusters.map((cluster) => {
    const startD = cumDistances[cluster.startIdx];
    const endD = cumDistances[cluster.endIdx];
    const startX = (startD / totalDistanceForClusters) * 100;
    const endX = (endD / totalDistanceForClusters) * 100;
    const slice = elevationPointsForRange(elevationData, startX, endX);
    if (slice.length < 2) return null;
    return {
      d: buildElevationAreaPath(slice),
      color: GRADE_COLORS[cluster.gradeClass],
      startPercent: startX,
      endPercent: endX,
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
    baseAreaPath,
    clusterPaths,
    outlinePath,
  };
}

function buildElevationAreaPath(points) {
  if (!Array.isArray(points) || points.length < 2) return "";
  const first = points[0];
  const last = points[points.length - 1];
  let d = `M ${first.distancePercent} 100`;
  for (const point of points) {
    d += ` L ${point.distancePercent} ${100 - point.heightPercent}`;
  }
  return `${d} L ${last.distancePercent} 100 Z`;
}

function elevationPointsForRange(elevationData, startPercent, endPercent) {
  const start = interpolateElevationPoint(elevationData, startPercent);
  const end = interpolateElevationPoint(elevationData, endPercent);
  if (!start || !end || end.distancePercent <= start.distancePercent) return [];
  return [
    start,
    ...elevationData.filter(
      (point) =>
        point.distancePercent > start.distancePercent &&
        point.distancePercent < end.distancePercent,
    ),
    end,
  ];
}

function interpolateElevationPoint(elevationData, distancePercent) {
  if (!Array.isArray(elevationData) || elevationData.length === 0) return null;
  const x = Math.max(0, Math.min(100, Number(distancePercent)));
  if (!Number.isFinite(x)) return null;

  const first = elevationData[0];
  const last = elevationData[elevationData.length - 1];
  if (x <= first.distancePercent) return { ...first, distancePercent: x };
  if (x >= last.distancePercent) return { ...last, distancePercent: x };

  for (let index = 0; index < elevationData.length - 1; index++) {
    const before = elevationData[index];
    const after = elevationData[index + 1];
    if (before.distancePercent > x || after.distancePercent < x) continue;
    const span = after.distancePercent - before.distancePercent;
    const ratio = span > 0 ? (x - before.distancePercent) / span : 0;
    return {
      ...before,
      distancePercent: x,
      heightPercent: lerp(before.heightPercent, after.heightPercent, ratio),
      elevation: lerp(before.elevation, after.elevation, ratio),
      distance: lerp(before.distance, after.distance, ratio),
      progress: lerp(before.progress, after.progress, ratio),
      coord: before.coord && after.coord ? {
        lat: lerp(before.coord.lat, after.coord.lat, ratio),
        lng: lerp(before.coord.lng, after.coord.lng, ratio),
      } : before.coord,
      bearing: before.bearing ?? after.bearing,
    };
  }

  return { ...last, distancePercent: x };
}

function lerp(a, b, ratio) {
  return a + (b - a) * ratio;
}

export function findClosestElevationPoint(elevationData, xPercent) {
  if (!Array.isArray(elevationData) || elevationData.length === 0) return null;

  return elevationData.reduce((closest, point) => {
    const distanceFromPointer = Math.abs(point.distancePercent - xPercent);
    if (!closest || distanceFromPointer < closest.distanceFromPointer) {
      return { ...point, distanceFromPointer };
    }
    return closest;
  }, null);
}

export function buildElevationHoverPayload(point) {
  if (!point) return null;
  return {
    coord: point.coord,
    bearing: point.bearing,
    distance: point.distance,
    t: point.progress,
    elevation: point.elevation,
    grade: point.grade,
    gradeClass: point.gradeClass,
  };
}

export function formatLegacyDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return "0 ק\"מ";
  return `${(distanceMeters / 1000).toFixed(1)} ק"מ`;
}
