import React, { useEffect, useRef, useState } from "react";
import {
  addOsmDebugLayers,
  addRouteNetworkLayers,
  clearOsmDebugLayers,
  clearOsmRawLayers,
  clearRouteDirectionLitPointLayer,
  clearRouteNetworkLayers,
  CW_OSM_MATCH_HIT_LAYER_ID,
  CW_OSM_MATCH_HOVER_LAYER_ID,
  DATA_MARKERS_LAYER_ID,
  loadDataMarkerIcons,
  OSM_DEBUG_HIT_LAYER_ID,
  OSM_GRAPH_EDGES_HOVER_LAYER_ID,
  OSM_GRAPH_EDGES_HIT_LAYER_ID,
  OSM_INTERSECTIONS_HIT_LAYER_ID,
  prepareRouteNetworkFeatures,
  ROUTE_NETWORK_HIT_LAYER_ID,
  ROUTE_POINTS_LAYER_ID,
  setCwOsmMatchFocus,
  setCwOsmMatchHover,
  setOsmDebugHover,
  setOsmGraphEdgeHover,
  setRouteNetworkFocus,
  setRouteNetworkHover,
  syncDataMarkerLayers,
  syncCwOsmMatchLayers,
  syncCwOsmReviewLayers,
  syncOsmGraphLayers,
  syncOsmIntersectionLayers,
  syncRouteDirectionLitPointLayer,
  syncRouteGeometryLayer,
  syncRoutePointLayers,
  syncVideoCursorLayer,
} from "./mapLayers.js";
import { requireMapboxToken } from "./mapboxToken.js";
import { distanceToLineSegmentPixels } from "../../utils/distance.js";

const MAP_CENTER = [35.617497, 33.183536];
const MAP_ZOOM = 11.5;

function MapView({
  activeDataPointIds = [],
  animator = null,
  dataMarkerFeatures = [],
  focusedMarker,
  focusedSegment,
  geoJsonData,
  elevationHover,
  hoveredSegment,
  onDataMarkerClick,
  onMapClick,
  onMapReady,
  onRouteClick = null,
  onRoutePointDrag,
  onRoutePointDragEnd,
  onRoutePointDragStart,
  onRoutePointRemove,
  onRoutePointSelect,
  onSegmentFocus,
  onSegmentHover,
  onViewportIdle,
  osmDebugGeoJson = null,
  osmGraphEdgesGeoJson = null,
  osmGraphNodesGeoJson = null,
  cwOsmMatchGeoJson = null,
  osmIntersectionsGeoJson = null,
  osmDebugMode = false,
  osmDebugLayerMode = "ways",
  onOsmDebugHover,
  onOsmGraphEdgeHover,
  onCwOsmMatchHover,
  routeFitRequest,
  routeGeometry = [],
  routePoints = [],
  searchHighlight,
  selectedCwOsmReviewFeature = null,
  selectedCwOsmReviewSegmentId = null,
  selectedRoutePointIndex = null,
  videoCursor = null,
}) {
  const containerRef = useRef(null);
  const draggingPointRef = useRef(null);
  const mapRef = useRef(null);
  const searchMarkerRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const hoverPreviewMarkerRef = useRef(null);
  const elevationMarkerRef = useRef(null);
  const lastRouteClickRef = useRef(null);
  const callbacksRef = useRef({});
  const dataMarkerFeaturesRef = useRef([]);
  const osmDebugActiveRef = useRef(false);
  const routePointsRef = useRef([]);
  const networkSegmentsRef = useRef([]);
  const [status, setStatus] = useState("initializing");
  const [error, setError] = useState(null);

  useEffect(() => {
    callbacksRef.current = {
      onDataMarkerClick,
      onMapClick,
      onRoutePointDrag,
      onRoutePointDragEnd,
      onRoutePointDragStart,
      onRoutePointRemove,
      onRoutePointSelect,
      onSegmentFocus,
      onSegmentHover,
      onViewportIdle,
      onOsmDebugHover,
      onOsmGraphEdgeHover,
      onCwOsmMatchHover,
    };
  }, [
    onDataMarkerClick,
    onMapClick,
    onRoutePointDrag,
    onRoutePointDragEnd,
    onRoutePointDragStart,
    onRoutePointRemove,
    onRoutePointSelect,
    onSegmentFocus,
    onSegmentHover,
    onViewportIdle,
    onOsmDebugHover,
    onOsmGraphEdgeHover,
    onCwOsmMatchHover,
  ]);

  useEffect(() => {
    routePointsRef.current = routePoints;
  }, [routePoints]);

  useEffect(() => {
    dataMarkerFeaturesRef.current = dataMarkerFeatures;
  }, [dataMarkerFeatures]);

  useEffect(() => {
    osmDebugActiveRef.current = Boolean(osmDebugMode);
  }, [osmDebugMode]);

  useEffect(() => {
    const mapboxgl = window.mapboxgl;
    if (!containerRef.current || !mapboxgl) {
      setStatus("error");
      setError(new Error("Mapbox GL is not loaded"));
      return undefined;
    }

    let isDisposed = false;

    try {
      mapboxgl.accessToken = requireMapboxToken();
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/outdoors-v12",
        center: MAP_CENTER,
        zoom: MAP_ZOOM,
      });
      mapRef.current = map;

      map.on("load", () => {
        if (isDisposed) return;
        try {
          applyHebrewLabels(map);
          setStatus("ready");
          onMapReady?.(map);
        } catch (loadError) {
          setStatus("error");
          setError(loadError);
        }
      });

      map.on("error", (event) => {
        if (isDisposed) return;
        const mapError = event?.error || new Error("Mapbox map error");
        setStatus("error");
        setError(mapError);
      });
    } catch (initError) {
      setStatus("error");
      setError(initError);
    }

    return () => {
      isDisposed = true;
      if (mapRef.current) {
        clearSearchHighlight(mapRef.current, searchMarkerRef);
        clearHoverPreviewMarker(hoverPreviewMarkerRef);
        clearElevationMarker(elevationMarkerRef);
        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
        }
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [onMapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !geoJsonData) return undefined;

    if (osmDebugMode) {
      clearRouteNetworkLayers(map);
      networkSegmentsRef.current = [];
      callbacksRef.current.onSegmentHover?.(null);
      return undefined;
    }

    const features = prepareRouteNetworkFeatures(geoJsonData);
    networkSegmentsRef.current = buildNetworkSegments(features);
    addRouteNetworkLayers(map, features);

    const handleMouseMove = (event) => {
      const closest = findClosestRouteSegment(
        map,
        event,
        networkSegmentsRef.current,
      );
      const segmentName = closest?.segmentName || null;
      map.getCanvas().style.cursor = segmentName ? "pointer" : "";
      callbacksRef.current.onSegmentHover?.(segmentName);

      if (
        closest?.point &&
        !isPointTooCloseToRouteUi(
          map,
          closest.point,
          routePointsRef.current,
          dataMarkerFeaturesRef.current,
        )
      ) {
        syncHoverPreviewMarker(map, hoverPreviewMarkerRef, closest.point);
      } else {
        clearHoverPreviewMarker(hoverPreviewMarkerRef);
      }
    };

    const handleMouseLeave = (event) => {
      if (event?.target !== map.getCanvas()) return;
      map.getCanvas().style.cursor = "";
      callbacksRef.current.onSegmentHover?.(null);
      clearHoverPreviewMarker(hoverPreviewMarkerRef);
    };

    const handleClick = (event) => {
      if (osmDebugActiveRef.current) return;

      const feature = event.features?.[0];
      const segmentName = feature?.properties?.name || null;
      if (!segmentName) return;

      event.preventDefault?.();
      lastRouteClickRef.current = createClickStamp(event);
      const closest = findClosestRouteSegment(
        map,
        event,
        networkSegmentsRef.current,
      );
      clearHoverPreviewMarker(hoverPreviewMarkerRef);
      callbacksRef.current.onMapClick?.({
        lng: closest?.point?.lng ?? event.lngLat.lng,
        lat: closest?.point?.lat ?? event.lngLat.lat,
      });
    };

    map.on("mousemove", handleMouseMove);
    map.on("mouseout", handleMouseLeave);
    map.on("click", ROUTE_NETWORK_HIT_LAYER_ID, handleClick);

    return () => {
      map.off("mousemove", handleMouseMove);
      map.off("mouseout", handleMouseLeave);
      map.off("click", ROUTE_NETWORK_HIT_LAYER_ID, handleClick);
      clearHoverPreviewMarker(hoverPreviewMarkerRef);
      networkSegmentsRef.current = [];
      clearRouteNetworkLayers(map);
    };
  }, [geoJsonData, osmDebugMode, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return undefined;

    if (!osmDebugMode) {
      clearOsmDebugLayers(map);
      callbacksRef.current.onOsmDebugHover?.(null);
      return undefined;
    }

    if (osmDebugLayerMode !== "ways") {
      clearOsmRawLayers(map);
      callbacksRef.current.onOsmDebugHover?.(null);
      return undefined;
    }

    const features = (osmDebugGeoJson?.features || []).filter(
      (feature) => feature?.geometry?.type === "LineString",
    );
    if (features.length === 0) {
      clearOsmDebugLayers(map);
      callbacksRef.current.onOsmDebugHover?.(null);
      return undefined;
    }

    addOsmDebugLayers(map, features);

    let popup = null;
    const handleOsmClick = (event) => {
      if (findOsmIntersectionFeatureAtClick(map, event)) return;
      if (findOsmGraphEdgeFeatureAtClick(map, event)) return;

      const feature = findOsmDebugFeatureAtClick(map, event);
      if (!feature) return;

      event.preventDefault?.();
      event.originalEvent?.stopPropagation?.();
      popup?.remove();
      popup = new window.mapboxgl.Popup({ maxWidth: "360px" })
        .setLngLat(event.lngLat)
        .setHTML(osmPopupHtml(feature.properties || {}))
        .addTo(map);
    };
    const handleOsmMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const handleOsmMouseMove = (event) => {
      const feature = event.features?.[0];
      const osmId = feature?.properties?.osmId;
      setOsmDebugHover(map, osmId);
      callbacksRef.current.onOsmDebugHover?.(
        feature ? normalizeOsmDebugProperties(feature.properties || {}) : null,
      );
    };
    const handleOsmMouseLeave = () => {
      map.getCanvas().style.cursor = "";
      setOsmDebugHover(map, null);
      callbacksRef.current.onOsmDebugHover?.(null);
    };

    map.on("click", handleOsmClick);
    map.on("mouseenter", OSM_DEBUG_HIT_LAYER_ID, handleOsmMouseEnter);
    map.on("mousemove", OSM_DEBUG_HIT_LAYER_ID, handleOsmMouseMove);
    map.on("mouseleave", OSM_DEBUG_HIT_LAYER_ID, handleOsmMouseLeave);

    return () => {
      popup?.remove();
      map.off("click", handleOsmClick);
      map.off("mouseenter", OSM_DEBUG_HIT_LAYER_ID, handleOsmMouseEnter);
      map.off("mousemove", OSM_DEBUG_HIT_LAYER_ID, handleOsmMouseMove);
      map.off("mouseleave", OSM_DEBUG_HIT_LAYER_ID, handleOsmMouseLeave);
      callbacksRef.current.onOsmDebugHover?.(null);
      clearOsmRawLayers(map);
    };
  }, [osmDebugGeoJson, osmDebugLayerMode, osmDebugMode, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return undefined;

    const edgeFeatures =
      osmDebugMode &&
      osmDebugLayerMode === "graph" &&
      Array.isArray(osmGraphEdgesGeoJson?.features)
        ? osmGraphEdgesGeoJson.features
        : [];
    const nodeFeatures =
      osmDebugMode &&
      osmDebugLayerMode === "graph" &&
      Array.isArray(osmGraphNodesGeoJson?.features)
        ? osmGraphNodesGeoJson.features
        : [];
    syncOsmGraphLayers(map, edgeFeatures, nodeFeatures);
    if (edgeFeatures.length === 0 || !map.getLayer(OSM_GRAPH_EDGES_HIT_LAYER_ID)) {
      callbacksRef.current.onOsmGraphEdgeHover?.(null);
      return undefined;
    }

    let popup = null;
    const handleGraphEdgeClick = (event) => {
      if (findOsmIntersectionFeatureAtClick(map, event)) return;

      const feature = event.features?.[0];
      if (!feature) return;

      event.preventDefault?.();
      event.originalEvent?.stopPropagation?.();
      popup?.remove();
      popup = new window.mapboxgl.Popup({ maxWidth: "380px" })
        .setLngLat(event.lngLat)
        .setHTML(osmGraphEdgePopupHtml(feature.properties || {}))
        .addTo(map);
    };
    const handleGraphMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const handleGraphMouseMove = (event) => {
      const feature = event.features?.[0];
      const edgeId = feature?.properties?.edgeId;
      setOsmGraphEdgeHover(map, edgeId);
      callbacksRef.current.onOsmGraphEdgeHover?.(
        feature ? normalizeOsmGraphEdgeProperties(feature.properties || {}) : null,
      );
    };
    const handleGraphMouseLeave = () => {
      map.getCanvas().style.cursor = "";
      setOsmGraphEdgeHover(map, null);
      callbacksRef.current.onOsmGraphEdgeHover?.(null);
    };

    map.on("click", OSM_GRAPH_EDGES_HIT_LAYER_ID, handleGraphEdgeClick);
    map.on("mouseenter", OSM_GRAPH_EDGES_HIT_LAYER_ID, handleGraphMouseEnter);
    map.on("mousemove", OSM_GRAPH_EDGES_HIT_LAYER_ID, handleGraphMouseMove);
    map.on("mouseleave", OSM_GRAPH_EDGES_HIT_LAYER_ID, handleGraphMouseLeave);

    return () => {
      popup?.remove();
      if (map.getLayer(OSM_GRAPH_EDGES_HIT_LAYER_ID)) {
        map.off("click", OSM_GRAPH_EDGES_HIT_LAYER_ID, handleGraphEdgeClick);
        map.off("mouseenter", OSM_GRAPH_EDGES_HIT_LAYER_ID, handleGraphMouseEnter);
        map.off("mousemove", OSM_GRAPH_EDGES_HIT_LAYER_ID, handleGraphMouseMove);
        map.off("mouseleave", OSM_GRAPH_EDGES_HIT_LAYER_ID, handleGraphMouseLeave);
      }
      callbacksRef.current.onOsmGraphEdgeHover?.(null);
      if (map.getLayer(OSM_GRAPH_EDGES_HOVER_LAYER_ID)) {
        setOsmGraphEdgeHover(map, null);
      }
    };
  }, [
    osmDebugLayerMode,
    osmDebugMode,
    osmGraphEdgesGeoJson,
    osmGraphNodesGeoJson,
    status,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return undefined;

    const features =
      osmDebugMode &&
      osmDebugLayerMode === "graph" &&
      Array.isArray(cwOsmMatchGeoJson?.features)
        ? cwOsmMatchGeoJson.features
        : [];
    syncCwOsmMatchLayers(map, features);
    if (features.length === 0 || !map.getLayer(CW_OSM_MATCH_HIT_LAYER_ID)) {
      callbacksRef.current.onCwOsmMatchHover?.(null);
      return undefined;
    }

    let popup = null;
    const handleMatchClick = (event) => {
      const feature = event.features?.[0];
      if (!feature) return;

      event.preventDefault?.();
      event.originalEvent?.stopPropagation?.();
      popup?.remove();
      popup = new window.mapboxgl.Popup({ maxWidth: "380px" })
        .setLngLat(event.lngLat)
        .setHTML(cwOsmMatchPopupHtml(feature.properties || {}))
        .addTo(map);
    };
    const handleMatchMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const handleMatchMouseMove = (event) => {
      const feature = event.features?.[0];
      const segmentId = feature?.properties?.segmentId;
      setCwOsmMatchHover(map, segmentId);
      callbacksRef.current.onOsmGraphEdgeHover?.(null);
      callbacksRef.current.onCwOsmMatchHover?.(
        feature ? normalizeCwOsmMatchProperties(feature.properties || {}) : null,
      );
    };
    const handleMatchMouseLeave = () => {
      map.getCanvas().style.cursor = "";
      setCwOsmMatchHover(map, null);
      callbacksRef.current.onCwOsmMatchHover?.(null);
    };

    map.on("click", CW_OSM_MATCH_HIT_LAYER_ID, handleMatchClick);
    map.on("mouseenter", CW_OSM_MATCH_HIT_LAYER_ID, handleMatchMouseEnter);
    map.on("mousemove", CW_OSM_MATCH_HIT_LAYER_ID, handleMatchMouseMove);
    map.on("mouseleave", CW_OSM_MATCH_HIT_LAYER_ID, handleMatchMouseLeave);

    return () => {
      popup?.remove();
      if (map.getLayer(CW_OSM_MATCH_HIT_LAYER_ID)) {
        map.off("click", CW_OSM_MATCH_HIT_LAYER_ID, handleMatchClick);
        map.off("mouseenter", CW_OSM_MATCH_HIT_LAYER_ID, handleMatchMouseEnter);
        map.off("mousemove", CW_OSM_MATCH_HIT_LAYER_ID, handleMatchMouseMove);
        map.off("mouseleave", CW_OSM_MATCH_HIT_LAYER_ID, handleMatchMouseLeave);
      }
      callbacksRef.current.onCwOsmMatchHover?.(null);
      if (map.getLayer(CW_OSM_MATCH_HOVER_LAYER_ID)) {
        setCwOsmMatchHover(map, null);
      }
    };
  }, [cwOsmMatchGeoJson, osmDebugLayerMode, osmDebugMode, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;

    const shouldShowReview =
      osmDebugMode &&
      osmDebugLayerMode === "graph" &&
      selectedCwOsmReviewFeature?.geometry?.type === "LineString";

    syncCwOsmReviewLayers(map, shouldShowReview ? selectedCwOsmReviewFeature : null);
    setCwOsmMatchFocus(
      map,
      shouldShowReview ? selectedCwOsmReviewSegmentId : null,
    );

    if (!shouldShowReview) return;

    const coordinates = selectedCwOsmReviewFeature.geometry.coordinates
      .filter((coord) => coord.length >= 2)
      .map((coord) => ({ lng: Number(coord[0]), lat: Number(coord[1]) }))
      .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat));
    if (coordinates.length >= 2) {
      fitMapToCoordinates(map, coordinates, {
        maxZoom: 15,
        padding: 92,
      });
    }
  }, [
    osmDebugLayerMode,
    osmDebugMode,
    selectedCwOsmReviewFeature,
    selectedCwOsmReviewSegmentId,
    status,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return undefined;

    const features =
      osmDebugMode &&
      osmDebugLayerMode === "ways" &&
      Array.isArray(osmIntersectionsGeoJson?.features)
        ? osmIntersectionsGeoJson.features
        : [];
    syncOsmIntersectionLayers(map, features);
    if (features.length === 0 || !map.getLayer(OSM_INTERSECTIONS_HIT_LAYER_ID)) {
      return undefined;
    }

    let popup = null;
    const handleIntersectionClick = (event) => {
      const feature = event.features?.[0];
      if (!feature) return;

      event.preventDefault?.();
      event.originalEvent?.stopPropagation?.();
      popup?.remove();
      popup = new window.mapboxgl.Popup({ maxWidth: "340px" })
        .setLngLat(event.lngLat)
        .setHTML(osmIntersectionPopupHtml(feature.properties || {}))
        .addTo(map);
    };

    map.on("click", OSM_INTERSECTIONS_HIT_LAYER_ID, handleIntersectionClick);

    return () => {
      popup?.remove();
      if (map.getLayer(OSM_INTERSECTIONS_HIT_LAYER_ID)) {
        map.off("click", OSM_INTERSECTIONS_HIT_LAYER_ID, handleIntersectionClick);
      }
    };
  }, [osmDebugLayerMode, osmDebugMode, osmIntersectionsGeoJson, status]);

  useEffect(() => {
    if (status !== "ready") return;
    setRouteNetworkHover(mapRef.current, hoveredSegment);
  }, [hoveredSegment, status]);

  useEffect(() => {
    if (status !== "ready") return;
    setRouteNetworkFocus(mapRef.current, focusedSegment);
  }, [focusedSegment, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    syncRouteGeometryLayer(map, routeGeometry);
  }, [routeGeometry, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !animator) return undefined;

    const mapboxgl = window.mapboxgl;
    if (!mapboxgl) return undefined;

    const host = document.createElement("div");
    host.className = "route-direction-chevron";
    host.style.cssText = `
      width: 32px;
      height: 14px;
      pointer-events: none;
      display: none;
    `;
    const rotor = document.createElement("div");
    rotor.style.cssText = `
      width: 100%;
      height: 100%;
      transform-origin: 50% 50%;
      mix-blend-mode: screen;
    `;
    rotor.innerHTML = `
      <svg viewBox="-16 -7 32 14" width="32" height="14" xmlns="http://www.w3.org/2000/svg">
        <polygon points="-12,-3 -3,0 -12,3" fill="#ffffff" fill-opacity="0.25"/>
        <polygon points="-3,-4 6,0 -3,4" fill="#ffffff" fill-opacity="0.55"/>
        <polygon points="6,-5 15,0 6,5" fill="#ffffff" fill-opacity="0.95"/>
      </svg>
    `;
    host.appendChild(rotor);

    const marker = new mapboxgl.Marker({ element: host, anchor: "center" })
      .setLngLat([0, 0])
      .addTo(map);

    const unsubscribe = animator.subscribe("chevron", (payload) => {
      if (!payload) {
        host.style.display = "none";
        return;
      }
      marker.setLngLat([payload.lng, payload.lat]);
      host.style.display = "block";
      // Mapbox bearing is 0=N, 90=E (clockwise from north). The SVG points
      // east at 0deg CSS rotation, so subtract 90 to map bearing → CSS rotate.
      rotor.style.transform = `rotate(${payload.bearing - 90}deg)`;
    });

    return () => {
      unsubscribe();
      marker.remove();
    };
  }, [animator, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !animator) return undefined;

    const unsubscribe = animator.subscribe("litPoint", (payload) => {
      if (!map.getSource) return;
      const adapted = payload
        ? { ...payload, displayIndex: payload.index + 1 }
        : null;
      syncRouteDirectionLitPointLayer(map, adapted);
    });

    return () => {
      unsubscribe();
      clearRouteDirectionLitPointLayer(map);
    };
  }, [animator, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    syncVideoCursorLayer(map, videoCursor);
  }, [videoCursor, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !videoCursor) return;
    const bounds = map.getBounds();
    const w = bounds.getEast() - bounds.getWest();
    const h = bounds.getNorth() - bounds.getSouth();
    const margin = 0.15;
    const inset = {
      west: bounds.getWest() + w * margin,
      east: bounds.getEast() - w * margin,
      south: bounds.getSouth() + h * margin,
      north: bounds.getNorth() - h * margin,
    };
    if (
      videoCursor.lng < inset.west ||
      videoCursor.lng > inset.east ||
      videoCursor.lat < inset.south ||
      videoCursor.lat > inset.north
    ) {
      map.easeTo({
        center: [videoCursor.lng, videoCursor.lat],
        duration: 600,
      });
    }
  }, [videoCursor, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !onRouteClick) return undefined;
    const handler = (e) => {
      if (map.getLayer?.(DATA_MARKERS_LAYER_ID)) {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: [DATA_MARKERS_LAYER_ID],
        });
        if (hits && hits.length > 0) return;
      }
      onRouteClick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    };
    map.on("click", handler);
    return () => map.off("click", handler);
  }, [status, onRouteClick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    syncRoutePointLayers(map, routePoints, selectedRoutePointIndex);
  }, [routePoints, selectedRoutePointIndex, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    let disposed = false;
    async function syncMarkers() {
      await loadDataMarkerIcons(map);
      if (!disposed) {
        syncDataMarkerLayers(map, dataMarkerFeatures, activeDataPointIds);
      }
    }
    syncMarkers();
    return () => {
      disposed = true;
    };
  }, [activeDataPointIds, dataMarkerFeatures, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return undefined;

    let timeoutId = null;
    const emitViewportIdle = () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(() => {
        const bounds = map.getBounds();
        callbacksRef.current.onViewportIdle?.({
          west: bounds.getWest(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          north: bounds.getNorth(),
        });
      }, 350);
    };

    emitViewportIdle();
    map.on("moveend", emitViewportIdle);

    return () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      map.off("moveend", emitViewportIdle);
    };
  }, [status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return undefined;

    const hasBlockingClickFeature = (event) => {
      const layers = [
        ROUTE_POINTS_LAYER_ID,
        DATA_MARKERS_LAYER_ID,
        OSM_DEBUG_HIT_LAYER_ID,
      ].filter((layerId) => map.getLayer(layerId));
      if (layers.length === 0) return false;
      return map.queryRenderedFeatures(event.point, { layers }).length > 0;
    };

    const handleMapClick = (event) => {
      if (draggingPointRef.current !== null) return;
      if (osmDebugActiveRef.current) return;
      if (hasBlockingClickFeature(event)) return;
      if (isDuplicateRouteClick(lastRouteClickRef.current, event)) return;

      const closest = findClosestRouteSegment(
        map,
        event,
        networkSegmentsRef.current,
      );
      clearHoverPreviewMarker(hoverPreviewMarkerRef);
      callbacksRef.current.onMapClick?.({
        lng: closest?.point?.lng ?? event.lngLat.lng,
        lat: closest?.point?.lat ?? event.lngLat.lat,
      });
    };

    const handleDataMarkerClick = (event) => {
      const feature = event.features?.[0];
      if (!feature) return;

      event.preventDefault?.();
      event.originalEvent?.stopPropagation?.();
      callbacksRef.current.onDataMarkerClick?.({
        id: feature.properties?.dataPointId,
        type: feature.properties?.type,
        information: feature.properties?.information,
        segmentName: feature.properties?.segmentName,
        emoji: feature.properties?.emoji,
        lng: event.lngLat.lng,
        lat: event.lngLat.lat,
      });
    };

    const handleRoutePointClick = (event) => {
      const feature = event.features?.[0];
      if (feature?.properties?.pending) return;
      const index = Number(feature?.properties?.index);
      if (!Number.isInteger(index)) return;

      event.preventDefault?.();
      event.originalEvent?.stopPropagation?.();
      callbacksRef.current.onRoutePointSelect?.(index);
    };

    map.on("click", handleMapClick);
    map.on("click", DATA_MARKERS_LAYER_ID, handleDataMarkerClick);
    map.on("click", ROUTE_POINTS_LAYER_ID, handleRoutePointClick);

    return () => {
      map.off("click", handleMapClick);
      map.off("click", DATA_MARKERS_LAYER_ID, handleDataMarkerClick);
      map.off("click", ROUTE_POINTS_LAYER_ID, handleRoutePointClick);
    };
  }, [status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;

    if (elevationHover?.coord) {
      syncElevationMarker(map, elevationMarkerRef, elevationHover.coord);
    } else {
      clearElevationMarker(elevationMarkerRef);
    }
  }, [elevationHover, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return undefined;

    const getPointIndex = (event) => {
      const feature = event.features?.[0];
      if (feature?.properties?.pending) return null;
      const index = Number(feature?.properties?.index);
      return Number.isInteger(index) ? index : null;
    };

    const startDrag = (event) => {
      const pointIndex = getPointIndex(event);
      if (!Number.isInteger(pointIndex)) return;

      event.preventDefault?.();
      draggingPointRef.current = pointIndex;
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grabbing";
      callbacksRef.current.onRoutePointDragStart?.(draggingPointRef.current);
    };

    const removePoint = (event) => {
      const pointIndex = getPointIndex(event);
      if (!Number.isInteger(pointIndex)) return;

      event.preventDefault?.();
      event.originalEvent?.stopPropagation?.();
      callbacksRef.current.onRoutePointRemove?.(pointIndex);
    };

    const moveDrag = (event) => {
      const pointIndex = draggingPointRef.current;
      if (!Number.isInteger(pointIndex)) return;

      callbacksRef.current.onRoutePointDrag?.(pointIndex, {
        lng: event.lngLat.lng,
        lat: event.lngLat.lat,
      });
    };

    const endDrag = () => {
      const pointIndex = draggingPointRef.current;
      if (!Number.isInteger(pointIndex)) return;

      draggingPointRef.current = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
      callbacksRef.current.onRoutePointDragEnd?.(pointIndex);
    };

    const enterPoint = () => {
      map.getCanvas().style.cursor = "grab";
    };

    const leavePoint = () => {
      if (!Number.isInteger(draggingPointRef.current)) {
        map.getCanvas().style.cursor = "";
      }
    };

    map.on("mousedown", ROUTE_POINTS_LAYER_ID, startDrag);
    map.on("touchstart", ROUTE_POINTS_LAYER_ID, startDrag);
    map.on("contextmenu", ROUTE_POINTS_LAYER_ID, removePoint);
    map.on("mousemove", moveDrag);
    map.on("touchmove", moveDrag);
    map.on("mouseup", endDrag);
    map.on("touchend", endDrag);
    map.on("mouseenter", ROUTE_POINTS_LAYER_ID, enterPoint);
    map.on("mouseleave", ROUTE_POINTS_LAYER_ID, leavePoint);

    return () => {
      map.off("mousedown", ROUTE_POINTS_LAYER_ID, startDrag);
      map.off("touchstart", ROUTE_POINTS_LAYER_ID, startDrag);
      map.off("contextmenu", ROUTE_POINTS_LAYER_ID, removePoint);
      map.off("mousemove", moveDrag);
      map.off("touchmove", moveDrag);
      map.off("mouseup", endDrag);
      map.off("touchend", endDrag);
      map.off("mouseenter", ROUTE_POINTS_LAYER_ID, enterPoint);
      map.off("mouseleave", ROUTE_POINTS_LAYER_ID, leavePoint);
    };
  }, [status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !routeFitRequest?.geometry?.length) {
      return;
    }

    fitMapToCoordinates(map, routeFitRequest.geometry, {
      maxZoom: 14,
      padding: 72,
    });
  }, [routeFitRequest, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !focusedMarker?.coord) return;
    const { lng, lat } = focusedMarker.coord;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    const currentZoom = typeof map.getZoom === "function" ? map.getZoom() : 14;
    map.flyTo({
      center: [lng, lat],
      zoom: Math.max(currentZoom, 14),
      speed: 1.2,
    });
  }, [focusedMarker, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !searchHighlight) return undefined;

    clearSearchHighlight(map, searchMarkerRef);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const mapboxgl = window.mapboxgl;
    const markerElement = document.createElement("div");
    markerElement.className = "react-search-marker";
    markerElement.title = searchHighlight.label || "";
    searchMarkerRef.current = new mapboxgl.Marker(markerElement)
      .setLngLat([searchHighlight.lng, searchHighlight.lat])
      .addTo(map);

    syncSearchHighlightCircle(map, searchHighlight);
    map.flyTo({
      center: [searchHighlight.lng, searchHighlight.lat],
      zoom: 11.5,
      duration: 1000,
    });

    searchTimeoutRef.current = setTimeout(() => {
      clearSearchHighlight(map, searchMarkerRef);
    }, 4000);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
    };
  }, [searchHighlight, status]);

  return (
    <>
      <div
        className="react-map"
        id="map"
        ref={containerRef}
        aria-label="מפת CycleWays"
      />
      {status === "initializing" && (
        <div className="react-map__overlay">טוען מפה</div>
      )}
      {status === "error" && (
        <div className="react-map__overlay react-map__overlay--error">
          {error?.message || "טעינת המפה נכשלה"}
        </div>
      )}
    </>
  );
}

function fitMapToCoordinates(map, coordinates, options = {}) {
  const mapboxgl = window.mapboxgl;
  const bounds = new mapboxgl.LngLatBounds();

  coordinates.forEach((point) => {
    const lng = Number(point.lng);
    const lat = Number(point.lat);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      bounds.extend([lng, lat]);
    }
  });

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, {
      duration: 0,
      maxZoom: options.maxZoom || 14,
      padding: options.padding || 48,
    });
  }
}

function syncSearchHighlightCircle(map, searchHighlight) {
  const sourceId = "react-search-highlight";
  const layerId = "react-search-highlight-circle";
  const data = {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [searchHighlight.lng, searchHighlight.lat],
    },
    properties: {},
  };

  if (map.getSource(sourceId)) {
    map.getSource(sourceId).setData(data);
  } else {
    map.addSource(sourceId, {
      type: "geojson",
      data,
    });
  }

  if (!map.getLayer(layerId)) {
    map.addLayer({
      id: layerId,
      type: "circle",
      source: sourceId,
      paint: {
        "circle-radius": {
          base: 1.75,
          stops: [
            [12, 30],
            [22, 180],
          ],
        },
        "circle-color": "#ff4444",
        "circle-opacity": 0.2,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ff4444",
        "circle-stroke-opacity": 0.8,
      },
    });
  }
}

function clearSearchHighlight(map, markerRef) {
  markerRef.current?.remove();
  markerRef.current = null;

  if (map?.getLayer("react-search-highlight-circle")) {
    map.removeLayer("react-search-highlight-circle");
  }
  if (map?.getSource("react-search-highlight")) {
    map.removeSource("react-search-highlight");
  }
}

function syncHoverPreviewMarker(map, markerRef, lngLat) {
  const mapboxgl = window.mapboxgl;
  if (!mapboxgl || !lngLat) return;

  const coordinates = [lngLat.lng, lngLat.lat];
  if (markerRef.current) {
    markerRef.current.setLngLat(coordinates);
    return;
  }

  const markerElement = document.createElement("div");
  markerElement.className = "hover-preview-marker";
  markerElement.style.cssText = `
    width: 10px;
    height: 10px;
    background: #ff4444;
    border: 2px solid white;
    border-radius: 50%;
    box-shadow: 0 2px 6px rgba(255, 68, 68, 0.4);
    pointer-events: none;
  `;

  markerRef.current = new mapboxgl.Marker(markerElement)
    .setLngLat(coordinates)
    .addTo(map);
}

function clearHoverPreviewMarker(markerRef) {
  markerRef.current?.remove();
  markerRef.current = null;
}

function osmPopupHtml(properties) {
  const keys = [
    "osmId",
    "highway",
    "name",
    "ref",
    "surface",
    "tracktype",
    "bicycle",
    "access",
    "vehicle",
    "service",
    "bridge",
    "tunnel",
    "layer",
    "osmRouteClass",
    "accessStatus",
    "distanceMeters",
  ];
  const rows = keys
    .filter((key) => properties[key] !== undefined && properties[key] !== "")
    .map(
      (key) =>
        `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(properties[key])}</td></tr>`,
    )
    .join("");

  return `
    <div class="osm-debug-popup">
      <strong>OSM way</strong>
      <table>${rows}</table>
    </div>
  `;
}

function osmIntersectionPopupHtml(properties) {
  const wayIds = parseJsonProperty(properties.wayIds, []);
  const kinds = parseJsonProperty(properties.kinds, {});
  const rows = [
    ["id", properties.intersectionId],
    ["kind", properties.kind],
    ["ways", wayIds.join(", ")],
    ["wayCount", properties.wayCount],
    ["pairCount", properties.pairCount],
    ["kinds", Object.entries(kinds).map(([key, value]) => `${key}: ${value}`).join(", ")],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");

  return `
    <div class="osm-debug-popup">
      <strong>OSM intersection</strong>
      <table>${rows
        .map(
          ([key, value]) =>
            `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`,
        )
        .join("")}</table>
    </div>
  `;
}

function osmGraphEdgePopupHtml(properties) {
  const rows = [
    ["edge", properties.edgeId],
    ["osmWay", properties.osmWayId],
    ["slice", properties.sliceIndex],
    ["from", properties.fromNodeId],
    ["to", properties.toNodeId],
    ["distance", `${properties.distanceMeters || 0} m`],
    ["highway", properties.highway],
    ["surface", properties.surface],
    ["tracktype", properties.tracktype],
    ["class", properties.osmRouteClass],
    ["status", properties.accessStatus],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");

  return `
    <div class="osm-debug-popup">
      <strong>OSM graph edge</strong>
      <table>${rows
        .map(
          ([key, value]) =>
            `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`,
        )
        .join("")}</table>
    </div>
  `;
}

function cwOsmMatchPopupHtml(properties) {
  const isGap = properties.kind === "gap";
  const rows = [
    ["segment", properties.segmentName],
    ["segmentId", properties.segmentId],
    ["kind", properties.kind],
    ["confidence", properties.confidence],
    ["coverage", formatPercent(properties.coverageRatio)],
    ["edge", properties.edgeId],
    ["osmWay", properties.osmWayId],
    ["direction", properties.direction],
    ["avgDistance", formatMeters(properties.avgDistanceMeters)],
    ["gapDistance", isGap ? formatMeters(properties.distanceMeters) : null],
    ["highway", properties.graphHighway],
    ["class", properties.graphClass],
    ["status", properties.graphAccessStatus],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");

  return `
    <div class="osm-debug-popup">
      <strong>${isGap ? "CW match gap" : "CW matched edge"}</strong>
      <table>${rows
        .map(
          ([key, value]) =>
            `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`,
        )
        .join("")}</table>
    </div>
  `;
}

function normalizeOsmDebugProperties(properties) {
  const normalized = {};
  [
    "osmId",
    "highway",
    "name",
    "ref",
    "surface",
    "tracktype",
    "bicycle",
    "access",
    "vehicle",
    "service",
    "bridge",
    "tunnel",
    "layer",
    "osmRouteClass",
    "accessStatus",
    "distanceMeters",
  ].forEach((key) => {
    if (properties[key] !== undefined && properties[key] !== "") {
      normalized[key] = properties[key];
    }
  });
  return normalized;
}

function normalizeOsmGraphEdgeProperties(properties) {
  const normalized = { debugType: "graphEdge" };
  [
    "edgeId",
    "osmWayId",
    "sliceIndex",
    "fromNodeId",
    "toNodeId",
    "highway",
    "surface",
    "tracktype",
    "bicycle",
    "access",
    "osmRouteClass",
    "accessStatus",
    "distanceMeters",
  ].forEach((key) => {
    if (properties[key] !== undefined && properties[key] !== "") {
      normalized[key] = properties[key];
    }
  });
  return normalized;
}

function normalizeCwOsmMatchProperties(properties) {
  const normalized = { debugType: properties.kind === "gap" ? "cwMatchGap" : "cwMatchEdge" };
  [
    "kind",
    "segmentId",
    "segmentName",
    "roadType",
    "confidence",
    "coverageRatio",
    "edgeId",
    "osmWayId",
    "direction",
    "sequenceIndex",
    "sampleCount",
    "avgDistanceMeters",
    "distanceMeters",
    "graphHighway",
    "graphClass",
    "graphAccessStatus",
  ].forEach((key) => {
    if (properties[key] !== undefined && properties[key] !== "") {
      normalized[key] = properties[key];
    }
  });
  return normalized;
}

function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number * 100)}%` : "";
}

function formatMeters(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)} m` : "";
}

function parseJsonProperty(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function findOsmDebugFeatureAtClick(map, event) {
  if (!map.getLayer(OSM_DEBUG_HIT_LAYER_ID)) return null;

  const radius = 8;
  const point = event.point;
  const features = map.queryRenderedFeatures(
    [
      [point.x - radius, point.y - radius],
      [point.x + radius, point.y + radius],
    ],
    { layers: [OSM_DEBUG_HIT_LAYER_ID] },
  );
  return features[0] || null;
}

function findOsmGraphEdgeFeatureAtClick(map, event) {
  if (!map.getLayer(OSM_GRAPH_EDGES_HIT_LAYER_ID)) return null;

  const radius = 6;
  const point = event.point;
  const features = map.queryRenderedFeatures(
    [
      [point.x - radius, point.y - radius],
      [point.x + radius, point.y + radius],
    ],
    { layers: [OSM_GRAPH_EDGES_HIT_LAYER_ID] },
  );
  return features[0] || null;
}

function findOsmIntersectionFeatureAtClick(map, event) {
  if (!map.getLayer(OSM_INTERSECTIONS_HIT_LAYER_ID)) return null;

  const features = map.queryRenderedFeatures(event.point, {
    layers: [OSM_INTERSECTIONS_HIT_LAYER_ID],
  });
  return features[0] || null;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function syncElevationMarker(map, markerRef, coord) {
  const mapboxgl = window.mapboxgl;
  if (!mapboxgl || !coord) return;

  const coordinates = [coord.lng, coord.lat];
  if (markerRef.current) {
    markerRef.current.setLngLat(coordinates);
    return;
  }

  const markerElement = document.createElement("div");
  markerElement.className = "elevation-marker";
  markerElement.style.cssText = `
    width: 16px;
    height: 16px;
    background: #ff4444;
    border: 3px solid white;
    border-radius: 50%;
    box-shadow: 0 2px 8px rgba(255, 0, 0, 0.6);
    cursor: pointer;
  `;

  markerRef.current = new mapboxgl.Marker(markerElement)
    .setLngLat(coordinates)
    .addTo(map);
}

function clearElevationMarker(markerRef) {
  markerRef.current?.remove();
  markerRef.current = null;
}

function buildNetworkSegments(features) {
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

function findClosestRouteSegment(map, event, networkSegments, thresholdPixels = 15) {
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

function getClosestPointOnLineSegment(point, lineStart, lineEnd) {
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

function isPointTooCloseToRouteUi(map, point, routePoints, dataMarkerFeatures) {
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

function pixelDistance(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function createClickStamp(event) {
  return {
    x: Number(event?.point?.x),
    y: Number(event?.point?.y),
    lng: Number(event?.lngLat?.lng),
    lat: Number(event?.lngLat?.lat),
    time: Date.now(),
  };
}

function isDuplicateRouteClick(previousClick, event) {
  if (!previousClick) return false;
  if (Date.now() - previousClick.time > 250) return false;

  const nextClick = createClickStamp(event);
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

function applyHebrewLabels(map) {
  const layers = ["country-label", "state-label", "settlement-label"];
  layers.forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "text-field", [
        "coalesce",
        ["get", "name_he"],
        ["get", "name"],
      ]);
    }
  });
}

export default MapView;
