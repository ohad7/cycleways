import { useEffect, useMemo, useRef } from "react";
import { smoothElevations } from "../../utils/elevations.js";
import { getDistance } from "../../utils/distance.js";

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
          <defs>
            <linearGradient id="reactElevationGradient" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#748873" stopOpacity="1" />
              <stop offset="33%" stopColor="#D1A980" stopOpacity="1" />
              <stop offset="66%" stopColor="#E5E0D8" stopOpacity="1" />
              <stop offset="100%" stopColor="#F8F8F8" stopOpacity="1" />
            </linearGradient>
          </defs>
          <path
            d={profile.pathData}
            fill="url(#reactElevationGradient)"
            stroke="#748873"
            strokeWidth="0.5"
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

  const minElevation = Math.min(...coordsWithElevation.map((point) => point.elevation));
  const maxElevation = Math.max(...coordsWithElevation.map((point) => point.elevation));
  const range = maxElevation - minElevation || 100;
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

    const heightPercent = Math.max(
      5,
      ((elevation - minElevation) / range) * 80 + 10,
    );
    const distancePercent = (x / profileWidth) * 100;
    elevationData.push({
      elevation,
      distance: distanceAtX,
      coord,
      heightPercent,
      distancePercent,
    });
  }

  let pathData = "";
  elevationData.forEach((point, index) => {
    const x = point.distancePercent;
    const y = 100 - point.heightPercent;
    pathData += `${index === 0 ? "M" : " L"} ${x} ${y}`;
  });

  return {
    elevationData,
    pathData: `${pathData} L 100 100 L 0 100 Z`,
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
