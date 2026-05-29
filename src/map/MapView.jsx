import React, { useCallback, useEffect, useRef, useState } from "react";
import MapSurface from "./MapSurface.jsx";
import OsmDebugOverlay from "./OsmDebugOverlay.jsx";

// Composition root for the map. Renders the end-user MapSurface and, once the
// map is ready, the web-only OsmDebugOverlay onto the same map instance.
// `osmDebugMode` is intentionally routed to BOTH children: MapSurface uses it
// to suppress the product route-network layer + guard clicks, while
// OsmDebugOverlay uses it to decide whether to activate its debug layers.
export default function MapView({ onMapReady, ...props }) {
  const [map, setMap] = useState(null);

  // Keep onMapReady current without making handleReady's identity change.
  // MapSurface's map-init effect depends on the onMapReady it receives; if that
  // identity changed on every render (e.g. after setMap below), the effect
  // would tear down and recreate the Mapbox map, dropping rendered layers.
  const onMapReadyRef = useRef(onMapReady);
  useEffect(() => {
    onMapReadyRef.current = onMapReady;
  }, [onMapReady]);

  const handleReady = useCallback((readyMap) => {
    setMap(readyMap);
    onMapReadyRef.current?.(readyMap);
  }, []);

  const {
    osmDebugGeoJson,
    osmGraphEdgesGeoJson,
    osmGraphNodesGeoJson,
    cwOsmMatchGeoJson,
    osmIntersectionsGeoJson,
    osmDebugMode,
    osmDebugLayerMode,
    onOsmDebugHover,
    onOsmGraphEdgeHover,
    onCwOsmMatchHover,
    selectedCwOsmReviewFeature,
    selectedCwOsmReviewSegmentId,
    ...surfaceProps
  } = props;

  return (
    <>
      <MapSurface
        {...surfaceProps}
        osmDebugMode={osmDebugMode}
        onMapReady={handleReady}
      />
      {map && (
        <OsmDebugOverlay
          map={map}
          osmDebugMode={osmDebugMode}
          osmDebugLayerMode={osmDebugLayerMode}
          osmDebugGeoJson={osmDebugGeoJson}
          osmGraphEdgesGeoJson={osmGraphEdgesGeoJson}
          osmGraphNodesGeoJson={osmGraphNodesGeoJson}
          cwOsmMatchGeoJson={cwOsmMatchGeoJson}
          osmIntersectionsGeoJson={osmIntersectionsGeoJson}
          selectedCwOsmReviewFeature={selectedCwOsmReviewFeature}
          selectedCwOsmReviewSegmentId={selectedCwOsmReviewSegmentId}
          onOsmDebugHover={onOsmDebugHover}
          onOsmGraphEdgeHover={onOsmGraphEdgeHover}
          onCwOsmMatchHover={onCwOsmMatchHover}
        />
      )}
    </>
  );
}
