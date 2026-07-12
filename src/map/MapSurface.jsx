// MapSurface: the platform-agnostic end-user map. It renders the map container
// and drives the product layers (route network, geometry, points + drag,
// direction pulse, data markers, search highlight) purely through props in and
// geographic callbacks out — no debug/dev tooling. A future React Native app is
// expected to mirror this same prop/callback contract (see MapSurface.contract.md).
import React, { useEffect, useRef, useState } from "react";
import {
  addRouteNetworkLayers,
  clearVideoCursorLayer,
  clearRouteDirectionPulseLayer,
  clearRouteNetworkLayers,
  DATA_MARKERS_LAYER_ID,
  loadDataMarkerIcons,
  prepareRouteNetworkFeatures,
  ROUTE_GEOMETRY_HIT_LAYER_ID,
  ROUTE_NETWORK_HIT_LAYER_ID,
  ROUTE_POINTS_LAYER_ID,
  setBuiltRouteVisibility,
  setRouteNetworkFocus,
  setRouteNetworkHover,
  syncDataMarkerLayers,
  clearRoutePointDragPreviewLayer,
  syncRoutePointDragPreviewLayer,
  syncRouteDirectionPulseLayer,
  syncRouteGeometryLayer,
  syncRoutePointLayers,
  syncVideoCursorLayer,
  syncSegmentHighlightLayer,
  syncRecommendedRoutesLayer,
} from "./mapLayers.js";
import { requireMapboxToken } from "./mapboxToken.js";
import { getMapboxGl, whenMapboxReady } from "./mapboxProvider.js";
import {
  distanceToLineSegmentPixels,
  getDistance,
} from "@cycleways/core/utils/distance.js";
import {
  buildNetworkSegments,
  findClosestRouteSegment,
  clickMetersPerPixel,
  isPointTooCloseToRouteUi,
  createClickStamp,
  isDuplicateRouteClick,
} from "./mapInteractions.js";
import {
  MAP_INITIAL_CENTER,
  MAP_INITIAL_ZOOM,
} from "@cycleways/core/map/mapViewport.js";
import {
  VIDEO_CURSOR_DEFAULT_VARIANT,
} from "@cycleways/core/map/mapStyles.js";
import { capabilitiesForMode, MAP_MODE_PLANNER } from "./mapCapabilities.js";
import { buildOrientZoom } from "./buildOrientCamera.js";
import { circlePolygon } from "@cycleways/core/utils/geoCircle.js";

const ROUTE_CIRCULAR_ENDPOINT_MAX_METERS = 80;

function isMapAvailableForCleanup(map) {
  if (!map || map._removed) return false;
  try {
    return typeof map.getStyle !== "function" || Boolean(map.getStyle());
  } catch {
    return false;
  }
}

function runMapCleanup(map, cleanup) {
  if (!isMapAvailableForCleanup(map)) return;
  try {
    cleanup();
  } catch (error) {
    console.warn("MapSurface cleanup failed", error);
  }
}

function MapSurface({
  activeDataPointIds = [],
  animator = null,
  cameraPadding = null,
  dataMarkerFeatures = [],
  focusedMarker,
  focusedSegment,
  geoJsonData,
  elevationHover,
  hideBuiltRoute = false,
  hoveredSegment,
  mode = MAP_MODE_PLANNER,
  onDataMarkerClick,
  onDataMarkerHover,
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
  orientRequest = 0,
  routeFitRequest,
  routeFitPadding = 72,
  routeGeometry = [],
  routePointDragPreview = null,
  routePoints = [],
  locationFix = null,
  searchHighlight,
  recommendedRoutes = null,
  segmentHighlight = null,
  networkBaseMapProfile = "mapbox-outdoors",
  networkColorScheme = "auto",
  networkPresentationVariant = "current",
  routeBuilding = false,
  routeGeometryPresentation = "current",
  selectedRoutePointIndex = null,
  videoCursor = null,
  videoCursorVariant = VIDEO_CURSOR_DEFAULT_VARIANT,
  videoPlaying = false,
}) {
  // Translate the mode into an explicit capability set. In planner mode every
  // flag is true, so every gated effect below behaves exactly as before.
  const caps = capabilitiesForMode(mode);
  const containerRef = useRef(null);
  const draggingPointRef = useRef(null);
  const routeLineDragRef = useRef(null);
  const mapRef = useRef(null);
  const searchMarkerRef = useRef(null);
  const locationMarkerRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const hoverPreviewMarkerRef = useRef(null);
  const routeEndpointMarkerRefs = useRef([]);
  const lastRouteClickRef = useRef(null);
  const lastOrientTokenRef = useRef(0);
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
      onDataMarkerHover,
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
    onDataMarkerHover,
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

  // Resize the Mapbox canvas whenever the container element changes size.
  // This handles panel collapse/expand, window resize, and any other
  // container-driven geometry change.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return undefined;

    let rafId = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        mapRef.current?.resize?.();
      });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

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
        runMapCleanup(map, () => {
          clearSearchHighlight(map, searchMarkerRef);
          clearLocationFix(map, locationMarkerRef);
          clearHoverPreviewMarker(hoverPreviewMarkerRef);
          clearVideoCursorLayer(map);
          if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
          }
        });
        try {
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

    const networkPresentationOptions = {
      baseMapProfile: networkBaseMapProfile,
      colorScheme: networkColorScheme,
      routeBuilding,
      variant: networkPresentationVariant,
    };
    const features = prepareRouteNetworkFeatures(
      geoJsonData,
      networkPresentationOptions,
    );
    networkSegmentsRef.current = buildNetworkSegments(features);
    addRouteNetworkLayers(map, features, networkPresentationOptions);

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
      // A click on an existing route point / built line / data marker belongs
      // to that feature's own handler — without this guard, points (which
      // always sit on network paths) would re-add a point on every tap.
      if (clickOnBlockingFeature(map, event)) return;
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
        metersPerPixel: clickMetersPerPixel(map, event.lngLat),
      });
    };

    map.on("mousemove", handleMouseMove);
    map.on("mouseout", handleMouseLeave);
    map.on("click", ROUTE_NETWORK_HIT_LAYER_ID, handleClick);

    return () => {
      runMapCleanup(map, () => {
        map.off("mousemove", handleMouseMove);
        map.off("mouseout", handleMouseLeave);
        map.off("click", ROUTE_NETWORK_HIT_LAYER_ID, handleClick);
        clearHoverPreviewMarker(hoverPreviewMarkerRef);
        networkSegmentsRef.current = [];
        clearRouteNetworkLayers(map);
      });
    };
  }, [
    geoJsonData,
    networkBaseMapProfile,
    networkColorScheme,
    networkPresentationVariant,
    routeBuilding,
    status,
    caps.networkLayers,
    caps.hoverPreview,
  ]);

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
    syncRouteGeometryLayer(map, routeGeometry, routePointDragPreview, {
      variant: routeGeometryPresentation,
    });
  }, [
    routeGeometry,
    routePointDragPreview,
    routeGeometryPresentation,
    status,
    caps.routeGeometryLayer,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    syncSegmentHighlightLayer(map, segmentHighlight);
  }, [segmentHighlight, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    syncRecommendedRoutesLayer(map, recommendedRoutes);
  }, [recommendedRoutes, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    setBuiltRouteVisibility(map, !hideBuiltRoute);
  }, [hideBuiltRoute, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.routeEndpointMarkers) {
      clearRouteEndpointMarkers(routeEndpointMarkerRefs);
      return undefined;
    }
    syncRouteEndpointMarkers(map, routeEndpointMarkerRefs, routeGeometry);
    return () => clearRouteEndpointMarkers(routeEndpointMarkerRefs);
  }, [routeGeometry, status, caps.routeEndpointMarkers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.routePointDragPreview) return;
    syncRoutePointDragPreviewLayer(map, routePointDragPreview);
  }, [routePointDragPreview, status, caps.routePointDragPreview]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.routePointDragPreview) return undefined;
    return () => {
      runMapCleanup(map, () => clearRoutePointDragPreviewLayer(map));
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
      runMapCleanup(map, () => {
        eventNames.forEach((eventName) => map.off(eventName, emitUserViewportChange));
      });
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
      runMapCleanup(map, () => clearRouteDirectionPulseLayer(map));
    };
  }, [animator, status, caps.directionPulse]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.elevationPulse) return;

    // Elevation-graph hover is shown with the standard orange route-progress
    // cursor (the video-cursor PROGRESS_HEAD marker), which already tracks the
    // hover position because the elevation handler seeks playback to the hovered
    // fraction. Here we only suppress the direction-pulse chevron so the two
    // don't both render on the route.
    if (Number.isFinite(elevationHover?.t)) {
      // Disable animator-driven visuals for this route — only reset on route change.
      animatorVisibleRef.current = false;
    }
    clearRouteDirectionPulseLayer(map);
  }, [elevationHover, status, caps.elevationPulse]);

  useEffect(() => {
    animatorVisibleRef.current = true;
  }, [routeGeometry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.videoCursorLayer) return;
    if (!videoCursor) {
      clearVideoCursorLayer(map);
      return;
    }
    syncVideoCursorLayer(map, videoCursor, {
      playing: videoPlaying,
      routeGeometry: routeGeometryRef.current,
      variant: videoCursorVariant,
    });
  }, [
    videoCursor,
    videoCursorVariant,
    videoPlaying,
    routeGeometry,
    status,
    caps.videoCursorLayer,
  ]);

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
    return () => runMapCleanup(map, () => map.off("click", handler));
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
      runMapCleanup(map, () => map.off("moveend", emitViewportIdle));
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

    const handleMapClick = (event) => {
      if (draggingPointRef.current !== null) return;
      if (clickOnBlockingFeature(map, event)) return;
      if (isDuplicateRouteClick(lastRouteClickRef.current, event)) return;

      // Pass the raw click through: the route manager snaps against the full
      // base network (roads + CW), so relocating onto the CW-only network
      // here would bias every click toward CW edges.
      clearHoverPreviewMarker(hoverPreviewMarkerRef);
      callbacksRef.current.onMapClick?.({
        lng: event.lngLat.lng,
        lat: event.lngLat.lat,
        metersPerPixel: clickMetersPerPixel(map, event.lngLat),
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

    // Hover a data marker → report its id so linked UI (the segment card chips)
    // can highlight the matching entry. Deduped so we only notify on change.
    let hoveredDataPointId = null;
    const emitDataMarkerHover = (next) => {
      if (next === hoveredDataPointId) return;
      hoveredDataPointId = next;
      callbacksRef.current.onDataMarkerHover?.(next);
    };
    const handleDataMarkerMove = (event) => {
      emitDataMarkerHover(event.features?.[0]?.properties?.dataPointId ?? null);
    };
    const handleDataMarkerLeave = () => emitDataMarkerHover(null);

    if (wantsMapClick) map.on("click", handleMapClick);
    if (wantsDataMarkerClick) {
      map.on("click", DATA_MARKERS_LAYER_ID, handleDataMarkerClick);
      map.on("mousemove", DATA_MARKERS_LAYER_ID, handleDataMarkerMove);
      map.on("mouseleave", DATA_MARKERS_LAYER_ID, handleDataMarkerLeave);
    }
    if (wantsRoutePointSelect) {
      map.on("click", ROUTE_POINTS_LAYER_ID, handleRoutePointClick);
    }

    return () => {
      runMapCleanup(map, () => {
        if (wantsMapClick) map.off("click", handleMapClick);
        if (wantsDataMarkerClick) {
          map.off("click", DATA_MARKERS_LAYER_ID, handleDataMarkerClick);
          map.off("mousemove", DATA_MARKERS_LAYER_ID, handleDataMarkerMove);
          map.off("mouseleave", DATA_MARKERS_LAYER_ID, handleDataMarkerLeave);
        }
        if (wantsRoutePointSelect) {
          map.off("click", ROUTE_POINTS_LAYER_ID, handleRoutePointClick);
        }
      });
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

    // Point drags activate only past the slop threshold, so a touch that's
    // really a tap or a wobbly pan start doesn't move the point. A no-move
    // release is cleaned up in endDrag; selection is left to the layer click
    // handler (handleRoutePointClick) which runs after handleMapClick's
    // blocking query has read the still-intact points layer.
    // Mirrors the routeLineDrag pending→active pattern below.
    const POINT_DRAG_SLOP_PX = 6;

    const startDrag = (event) => {
      const pointIndex = getPointIndex(event);
      if (!Number.isInteger(pointIndex)) return;

      event.preventDefault?.();
      draggingPointRef.current = {
        index: pointIndex,
        startPoint: event.point,
        active: false,
      };
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grab";
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
      const pointDrag = draggingPointRef.current;
      if (pointDrag) {
        if (!pointDrag.active) {
          const movedPixels = screenPointDistance(event.point, pointDrag.startPoint);
          if (movedPixels < POINT_DRAG_SLOP_PX) return;
          pointDrag.active = true;
          map.getCanvas().style.cursor = "grabbing";
          callbacksRef.current.onRoutePointDragStart?.(pointDrag.index);
        }
        callbacksRef.current.onRoutePointDrag?.(pointDrag.index, {
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
      const pointDrag = draggingPointRef.current;
      const routeLineDrag = routeLineDragRef.current;

      if (pointDrag) {
        draggingPointRef.current = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = "";
        if (pointDrag.active) {
          callbacksRef.current.onRoutePointDragEnd?.(pointDrag.index);
        }
        // A no-move release is a tap; selection is handled by the layer click
        // handler, which fires after handleMapClick's blocking query has seen
        // the still-intact points layer (selecting here at mouseup would
        // setData the layer and break that query → a bogus extra point).
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
      if (!draggingPointRef.current) {
        map.getCanvas().style.cursor = "";
      }
    };

    const enterRouteLine = () => {
      if (!draggingPointRef.current && !routeLineDragRef.current) {
        map.getCanvas().style.cursor = "grab";
      }
    };

    const leaveRouteLine = () => {
      if (!draggingPointRef.current && !routeLineDragRef.current) {
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
      runMapCleanup(map, () => {
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
      });
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
      padding: routeFitRequest.padding ?? routeFitPadding,
    });
  }, [routeFitPadding, routeFitRequest, status, caps.routeFit]);

  // Orient-to-network on entering Build (from Discover, empty planner): keep the
  // current center and step the zoom out one level so the surrounding network
  // comes into view. Guarded by a token ref so a later cameraPadding change
  // (which re-runs this effect) doesn't compound into a second zoom-out.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.routeFit) return;
    if (!orientRequest || orientRequest === lastOrientTokenRef.current) return;
    lastOrientTokenRef.current = orientRequest;
    const currentZoom = typeof map.getZoom === "function" ? map.getZoom() : MAP_INITIAL_ZOOM;
    const zoom = buildOrientZoom(currentZoom);
    if (zoom === null) return;
    // No `center`: easeTo keeps the current center, so this is a pure zoom-out
    // around where the user already is. cameraPadding keeps it clear of the
    // planner panel overlay.
    map.easeTo(withCameraPadding({
      zoom,
      duration: 600,
    }, cameraPadding));
  }, [orientRequest, cameraPadding, status, caps.routeFit]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.focusedMarkerCamera || !focusedMarker?.coord) return;
    const { lng, lat } = focusedMarker.coord;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    const currentZoom = typeof map.getZoom === "function" ? map.getZoom() : 14;
    map.flyTo(withCameraPadding({
      center: [lng, lat],
      zoom: Math.max(currentZoom, 14),
      speed: 1.2,
    }, cameraPadding));
  }, [cameraPadding, focusedMarker, status, caps.focusedMarkerCamera]);

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
    map.flyTo(withCameraPadding({
      center: [searchHighlight.lng, searchHighlight.lat],
      zoom: 11.5,
      duration: 1000,
    }, cameraPadding));

    searchTimeoutRef.current = setTimeout(() => {
      clearSearchHighlight(map, searchMarkerRef);
    }, 4000);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
    };
  }, [cameraPadding, searchHighlight, status, caps.searchHighlight]);

  // Locate-me fix: persistent marker + meter-accurate accuracy ring. Replaced
  // wholesale when a new fix arrives; camera flies only to in-bounds fixes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !caps.locationFix || !locationFix) {
      return undefined;
    }

    locationMarkerRef.current?.remove();
    const mapboxgl = getMapboxGl();
    const el = document.createElement("div");
    el.className = "react-locate-marker";
    locationMarkerRef.current = new mapboxgl.Marker(el)
      .setLngLat([locationFix.lng, locationFix.lat])
      .addTo(map);

    syncLocationAccuracyRing(map, locationFix);
    if (locationFix.withinBounds) {
      map.flyTo(withCameraPadding({
        center: [locationFix.lng, locationFix.lat],
        zoom: Math.max(typeof map.getZoom === "function" ? map.getZoom() : 13, 13),
        duration: 1000,
      }, cameraPadding));
    }
    return undefined;
  }, [cameraPadding, locationFix, status, caps.locationFix]);

  return (
    <>
      <div
        className="react-map"
        id="map"
        ref={containerRef}
        role="region"
        aria-label="מפת CycleWays"
        aria-describedby="cycleways-map-description"
      />
      <p id="cycleways-map-description" className="visually-hidden">
        מפה גרפית אינטראקטיבית לחקירה באמצעות מצביע ומקלדת. חיפוש, סינון,
        פרטי מסלול, אזהרות ופעולות זמינים גם כבקרות וטקסט מחוץ למפה.
      </p>
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
  const validPoints = normalizeFitCoordinates(coordinates);
  if (validPoints.length === 0) return;

  const mapboxgl = getMapboxGl();
  const bounds = new mapboxgl.LngLatBounds();

  validPoints.forEach((point) => {
    bounds.extend([point.lng, point.lat]);
  });

  if (bounds.isEmpty()) return;
  if (!hasUsableFitViewport(map)) return;

  const padding = normalizeFitPadding(map, options.padding || 48);
  const maxZoom = Number.isFinite(Number(options.maxZoom))
    ? Number(options.maxZoom)
    : 14;

  if (isDegenerateFitBounds(validPoints)) {
    const point = validPoints[0];
    map.flyTo(withCameraPadding({
      center: [point.lng, point.lat],
      zoom: maxZoom,
      duration: prefersReducedMotion() ? 0 : 600,
    }, padding));
    return;
  }

  try {
    map.fitBounds(bounds, {
      duration: prefersReducedMotion() ? 0 : 600,
      maxZoom,
      padding,
    });
  } catch (error) {
    console.warn("Map route fit skipped", error);
  }
}

function normalizeFitCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) return [];
  const points = [];
  for (const point of coordinates) {
    const lng = Number(point?.lng);
    const lat = Number(point?.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    points.push({ lng, lat });
  }
  return points;
}

function hasUsableFitViewport(map) {
  const container = map.getContainer?.();
  if (!container?.getBoundingClientRect) return true;
  const rect = container.getBoundingClientRect();
  return Number.isFinite(rect.width) && rect.width > 0 &&
    Number.isFinite(rect.height) && rect.height > 0;
}

function isDegenerateFitBounds(points) {
  if (points.length < 2) return true;
  const first = points[0];
  return points.every((point) => point.lng === first.lng && point.lat === first.lat);
}

function normalizeFitPadding(map, padding) {
  const fallback = 48;
  if (!padding || typeof padding !== "object") {
    const value = finiteNonNegativeNumber(padding, fallback);
    return { top: value, right: value, bottom: value, left: value };
  }

  const rect = map.getContainer?.()?.getBoundingClientRect?.();
  const width = finitePositiveNumber(rect?.width, 0);
  const height = finitePositiveNumber(rect?.height, 0);
  const result = {
    top: finiteNonNegativeNumber(padding.top, fallback),
    right: finiteNonNegativeNumber(padding.right, fallback),
    bottom: finiteNonNegativeNumber(padding.bottom, fallback),
    left: finiteNonNegativeNumber(padding.left, fallback),
  };
  clampPaddingPair(result, "top", "bottom", height);
  clampPaddingPair(result, "left", "right", width);
  return result;
}

function finiteNonNegativeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function finitePositiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clampPaddingPair(padding, a, b, dimension) {
  if (!(dimension > 0)) return;
  const max = dimension * 0.8;
  padding[a] = Math.min(padding[a], max);
  padding[b] = Math.min(padding[b], max);
  const sum = padding[a] + padding[b];
  if (sum < dimension) return;
  const scale = max / sum;
  padding[a] *= scale;
  padding[b] *= scale;
}

function withCameraPadding(options, cameraPadding) {
  if (!cameraPadding) return options;
  return {
    ...options,
    padding: cameraPadding,
    retainPadding: false,
  };
}

// Honor the user's reduced-motion preference: animate the camera by default,
// but jump instantly when the OS/browser requests reduced motion.
function prefersReducedMotion() {
  return Boolean(
    typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
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

const LOCATION_RING_SOURCE_ID = "locate-accuracy-ring";
const LOCATION_RING_LAYER_ID = "locate-accuracy-ring-fill";

function syncLocationAccuracyRing(map, locationFix) {
  const radius = Number.isFinite(locationFix.accuracy)
    ? Math.max(locationFix.accuracy, 15)
    : 15;
  const data = {
    type: "Feature",
    properties: {},
    geometry: circlePolygon(locationFix.lat, locationFix.lng, radius),
  };
  const source = map.getSource(LOCATION_RING_SOURCE_ID);
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource(LOCATION_RING_SOURCE_ID, { type: "geojson", data });
  map.addLayer({
    id: LOCATION_RING_LAYER_ID,
    type: "fill",
    source: LOCATION_RING_SOURCE_ID,
    paint: { "fill-color": "#1d6ee8", "fill-opacity": 0.15 },
  });
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

function clearLocationFix(map, markerRef) {
  markerRef.current?.remove();
  markerRef.current = null;

  if (map?.getLayer(LOCATION_RING_LAYER_ID)) {
    map.removeLayer(LOCATION_RING_LAYER_ID);
  }
  if (map?.getSource(LOCATION_RING_SOURCE_ID)) {
    map.removeSource(LOCATION_RING_SOURCE_ID);
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

// True when a click landed on an interactive feature (route point, built
// route line, data marker) that owns the interaction — both the map-level and
// the network-layer click handlers must not treat such clicks as add-point.
function clickOnBlockingFeature(map, event) {
  const layers = [
    ROUTE_POINTS_LAYER_ID,
    ROUTE_GEOMETRY_HIT_LAYER_ID,
    DATA_MARKERS_LAYER_ID,
  ].filter((layerId) => map.getLayer(layerId));
  if (layers.length === 0) return false;
  return map.queryRenderedFeatures(event.point, { layers }).length > 0;
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

function syncRouteEndpointMarkers(map, markerRefs, routeGeometry) {
  clearRouteEndpointMarkers(markerRefs);
  let mapboxgl;
  try {
    mapboxgl = getMapboxGl();
  } catch {
    return;
  }

  const endpoints = routeEndpointDescriptors(routeGeometry);
  markerRefs.current = endpoints.map((endpoint) => {
    const markerElement = routeEndpointMarkerElement(endpoint.kind);
    return new mapboxgl.Marker(markerElement)
      .setLngLat([endpoint.point.lng, endpoint.point.lat])
      .addTo(map);
  });
}

function clearRouteEndpointMarkers(markerRefs) {
  markerRefs.current.forEach((marker) => marker.remove());
  markerRefs.current = [];
}

function routeEndpointDescriptors(routeGeometry) {
  const points = Array.isArray(routeGeometry)
    ? routeGeometry.map(normalizeLngLat).filter(Boolean)
    : [];
  if (points.length < 2) return [];

  const start = points[0];
  const end = points[points.length - 1];
  const endpointDistance = getDistance(start, end);
  if (
    Number.isFinite(endpointDistance) &&
    endpointDistance <= ROUTE_CIRCULAR_ENDPOINT_MAX_METERS
  ) {
    return [{ kind: "circular", point: start }];
  }

  return [
    { kind: "start", point: start },
    { kind: "end", point: end },
  ];
}

function normalizeLngLat(point) {
  const lng = Number(point?.lng);
  const lat = Number(point?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
}

function routeEndpointMarkerElement(kind) {
  const markerElement = document.createElement("div");
  markerElement.className = [
    "route-endpoint-marker",
    `route-endpoint-marker--${kind}`,
  ].join(" ");
  markerElement.setAttribute("aria-hidden", "true");
  markerElement.title = kind === "circular"
    ? "נקודת התחלה וסיום"
    : kind === "start"
      ? "נקודת התחלה"
      : "נקודת סיום";

  if (kind === "start") {
    const glyph = document.createElement("span");
    glyph.textContent = "▶";
    markerElement.appendChild(glyph);
  }

  return markerElement;
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
