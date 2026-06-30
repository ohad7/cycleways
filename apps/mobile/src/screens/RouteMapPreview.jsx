import { useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Mapbox, {
  Camera,
  CircleLayer,
  LineLayer,
  MapView,
  ShapeSource,
} from "@rnmapbox/maps";
import { POI_COLORS } from "@cycleways/core/data/poiTypes.js";

// Read-only route map for the detail screen: the route line + POI markers, fit
// to the route. POI coordinates come from the snapshot's `location` array, which
// is [lat, lng] (lat-first); geometry points are { lng, lat } objects.
const ROUTE_LINE_STYLE = {
  lineColor: "#006699",
  lineWidth: 4,
  lineOpacity: 0.95,
  lineJoin: "round",
  lineCap: "round",
};
const POI_STYLE = {
  circleRadius: 5,
  circleColor: ["coalesce", ["get", "color"], "#1e668c"],
  circleStrokeColor: "#ffffff",
  circleStrokeWidth: 2,
};
// The video-synced cursor: a brand-blue dot that rides the route as the video
// plays.
const CURSOR_STYLE = {
  circleRadius: 7,
  circleColor: "#006699",
  circleStrokeColor: "#ffffff",
  circleStrokeWidth: 3,
};
const EMPTY_FC = { type: "FeatureCollection", features: [] };

function cursorFeature(cursor) {
  const lng = Number(cursor?.lng);
  const lat = Number(cursor?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return EMPTY_FC;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [lng, lat] },
      },
    ],
  };
}

function lineFeature(geometry) {
  const coords = (geometry || [])
    .filter((p) => Number.isFinite(p?.lng) && Number.isFinite(p?.lat))
    .map((p) => [p.lng, p.lat]);
  return {
    type: "FeatureCollection",
    features:
      coords.length >= 2
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: coords },
            },
          ]
        : [],
  };
}

function poiFeatures(points) {
  return {
    type: "FeatureCollection",
    features: (points || [])
      .map((p) => {
        const loc = p?.location;
        if (!Array.isArray(loc) || loc.length < 2) return null;
        const lat = Number(loc[0]);
        const lng = Number(loc[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        return {
          type: "Feature",
          properties: { color: POI_COLORS[p?.type] || "#1e668c" },
          geometry: { type: "Point", coordinates: [lng, lat] },
        };
      })
      .filter(Boolean),
  };
}

function bounds(geometry) {
  const coords = (geometry || []).filter(
    (p) => Number.isFinite(p?.lng) && Number.isFinite(p?.lat),
  );
  if (coords.length < 2) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const p of coords) {
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
  }
  return { ne: [maxLng, maxLat], sw: [minLng, minLat] };
}

export default function RouteMapPreview({
  geometry,
  activeDataPoints,
  cursor = null,
  height = 220,
}) {
  const cameraRef = useRef(null);
  const line = useMemo(() => lineFeature(geometry), [geometry]);
  const pois = useMemo(() => poiFeatures(activeDataPoints), [activeDataPoints]);
  const fit = useMemo(() => bounds(geometry), [geometry]);
  const cursorFc = useMemo(() => cursorFeature(cursor), [cursor]);

  return (
    <View style={[styles.wrap, { height }]}>
      <MapView
        style={styles.fill}
        styleURL={Mapbox.StyleURL.Outdoors}
        scrollEnabled
        zoomEnabled
        rotateEnabled={false}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={
            fit
              ? {
                  bounds: {
                    ne: fit.ne,
                    sw: fit.sw,
                    paddingLeft: 24,
                    paddingRight: 24,
                    paddingTop: 24,
                    paddingBottom: 24,
                  },
                }
              : undefined
          }
          animationDuration={0}
        />
        <ShapeSource id="detail-route" shape={line}>
          <LineLayer id="detail-route-line" style={ROUTE_LINE_STYLE} />
        </ShapeSource>
        <ShapeSource id="detail-pois" shape={pois}>
          <CircleLayer id="detail-pois-circle" style={POI_STYLE} />
        </ShapeSource>
        <ShapeSource id="detail-cursor" shape={cursorFc}>
          <CircleLayer id="detail-cursor-circle" style={CURSOR_STYLE} />
        </ShapeSource>
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", borderRadius: 12, overflow: "hidden" },
  fill: { flex: 1 },
});
