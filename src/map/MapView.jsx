import React, { useCallback, useEffect, useRef } from "react";
import MapSurface from "./MapSurface.jsx";

// Composition root for the map. Keeps the map instance available for callers
// without exposing MapSurface's initialization lifecycle.
// segmentHighlight is passed through to MapSurface via the spread props.
export default function MapView({ onMapReady, ...props }) {
  // Keep onMapReady current without making handleReady's identity change.
  // MapSurface's map-init effect depends on the onMapReady it receives; if that
  // identity changed on every render (e.g. after setMap below), the effect
  // would tear down and recreate the Mapbox map, dropping rendered layers.
  const onMapReadyRef = useRef(onMapReady);
  useEffect(() => {
    onMapReadyRef.current = onMapReady;
  }, [onMapReady]);

  const handleReady = useCallback((readyMap) => {
    onMapReadyRef.current?.(readyMap);
  }, []);

  return (
    <MapSurface
      {...props}
      onMapReady={handleReady}
    />
  );
}
