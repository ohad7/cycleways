// Pixel-space and route-click geometry helpers extracted from MapView. These
// translate Mapbox-GL pixel/event data into geographic results (lng/lat,
// segment names) so the rest of the app never sees pixels. createClickStamp /
// isDuplicateRouteClick accept an injectable clock (now = Date.now) for
// deterministic testing.
import { distanceToLineSegmentPixels } from "../../utils/distance.js";
import { DATA_MARKERS_LAYER_ID } from "./mapLayers.js";

export function buildNetworkSegments(features) {
  return (features || [])
    .map((feature) => {
      const coordinates = (feature.geometry?.coordinates || [])
        .map((coord) => ({
          lng: Number(coord[0]),
          lat: Number(coord[1]),
          elevation: coord[2],
        }))
        .filter((coord) => Number.isFinite(coord.lng) && Number.isFinite(coord.lat));

      return {
        segmentName: feature.properties?.name || null,
        coordinates,
      };
    })
    .filter((segment) => segment.segmentName && segment.coordinates.length >= 2);
}

export function findClosestRouteSegment(map, event, networkSegments, thresholdPixels = 15) {
  if (!map || !event?.lngLat || !Array.isArray(networkSegments)) return null;
  if (typeof map.isMoving === "function" && map.isMoving()) return null;

  const mousePixel = event.point || map.project?.(event.lngLat);
  if (!mousePixel) return null;

  let closest = null;
  let minPixelDistance = Infinity;

  networkSegments.forEach((segment) => {
    const coords = segment.coordinates;
    for (let index = 0; index < coords.length - 1; index++) {
      const start = coords[index];
      const end = coords[index + 1];
      const startPixel = projectPoint(map, start);
      const endPixel = projectPoint(map, end);
      if (!startPixel || !endPixel) continue;

      const distance = distanceToLineSegmentPixels(
        mousePixel,
        startPixel,
        endPixel,
      );

      if (distance < minPixelDistance) {
        minPixelDistance = distance;
        closest = {
          segmentName: segment.segmentName,
          point: getClosestPointOnLineSegment(
            { lat: event.lngLat.lat, lng: event.lngLat.lng },
            start,
            end,
          ),
        };
      }
    }
  });

  return minPixelDistance < thresholdPixels ? closest : null;
}

function projectPoint(map, point) {
  if (typeof map.project !== "function") return null;
  return map.project([point.lng, point.lat]);
}

export function getClosestPointOnLineSegment(point, lineStart, lineEnd) {
  const a = point.lng - lineStart.lng;
  const b = point.lat - lineStart.lat;
  const c = lineEnd.lng - lineStart.lng;
  const d = lineEnd.lat - lineStart.lat;

  const dot = a * c + b * d;
  const lenSq = c * c + d * d;
  const param = lenSq === 0 ? -1 : dot / lenSq;

  if (param < 0) {
    return { lat: lineStart.lat, lng: lineStart.lng };
  }

  if (param > 1) {
    return { lat: lineEnd.lat, lng: lineEnd.lng };
  }

  return {
    lng: lineStart.lng + param * c,
    lat: lineStart.lat + param * d,
  };
}

export function isPointTooCloseToRouteUi(map, point, routePoints, dataMarkerFeatures) {
  const hoverPointPixel = projectPoint(map, point);
  if (!hoverPointPixel) return false;

  const isNearRoutePoint = (routePoints || []).some((routePoint) => {
    const routePointPixel = projectPoint(map, routePoint);
    if (!routePointPixel) return false;
    return pixelDistance(hoverPointPixel, routePointPixel) < 15;
  });

  if (isNearRoutePoint) return true;

  const renderedMarkers =
    map.getLayer?.(DATA_MARKERS_LAYER_ID) && typeof map.queryRenderedFeatures === "function"
      ? map.queryRenderedFeatures(hoverPointPixel, {
          layers: [DATA_MARKERS_LAYER_ID],
        })
      : [];

  if (renderedMarkers.length > 0) return true;

  return (dataMarkerFeatures || []).some((feature) => {
    const [lng, lat] = feature.geometry?.coordinates || [];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
    const markerPixel = projectPoint(map, { lng, lat });
    return markerPixel ? pixelDistance(hoverPointPixel, markerPixel) < 25 : false;
  });
}

export function pixelDistance(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function createClickStamp(event, now = Date.now) {
  return {
    x: Number(event?.point?.x),
    y: Number(event?.point?.y),
    lng: Number(event?.lngLat?.lng),
    lat: Number(event?.lngLat?.lat),
    time: now(),
  };
}

export function isDuplicateRouteClick(previousClick, event, now = Date.now) {
  if (!previousClick) return false;
  if (now() - previousClick.time > 250) return false;

  const nextClick = createClickStamp(event, now);
  const hasPointCoordinates =
    Number.isFinite(previousClick.x) &&
    Number.isFinite(previousClick.y) &&
    Number.isFinite(nextClick.x) &&
    Number.isFinite(nextClick.y);
  const hasMapCoordinates =
    Number.isFinite(previousClick.lng) &&
    Number.isFinite(previousClick.lat) &&
    Number.isFinite(nextClick.lng) &&
    Number.isFinite(nextClick.lat);

  if (hasPointCoordinates && hasMapCoordinates) {
    return (
      Math.abs(previousClick.x - nextClick.x) < 1 &&
      Math.abs(previousClick.y - nextClick.y) < 1 &&
      Math.abs(previousClick.lng - nextClick.lng) < 0.000001 &&
      Math.abs(previousClick.lat - nextClick.lat) < 0.000001
    );
  }

  if (hasPointCoordinates) {
    return (
      Math.abs(previousClick.x - nextClick.x) < 1 &&
      Math.abs(previousClick.y - nextClick.y) < 1
    );
  }

  return (
    hasMapCoordinates &&
    Math.abs(previousClick.lng - nextClick.lng) < 0.000001 &&
    Math.abs(previousClick.lat - nextClick.lat) < 0.000001
  );
}
