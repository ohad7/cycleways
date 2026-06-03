import { getDistance } from "../utils/distance.js";

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

export function buildRouteDirectionPulseFeatureCollection(
  routeGeometry,
  progress,
) {
  if (!Number.isFinite(progress)) return EMPTY_FEATURE_COLLECTION;

  const points = normalizeRouteGeometry(routeGeometry);
  if (points.length < 2) return EMPTY_FEATURE_COLLECTION;

  const arc = precomputeRoutePulseArc(points);
  if (!(arc.totalDistMeters > 0)) return EMPTY_FEATURE_COLLECTION;

  const pulseMeters = Math.min(
    Math.max(arc.totalDistMeters * 0.045, 80),
    420,
  );
  const headDist = Math.min(
    arc.totalDistMeters,
    Math.max(0, progress) * arc.totalDistMeters,
  );
  const visibleHeadDist = Math.min(
    arc.totalDistMeters,
    Math.max(headDist, Math.min(pulseMeters * 0.35, arc.totalDistMeters)),
  );
  const tailDist = Math.max(0, visibleHeadDist - pulseMeters);
  const coordinates = sliceRoutePulseCoordinates(
    points,
    arc.cumDist,
    tailDist,
    visibleHeadDist,
  );

  return coordinates.length >= 2
    ? {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates,
            },
            properties: {},
          },
        ],
      }
    : EMPTY_FEATURE_COLLECTION;
}

function normalizeRouteGeometry(routeGeometry) {
  return Array.isArray(routeGeometry)
    ? routeGeometry
        .map((point) => ({
          lng: Number(point?.lng),
          lat: Number(point?.lat),
        }))
        .filter(
          (point) => Number.isFinite(point.lng) && Number.isFinite(point.lat),
        )
    : [];
}

function precomputeRoutePulseArc(points) {
  const cumDist = new Float64Array(points.length);
  let totalDistMeters = 0;

  for (let i = 1; i < points.length; i++) {
    const distance = getDistance(points[i - 1], points[i]);
    totalDistMeters += Number.isFinite(distance) && distance > 0 ? distance : 0;
    cumDist[i] = totalDistMeters;
  }

  return { cumDist, totalDistMeters };
}

function sliceRoutePulseCoordinates(points, cumDist, startDist, endDist) {
  const coordinates = [routePulsePointAtDistance(points, cumDist, startDist)];

  for (let i = 1; i < points.length - 1; i++) {
    if (cumDist[i] > startDist && cumDist[i] < endDist) {
      coordinates.push([points[i].lng, points[i].lat]);
    }
  }

  coordinates.push(routePulsePointAtDistance(points, cumDist, endDist));
  return coordinates.filter((coordinate, index, arr) => {
    if (index === 0) return true;
    const previous = arr[index - 1];
    return coordinate[0] !== previous[0] || coordinate[1] !== previous[1];
  });
}

function routePulsePointAtDistance(points, cumDist, distanceMeters) {
  const target = Math.max(
    0,
    Math.min(distanceMeters, cumDist[cumDist.length - 1]),
  );
  let segmentIndex = 0;

  while (
    segmentIndex < cumDist.length - 2 &&
    cumDist[segmentIndex + 1] < target
  ) {
    segmentIndex++;
  }

  const a = points[segmentIndex];
  const b = points[segmentIndex + 1];
  const segmentStart = cumDist[segmentIndex];
  const segmentLength = cumDist[segmentIndex + 1] - segmentStart;
  const fraction =
    segmentLength > 0 ? (target - segmentStart) / segmentLength : 0;

  return [
    a.lng + (b.lng - a.lng) * fraction,
    a.lat + (b.lat - a.lat) * fraction,
  ];
}
