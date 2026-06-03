// MapSurface: the platform-agnostic end-user map. It renders the map container
// and drives the product layers (route network, geometry, points + drag,
// direction pulse, data markers, search highlight) purely through props in and
// geographic callbacks out — no debug/dev tooling. A future React Native app is
// expected to mirror this same prop/callback contract (see MapSurface.contract.md).
import React, { useEffect, useRef, useState } from "react";
import {
  addRouteNetworkLayers,
  clearRouteDirectionPulseLayer,
  clearRouteNetworkLayers,
  DATA_MARKERS_LAYER_ID,
  loadDataMarkerIcons,
  prepareRouteNetworkFeatures,
  ROUTE_GEOMETRY_HIT_LAYER_ID,
  ROUTE_NETWORK_HIT_LAYER_ID,
  ROUTE_POINTS_LAYER_ID,
  setRouteNetworkFocus,
  setRouteNetworkHover,
  syncDataMarkerLayers,
  clearRoutePointDragPreviewLayer,
  syncRoutePointDragPreviewLayer,
  syncRouteDirectionPulseLayer,
  syncRouteGeometryLayer,
  syncRoutePointLayers,
  syncVideoCursorLayer,
} from "./mapLayers.js";
import { requireMapboxToken } from "./mapboxToken.js";
import { getMapboxGl, whenMapboxReady } from "./mapboxProvider.js";
import { distanceToLineSegmentPixels } from "@cycleways/core/utils/distance.js";
import {
  buildNetworkSegments,
  findClosestRouteSegment,
  isPointTooCloseToRouteUi,
  createClickStamp,
  isDuplicateRouteClick,
} from "./mapInteractions.js";
import {
  MAP_INITIAL_CENTER,
  MAP_INITIAL_ZOOM,
} from "@cycleways/core/map/mapViewport.js";
import { capabilitiesForMode, MAP_MODE_PLANNER } from "./mapCapabilities.js";

function MapSurface({
  activeDataPointIds = [],
  animator = null,
  dataMarkerFeatures = [],
  focusedMarker,
  focusedSegment,
  geoJsonData,
  elevationHover,
  hoveredSegment,
  mode = MAP_MODE_PLANNER,
  onDataMarkerClick,
  onMapClick,
  onMapReady,
  onRouteClick = null,
  onRoutePointDrag,
  onRoutePointDragEnd,
  onRoutePointDragStart,
  onRoutePointRemove,
  onRoutePointSelect,
  onRouteLineDrag,
  onRouteLineDragEnd,
  onRouteLineDragStart,
  onSegmentFocus,
  onSegmentHover,
  onUserViewportChange,
  onViewportIdle,
  routeFitRequest,
  routeFitPadding = 72,
  routeGeometry = [],
  routePointDragPreview = null,
  routePoints = [],
  searchHighlight,
  selectedRoutePointIndex = null,
  videoCursor = null,
}) {
  // Translate the mode into an explicit capability set. In planner mode every
  // flag is true, so every gated effect below behaves exactly as before.
  const caps = capabilitiesForMode(mode);
  const containerRef = useRef(null);
  const draggingPointRef = useRef(null);
  const routeLineDragRef = useRef(null);
  const mapRef = useRef(null);
  const searchMarkerRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const hoverPreviewMarkerRef = useRef(null);
  const lastRouteClickRef = useRef(null);
  const callbacksRef = useRef({});
  const dataMarkerFeaturesRef = useRef([]);
  const routeGeometryRef = useRef(routeGeometry);
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
      onRouteLineDrag,
      onRouteLineDragEnd,
      onRouteLineDragStart,
      onSegmentFocus,
      onSegmentHover,
      onUserViewportChange,
      onViewportIdle,
    };
  }, [
    onDataMarkerClick,
    onMapClick,
    onRoutePointDrag,
    onRoutePointDragEnd,
    onRoutePointDragStart,
    onRoutePointRemove,
    onRoutePointSelect,
    onRouteLineDrag,
    onRouteLineDragEnd,
    onRouteLineDragStart,
    onSegmentFocus,
    onSegmentHover,
    onUserViewportChange,
    onViewportIdle,
  ]);

  useEffect(() => {
    routeGeometryRef.current = routeGeometry;
  }, [routeGeometry]);

  useEffect(() => {
    routePointsRef.current = routePoints;
  }, [routePoints]);

  useEffect(() => {
    dataMarkerFeaturesRef.current = dataMarkerFeatures;
  }, [dataMarkerFeatures]);

  useEffect(() => {
    if (!containerRef.current) {
      setStatus("error");
      setError(new Error("Mapbox GL is not loaded"));
      return undefined;
    }

    let isDisposed = false;

    function createMap(mapboxgl) {
      if (isDisposed || !containerRef.current) return;
      try {
        mapboxgl.accessToken = requireMapboxToken();
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: "mapbox://styles/mapbox/outdoors-v12",
          center: MAP_INITIAL_CENTER,
          zoom: MAP_INITIAL_ZOOM,
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
    }

    // Mapbox GL JS loads asynchronously (its <script> is `async` so it doesn't
    // block the app shell), so wait for the global before creating the map.
    whenMapboxReady().then(
      (mapboxgl) => {
        if (isDisposed) return;
        if (!mapboxgl) {
          setStatus("error");
          setError(new Error("Mapbox GL is not loaded"));
          return;
        }
        createMap(mapboxgl);
      },
      (providerError) => {
        if (isDisposed) return;
        setStatus("error");
        setError(providerError);
      },
    );

    return () => {
      isDisposed = true;
      if (mapRef.current) {
        const map = mapRef.current;
        try {
          clearSearchHighlight(map, searchMarkerRef);
          clearHoverPreviewMarker(hoverPreviewMarkerRef);
          if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
          }
          map.remove();
        } catch (removeError) {
          console.warn("MapSurface cleanup failed", removeError);
        }
        mapRef.current = null;
      }
    };
  }, [onMapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !geoJsonData || !caps.networkLayers) {
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
        caps.hoverPreview &&
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
  }, [geoJsonData, status, caps.networkLayers, caps.hoverPreview]);

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
    if (!map || status !== "ready" || !caps.routeGeometryLayer) return;
    syncRouteGeometryLayer(map, routeGeometry, routePointDragPreview);
  }, [routeGeometry, routePointDragPreview, status, caps.routeGeometryLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.routePointDragPreview) return;
    syncRoutePointDragPreviewLayer(map, routePointDragPreview);
  }, [routePointDragPreview, status, caps.routePointDragPreview]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.routePointDragPreview) return undefined;
    return () => {
      clearRoutePointDragPreviewLayer(map);
    };
  }, [status, caps.routePointDragPreview]);

  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      status !== "ready" ||
      !onUserViewportChange ||
      !caps.viewportPrefetch
    ) {
      return undefined;
    }

    const emitUserViewportChange = (event) => {
      if (!event?.originalEvent) return;
      callbacksRef.current.onUserViewportChange?.();
    };
    const eventNames = [
      "wheel",
      "zoomend",
      "dragend",
      "rotateend",
      "pitchend",
      "boxzoomend",
    ];
    eventNames.forEach((eventName) => map.on(eventName, emitUserViewportChange));

    return () => {
      eventNames.forEach((eventName) => map.off(eventName, emitUserViewportChange));
    };
  }, [onUserViewportChange, status, caps.viewportPrefetch]);

  const animatorVisibleRef = useRef(true);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !animator || !caps.directionPulse) {
      return undefined;
    }

    const unsubscribe = animator.subscribe("chevron", (payload) => {
      if (!payload) {
        syncRouteDirectionPulseLayer(map, null, null);
        return;
      }
      if (!animatorVisibleRef.current) return;
      syncRouteDirectionPulseLayer(map, routeGeometryRef.current, payload.t);
    });

    return () => {
      unsubscribe();
      clearRouteDirectionPulseLayer(map);
    };
  }, [animator, status, caps.directionPulse]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.elevationPulse) return;

    if (Number.isFinite(elevationHover?.t)) {
      // Disable animator-driven visuals for this route — only reset on route change.
      animatorVisibleRef.current = false;
      syncRouteDirectionPulseLayer(map, routeGeometryRef.current, elevationHover.t);
    } else {
      clearRouteDirectionPulseLayer(map);
    }
  }, [elevationHover, status, caps.elevationPulse]);

  useEffect(() => {
    animatorVisibleRef.current = true;
  }, [routeGeometry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.videoCursorLayer) return;
    syncVideoCursorLayer(map, videoCursor);
  }, [videoCursor, status, caps.videoCursorLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !onRouteClick || !caps.routeClickCallback) {
      return undefined;
    }
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
  }, [status, onRouteClick, caps.routeClickCallback]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.routePointLayers) return;
    syncRoutePointLayers(map, routePoints, selectedRoutePointIndex);
  }, [routePoints, selectedRoutePointIndex, status, caps.routePointLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.dataMarkerLayer) return;
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
  }, [activeDataPointIds, dataMarkerFeatures, status, caps.dataMarkerLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.viewportPrefetch) return undefined;

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
  }, [status, caps.viewportPrefetch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return undefined;
    // The data-marker click is a read-only capability; map-click snapping and
    // route-point selection are planner-only. Register each handler only when
    // its capability is on so readonly maps don't wire planner interactions.
    const wantsMapClick = caps.networkHitTest;
    const wantsRoutePointSelect = caps.routePointSelect;
    const wantsDataMarkerClick = caps.dataMarkerClick;
    if (!wantsMapClick && !wantsRoutePointSelect && !wantsDataMarkerClick) {
      return undefined;
    }

    const hasBlockingClickFeature = (event) => {
      const layers = [
        ROUTE_POINTS_LAYER_ID,
        ROUTE_GEOMETRY_HIT_LAYER_ID,
        DATA_MARKERS_LAYER_ID,
      ].filter((layerId) => map.getLayer(layerId));
      if (layers.length === 0) return false;
      return map.queryRenderedFeatures(event.point, { layers }).length > 0;
    };

    const handleMapClick = (event) => {
      if (draggingPointRef.current !== null) return;
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
      const coordinates = feature.geometry?.coordinates || [];
      const lng = Number(coordinates[0]);
      const lat = Number(coordinates[1]);

      event.preventDefault?.();
      event.originalEvent?.stopPropagation?.();
      callbacksRef.current.onDataMarkerClick?.({
        id: feature.properties?.dataPointId,
        type: feature.properties?.type,
        name: feature.properties?.name,
        information: feature.properties?.information,
        description: feature.properties?.description,
        photo: feature.properties?.photo,
        thumbnail: feature.properties?.thumbnail,
        segmentName: feature.properties?.segmentName,
        emoji: feature.properties?.emoji,
        lng: Number.isFinite(lng) ? lng : event.lngLat.lng,
        lat: Number.isFinite(lat) ? lat : event.lngLat.lat,
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

    if (wantsMapClick) map.on("click", handleMapClick);
    if (wantsDataMarkerClick) {
      map.on("click", DATA_MARKERS_LAYER_ID, handleDataMarkerClick);
    }
    if (wantsRoutePointSelect) {
      map.on("click", ROUTE_POINTS_LAYER_ID, handleRoutePointClick);
    }

    return () => {
      if (wantsMapClick) map.off("click", handleMapClick);
      if (wantsDataMarkerClick) {
        map.off("click", DATA_MARKERS_LAYER_ID, handleDataMarkerClick);
      }
      if (wantsRoutePointSelect) {
        map.off("click", ROUTE_POINTS_LAYER_ID, handleRoutePointClick);
      }
    };
  }, [status, caps.networkHitTest, caps.routePointSelect, caps.dataMarkerClick]);

  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      status !== "ready" ||
      (!caps.routePointEditing && !caps.routeLineEditing)
    ) {
      return undefined;
    }

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

    const startRouteLineDrag = (event) => {
      if (draggingPointRef.current !== null || routeLineDragRef.current) return;
      const routePoints = routePointsRef.current;
      if (!Array.isArray(routePoints) || routePoints.length < 2) return;
      const pointHits = map.queryRenderedFeatures?.(event.point, {
        layers: [ROUTE_POINTS_LAYER_ID],
      });
      if (pointHits?.length > 0) return;

      const insertIndex = routeLineInsertIndexFromEvent(
        map,
        event,
        routeGeometryRef.current,
        routePoints,
      );
      if (!Number.isInteger(insertIndex)) return;

      event.preventDefault?.();
      event.originalEvent?.stopPropagation?.();
      routeLineDragRef.current = {
        active: false,
        insertIndex,
        startPoint: event.point,
      };
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grab";
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
      if (Number.isInteger(pointIndex)) {
        callbacksRef.current.onRoutePointDrag?.(pointIndex, {
          lng: event.lngLat.lng,
          lat: event.lngLat.lat,
        });
        return;
      }

      const routeLineDrag = routeLineDragRef.current;
      if (!routeLineDrag) return;

      if (!routeLineDrag.active) {
        const movedPixels = screenPointDistance(event.point, routeLineDrag.startPoint);
        if (movedPixels < 6) return;
        routeLineDrag.active = true;
        map.getCanvas().style.cursor = "grabbing";
        callbacksRef.current.onRouteLineDragStart?.(routeLineDrag.insertIndex, {
          lng: event.lngLat.lng,
          lat: event.lngLat.lat,
        });
      }

      callbacksRef.current.onRouteLineDrag?.(routeLineDrag.insertIndex, {
        lng: event.lngLat.lng,
        lat: event.lngLat.lat,
      });
    };

    const endDrag = () => {
      const pointIndex = draggingPointRef.current;
      const routeLineDrag = routeLineDragRef.current;

      if (Number.isInteger(pointIndex)) {
        draggingPointRef.current = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = "";
        callbacksRef.current.onRoutePointDragEnd?.(pointIndex);
        return;
      }

      if (routeLineDrag) {
        routeLineDragRef.current = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = "";
        if (routeLineDrag.active) {
          callbacksRef.current.onRouteLineDragEnd?.(routeLineDrag.insertIndex);
        }
      }
    };

    const enterPoint = () => {
      map.getCanvas().style.cursor = "grab";
    };

    const leavePoint = () => {
      if (!Number.isInteger(draggingPointRef.current)) {
        map.getCanvas().style.cursor = "";
      }
    };

    const enterRouteLine = () => {
      if (!Number.isInteger(draggingPointRef.current) && !routeLineDragRef.current) {
        map.getCanvas().style.cursor = "grab";
      }
    };

    const leaveRouteLine = () => {
      if (!Number.isInteger(draggingPointRef.current) && !routeLineDragRef.current) {
        map.getCanvas().style.cursor = "";
      }
    };

    if (caps.routePointEditing) {
      map.on("mousedown", ROUTE_POINTS_LAYER_ID, startDrag);
      map.on("touchstart", ROUTE_POINTS_LAYER_ID, startDrag);
      map.on("contextmenu", ROUTE_POINTS_LAYER_ID, removePoint);
      map.on("mouseenter", ROUTE_POINTS_LAYER_ID, enterPoint);
      map.on("mouseleave", ROUTE_POINTS_LAYER_ID, leavePoint);
    }
    if (caps.routeLineEditing && map.getLayer(ROUTE_GEOMETRY_HIT_LAYER_ID)) {
      map.on("mousedown", ROUTE_GEOMETRY_HIT_LAYER_ID, startRouteLineDrag);
      map.on("touchstart", ROUTE_GEOMETRY_HIT_LAYER_ID, startRouteLineDrag);
      map.on("mouseenter", ROUTE_GEOMETRY_HIT_LAYER_ID, enterRouteLine);
      map.on("mouseleave", ROUTE_GEOMETRY_HIT_LAYER_ID, leaveRouteLine);
    }
    map.on("mousemove", moveDrag);
    map.on("touchmove", moveDrag);
    map.on("mouseup", endDrag);
    map.on("touchend", endDrag);

    return () => {
      if (caps.routePointEditing) {
        map.off("mousedown", ROUTE_POINTS_LAYER_ID, startDrag);
        map.off("touchstart", ROUTE_POINTS_LAYER_ID, startDrag);
        map.off("contextmenu", ROUTE_POINTS_LAYER_ID, removePoint);
        map.off("mouseenter", ROUTE_POINTS_LAYER_ID, enterPoint);
        map.off("mouseleave", ROUTE_POINTS_LAYER_ID, leavePoint);
      }
      if (caps.routeLineEditing && map.getLayer(ROUTE_GEOMETRY_HIT_LAYER_ID)) {
        map.off("mousedown", ROUTE_GEOMETRY_HIT_LAYER_ID, startRouteLineDrag);
        map.off("touchstart", ROUTE_GEOMETRY_HIT_LAYER_ID, startRouteLineDrag);
        map.off("mouseenter", ROUTE_GEOMETRY_HIT_LAYER_ID, enterRouteLine);
        map.off("mouseleave", ROUTE_GEOMETRY_HIT_LAYER_ID, leaveRouteLine);
      }
      map.off("mousemove", moveDrag);
      map.off("touchmove", moveDrag);
      map.off("mouseup", endDrag);
      map.off("touchend", endDrag);
    };
  }, [routeGeometry, status, caps.routePointEditing, caps.routeLineEditing]);

  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      status !== "ready" ||
      !caps.routeFit ||
      !routeFitRequest?.geometry?.length
    ) {
      return;
    }

    fitMapToCoordinates(map, routeFitRequest.geometry, {
      maxZoom: 14,
      padding: routeFitPadding,
    });
  }, [routeFitPadding, routeFitRequest, status, caps.routeFit]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.focusedMarkerCamera || !focusedMarker?.coord) return;
    const { lng, lat } = focusedMarker.coord;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    const currentZoom = typeof map.getZoom === "function" ? map.getZoom() : 14;
    map.flyTo({
      center: [lng, lat],
      zoom: Math.max(currentZoom, 14),
      speed: 1.2,
    });
  }, [focusedMarker, status, caps.focusedMarkerCamera]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.searchHighlight || !searchHighlight) {
      return undefined;
    }

    clearSearchHighlight(map, searchMarkerRef);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const mapboxgl = getMapboxGl();
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
  }, [searchHighlight, status, caps.searchHighlight]);

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
  const mapboxgl = getMapboxGl();
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

function routeLineInsertIndexFromEvent(map, event, routeGeometry, routePoints) {
  const segmentIndex = nearestRouteGeometrySegmentIndex(
    map,
    event.point,
    routeGeometry,
  );
  if (!Number.isInteger(segmentIndex)) return null;

  const pointIndices = snapRoutePointsToGeometryIndices(routePoints, routeGeometry);
  if (pointIndices.length < 2) return null;

  for (let index = 0; index < pointIndices.length - 1; index++) {
    const start = pointIndices[index];
    const end = pointIndices[index + 1];
    if (segmentIndex >= start && segmentIndex < end) {
      return index + 1;
    }
  }

  let bestIndex = 1;
  let bestDistance = Infinity;
  for (let index = 0; index < pointIndices.length - 1; index++) {
    const start = pointIndices[index];
    const end = pointIndices[index + 1];
    const distance =
      segmentIndex < start
        ? start - segmentIndex
        : segmentIndex >= end
          ? segmentIndex - end + 1
          : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index + 1;
    }
  }
  return bestIndex;
}

function nearestRouteGeometrySegmentIndex(map, screenPoint, routeGeometry) {
  if (
    !map ||
    !screenPoint ||
    !Array.isArray(routeGeometry) ||
    routeGeometry.length < 2
  ) {
    return null;
  }

  let bestIndex = null;
  let bestDistance = Infinity;
  for (let index = 0; index < routeGeometry.length - 1; index++) {
    const start = projectRoutePoint(map, routeGeometry[index]);
    const end = projectRoutePoint(map, routeGeometry[index + 1]);
    if (!start || !end) continue;
    const distance = distanceToLineSegmentPixels(screenPoint, start, end);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function projectRoutePoint(map, point) {
  const lng = Number(point?.lng);
  const lat = Number(point?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const projected = map.project([lng, lat]);
  return { x: projected.x, y: projected.y };
}

function snapRoutePointsToGeometryIndices(routePoints, geometry) {
  if (!Array.isArray(routePoints) || !Array.isArray(geometry)) return [];
  const indices = [];
  for (const point of routePoints) {
    if (point?.pending) continue;
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) continue;
    let bestIndex = 0;
    let bestDist = Infinity;
    for (let index = 0; index < geometry.length; index++) {
      const candidate = geometry[index];
      const dLat = candidate.lat - point.lat;
      const dLng = candidate.lng - point.lng;
      const distance = dLat * dLat + dLng * dLng;
      if (distance < bestDist) {
        bestDist = distance;
        bestIndex = index;
      }
    }
    indices.push(bestIndex);
  }
  return indices;
}

function screenPointDistance(a, b) {
  if (!a || !b) return 0;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
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
  if (!lngLat) return;
  let mapboxgl;
  try {
    mapboxgl = getMapboxGl();
  } catch {
    return;
  }

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

export default MapSurface;
