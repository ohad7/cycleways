
import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import mapboxgl from 'mapbox-gl';
import RouteManager from './utils/RouteManager';
import SpatialIndex from './utils/SpatialIndex';
import { getDistance, distanceToLineSegmentPixels } from './utils/distance';
import { smoothElevations } from './utils/elevations';
import { encodeRoute, decodeRoute } from './utils/route-encoding';
import { executeDownloadGPX, generateGPX } from './utils/gpx-generator';
import { 
  trackRoutePointEvent, 
  trackUndoRedoEvent, 
  trackSearchEvent, 
  trackSocialShare, 
  trackSegmentFocus, 
  trackWarningClick, 
  trackRouteOperation,
  trackPageLoad,
  trackTutorial
} from './utils/analytics';

// Import components
import Header from './components/Header';
import MapContainer from './components/MapContainer';
import ContentSections from './components/ContentSections';
import Footer from './components/Footer';

function App() {
  // State management
  const [selectedSegments, setSelectedSegments] = useState([]);
  const [routePoints, setRoutePoints] = useState([]);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [segmentsData, setSegmentsData] = useState(null);
  const [routePolylines, setRoutePolylines] = useState([]);
  const [segmentMetrics, setSegmentMetrics] = useState({});
  const [operationsLog, setOperationsLog] = useState([]);
  const [isDraggingPoint, setIsDraggingPoint] = useState(false);

  // Refs
  const mapRef = useRef(null);
  const routeManagerRef = useRef(null);
  const spatialIndexRef = useRef(null);

  // Constants
  const COLORS = {
    WARNING_ORANGE: "#882211",
    WARNING_RED: "#f44336",
    SEGMENT_SELECTED: "#006699",
    SEGMENT_HOVER: "#666633",
    SEGMENT_HOVER_SELECTED: "#003399",
    SEGMENT_SIDEBAR_HOVER: "#666633",
    ELEVATION_MARKER: "#ff4444",
    HIGHLIGHT_WHITE: "#ffffff",
  };

  const MIN_ZOOM_LEVEL = 13;

  // Initialize map and load data
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Track page load
        trackPageLoad(!!getRouteParameter(), navigator.userAgent);

        // Initialize map
        await initMap();
        
        // Load data
        await loadKMLFile();
        
        // Initialize tutorial if available
        if (typeof window.initTutorial === 'function') {
          window.initTutorial();
        }
      } catch (error) {
        console.error('Error initializing app:', error);
      }
    };

    initializeApp();
  }, []);

  const initMap = useCallback(async () => {
    try {
      mapboxgl.accessToken = "pk.eyJ1Ijoib3NlcmZhdHkiLCJhIjoiY21kNmdzb3NnMDlqZTJrc2NzNmh3aGk1aCJ9.dvA6QY0N5pQ2IISZHp53kg";

      const map = new mapboxgl.Map({
        container: "map",
        style: "mapbox://styles/mapbox/outdoors-v12",
        center: [35.617497, 33.183536],
        zoom: 11.5,
      });

      mapRef.current = map;

      map.on("load", () => {
        try {
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
        } catch (error) {
          console.warn("Could not set Hebrew labels:", error);
        }
      });

      // Add map event listeners
      setupMapEventListeners(map);

    } catch (error) {
      console.error('Error initializing map:', error);
    }
  }, []);

  const setupMapEventListeners = useCallback((map) => {
    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

    if (!isTouchDevice) {
      let lastCursorState = "default";

      map.on("mousemove", (e) => {
        if (isDraggingPoint || map.isMoving()) return;

        const mousePoint = e.lngLat;
        const mousePixel = map.project(mousePoint);
        const threshold = 15;
        let closestSegment = null;

        if (spatialIndexRef.current) {
          const degreeThreshold = threshold * 0.00005;
          const candidateSegment = spatialIndexRef.current.findNearestSegment(
            mousePoint.lat,
            mousePoint.lng,
            degreeThreshold,
          );

          if (candidateSegment) {
            const coords = candidateSegment.coordinates;
            let minPixelDistance = Infinity;

            for (let i = 0; i < coords.length - 1; i++) {
              const startPixel = map.project([coords[i].lng, coords[i].lat]);
              const endPixel = map.project([coords[i + 1].lng, coords[i + 1].lat]);

              const distance = distanceToLineSegmentPixels(
                mousePixel,
                startPixel,
                endPixel,
              );

              if (distance < minPixelDistance) {
                minPixelDistance = distance;
              }
            }

            if (minPixelDistance < threshold) {
              closestSegment = candidateSegment;
            }
          }
        }

        const newCursorState = closestSegment ? "pointer" : "default";
        if (newCursorState !== lastCursorState) {
          map.getCanvas().style.cursor = newCursorState;
          lastCursorState = newCursorState;
        }

        updateSegmentHover(closestSegment);
      });
    }

    // Click handler
    map.on("click", (e) => {
      if (isDraggingPoint || isTouchDevice) return;

      const features = map.queryRenderedFeatures(e.point, {
        layers: ["data-markers-layer"],
      });

      if (features.length > 0) return;

      addPointFromLngLat(e.lngLat);
    });

    // Touch handlers
    if (isTouchDevice) {
      let tapStartPx = null;

      map.on("touchstart", (e) => {
        if (e.points && e.points.length > 0) {
          tapStartPx = e.points[0];
        }
      });

      map.on("touchend", (e) => {
        if (isDraggingPoint || !e.points || e.points.length !== 1) return;

        const endPx = e.points[0];
        const moved = tapStartPx
          ? Math.hypot(endPx.x - tapStartPx.x, endPx.y - tapStartPx.y)
          : 0;
        if (moved > 10) return;

        tapStartPx = null;
        const features = map.queryRenderedFeatures(e.point, {
          layers: ["data-markers-layer"],
        });

        if (features.length > 0) return;

        addPointFromLngLat(e.lngLat);
      });
    }

    map.on("contextmenu", (e) => {
      e.preventDefault();
    });
  }, [isDraggingPoint]);

  // Load segments data
  const loadSegmentsData = async () => {
    try {
      const response = await fetch("./segments.json");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setSegmentsData(data);
      return data;
    } catch (error) {
      console.warn("Could not load segments.json:", error);
      setSegmentsData({});
      return {};
    }
  };

  // Load KML file and initialize everything
  const loadKMLFile = async () => {
    try {
      const segData = await loadSegmentsData();
      
      const response = await fetch("./bike_roads_v14.geojson");
      const geoJsonData = await response.json();
      
      await parseGeoJSON(geoJsonData);
      
      // Try to load route from URL after everything is loaded
      setTimeout(() => {
        loadRouteFromUrl();
      }, 1000);
    } catch (error) {
      console.error("Error loading GeoJSON file:", error);
    }
  };

  // Parse GeoJSON data and setup map
  const parseGeoJSON = async (geoJsonData) => {
    if (!geoJsonData.features || geoJsonData.features.length === 0) {
      console.error("No route segments found in the GeoJSON file.");
      return;
    }

    const map = mapRef.current;
    if (!map) return;

    // Clear existing layers
    routePolylines.forEach((polylineData) => {
      if (map.getLayer(polylineData.layerId)) {
        map.removeLayer(polylineData.layerId);
      }
      if (map.getSource(polylineData.layerId)) {
        map.removeSource(polylineData.layerId);
      }
    });

    const newPolylines = [];
    let bounds = new mapboxgl.LngLatBounds();

    geoJsonData.features.forEach((feature) => {
      if (feature.geometry.type !== "LineString") return;

      const name = feature.properties.name || "Unnamed Route";
      const coordinates = feature.geometry.coordinates;

      const coordObjects = coordinates.map((coord) => ({
        lat: coord[1],
        lng: coord[0],
        elevation: coord[2],
      }));

      let originalColor = feature.properties.stroke || feature.properties["stroke-color"] || "#0288d1";

      if (originalColor === "#0288d1" || originalColor === "rgb(2, 136, 209)") {
        originalColor = "rgb(101, 170, 162)";
      } else if (originalColor === "#e6ee9c" || originalColor === "rgb(230, 238, 156)") {
        originalColor = "rgb(138, 147, 158)";
      } else {
        originalColor = "rgb(174, 144, 103)";
      }

      const originalWeight = 3;
      const originalOpacity = 1.0;
      const layerId = `route-${name.replace(/\s+/g, "-").replace(/[^\w-]/g, "")}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      map.addSource(layerId, {
        type: "geojson",
        data: feature,
      });

      map.addLayer({
        id: layerId,
        type: "line",
        source: layerId,
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": originalColor,
          "line-width": originalWeight,
          "line-opacity": originalOpacity,
        },
      });

      const polylineData = {
        segmentName: name,
        layerId: layerId,
        coordinates: coordObjects,
        originalStyle: {
          color: originalColor,
          weight: originalWeight,
          opacity: originalOpacity,
        },
      };
      newPolylines.push(polylineData);

      coordinates.forEach((coord) => bounds.extend(coord));

      // Add event listeners for this layer
      setupSegmentEventListeners(map, layerId, name, polylineData);
    });

    setRoutePolylines(newPolylines);
    
    // Pre-calculate metrics
    preCalculateSegmentMetrics(newPolylines);
    
    // Initialize spatial index
    const spatialIndex = new SpatialIndex();
    newPolylines.forEach((polylineData) => {
      spatialIndex.addSegment(polylineData);
    });
    spatialIndexRef.current = spatialIndex;

    // Initialize RouteManager
    const routeManager = new RouteManager();
    await routeManager.load(geoJsonData, segmentsData);
    routeManagerRef.current = routeManager;

    // Initialize data markers
    await initDataMarkers();
  };

  // Setup event listeners for segments
  const setupSegmentEventListeners = (map, layerId, name, polylineData) => {
    map.on("mouseenter", layerId, (e) => {
      if (!selectedSegments.includes(name)) {
        map.setPaintProperty(layerId, "line-width", polylineData.originalStyle.weight + 2);
        map.setPaintProperty(layerId, "line-opacity", 1);
      }
      showSegmentInfo(name, e);
    });

    map.on("mouseleave", layerId, () => {
      if (!selectedSegments.includes(name)) {
        map.setPaintProperty(layerId, "line-width", polylineData.originalStyle.weight);
        map.setPaintProperty(layerId, "line-opacity", polylineData.originalStyle.opacity);
      }
      hideSegmentInfo();
    });

    map.on("mousemove", layerId, (e) => {
      if (selectedSegments.includes(name)) {
        handleSelectedSegmentHover(e, name);
      }
    });
  };

  // Update segment hover effects
  const updateSegmentHover = useCallback((closestSegment) => {
    const map = mapRef.current;
    if (!map) return;

    // Reset all segments to normal style first
    routePolylines.forEach((polylineData) => {
      const layerId = polylineData.layerId;
      if (selectedSegments.includes(polylineData.segmentName)) {
        map.setPaintProperty(layerId, "line-color", COLORS.SEGMENT_SELECTED);
        map.setPaintProperty(layerId, "line-width", polylineData.originalStyle.weight + 1);
      } else {
        map.setPaintProperty(layerId, "line-color", polylineData.originalStyle.color);
        map.setPaintProperty(layerId, "line-width", polylineData.originalStyle.weight);
      }
    });

    // Highlight closest segment if found
    if (closestSegment) {
      const layerId = closestSegment.layerId;

      if (!selectedSegments.includes(closestSegment.segmentName)) {
        map.setPaintProperty(layerId, "line-color", COLORS.SEGMENT_HOVER);
        map.setPaintProperty(layerId, "line-width", closestSegment.originalStyle.weight + 2);
      } else {
        map.setPaintProperty(layerId, "line-color", COLORS.SEGMENT_HOVER_SELECTED);
        map.setPaintProperty(layerId, "line-width", closestSegment.originalStyle.weight + 3);
      }

      showSegmentInfoForHover(closestSegment);
    } else {
      hideSegmentInfo();
    }
  }, [selectedSegments, routePolylines]);

  // Show segment information
  const showSegmentInfo = (name, event) => {
    const metrics = segmentMetrics[name];
    const segmentDistanceKm = metrics ? metrics.distanceKm : "0.0";
    const segmentElevationGain = metrics ? metrics.forward.elevationGain : 0;
    const segmentElevationLoss = metrics ? metrics.forward.elevationLoss : 0;

    const segmentDisplay = document.getElementById("segment-name-display");
    if (segmentDisplay) {
      segmentDisplay.innerHTML = `<strong>${name}</strong> <br> 📏 ${segmentDistanceKm} ק"מ • ⬆️ ${segmentElevationGain} מ' • ⬇️ ${segmentElevationLoss} מ'`;
      
      const dataPoints = getSegmentDataPoints(name);
      if (dataPoints.length > 0) {
        let segmentDataHTML = '<div style="margin-top: 5px; font-size: 12px; background-color: white; padding:5px;">';
        dataPoints.forEach((dataPoint) => {
          segmentDataHTML += `<div style="margin: 2px 0; color: ${COLORS.WARNING_ORANGE}; background-color: white; ">${dataPoint.emoji} ${dataPoint.information}</div>`;
        });
        segmentDataHTML += "</div>";
        segmentDisplay.innerHTML += segmentDataHTML;
      }

      segmentDisplay.style.display = "block";
    }
  };

  const showSegmentInfoForHover = (closestSegment) => {
    showSegmentInfo(closestSegment.segmentName, null);
  };

  const hideSegmentInfo = () => {
    const segmentDisplay = document.getElementById("segment-name-display");
    if (segmentDisplay) {
      segmentDisplay.style.display = "none";
    }
  };

  // Handle selected segment hover for distance display
  const handleSelectedSegmentHover = (e, name) => {
    const hoverPoint = e.lngLat;
    const orderedCoords = getOrderedCoordinates();

    if (orderedCoords.length > 0) {
      // Implementation for distance calculation would go here
      // This is a simplified version
      const segmentDisplay = document.getElementById("segment-name-display");
      if (segmentDisplay) {
        segmentDisplay.innerHTML = `📍 מרחק מההתחלה: calculating...`;
        segmentDisplay.style.display = "block";
      }
    }
  };

  // Add point from lng/lat
  const addPointFromLngLat = useCallback((clickPoint) => {
    const map = mapRef.current;
    if (!map) return;

    const clickPixel = map.project(clickPoint);
    const threshold = 15;
    let closestSegment = null;
    let closestPointOnSegment = null;

    if (spatialIndexRef.current) {
      const degreeThreshold = threshold * 0.00005;
      const candidateSegment = spatialIndexRef.current.findNearestSegment(
        clickPoint.lat,
        clickPoint.lng,
        degreeThreshold,
      );

      if (candidateSegment) {
        const coords = candidateSegment.coordinates;
        let minPixelDistance = Infinity;
        let bestSegmentStart = null;
        let bestSegmentEnd = null;

        for (let i = 0; i < coords.length - 1; i++) {
          const startPixel = map.project([coords[i].lng, coords[i].lat]);
          const endPixel = map.project([coords[i + 1].lng, coords[i + 1].lat]);

          const distance = distanceToLineSegmentPixels(
            clickPixel,
            startPixel,
            endPixel,
          );

          if (distance < minPixelDistance) {
            minPixelDistance = distance;
            bestSegmentStart = coords[i];
            bestSegmentEnd = coords[i + 1];
          }
        }

        if (minPixelDistance < threshold && bestSegmentStart && bestSegmentEnd) {
          closestSegment = candidateSegment;
          closestPointOnSegment = getClosestPointOnLineSegment(
            { lat: clickPoint.lat, lng: clickPoint.lng },
            bestSegmentStart,
            bestSegmentEnd,
          );
        }
      }
    }

    if (closestSegment && closestPointOnSegment) {
      addRoutePoint({
        lng: closestPointOnSegment.lng,
        lat: closestPointOnSegment.lat,
      });
    }
  }, []);

  // Add route point
  const addRoutePoint = useCallback((lngLat) => {
    saveState();

    const point = {
      lng: lngLat.lng,
      lat: lngLat.lat,
      id: Date.now() + Math.random(),
    };

    logOperation("addPoint", {
      point: { lat: lngLat.lat, lng: lngLat.lng },
      fromClick: true,
    });

    trackRoutePointEvent([...routePoints, point], selectedSegments, "click");

    const newRoutePoints = [...routePoints, point];
    setRoutePoints(newRoutePoints);

    if (routeManagerRef.current) {
      try {
        const updatedSegments = routeManagerRef.current.addPoint({
          lat: lngLat.lat,
          lng: lngLat.lng,
        });
        setSelectedSegments(updatedSegments);
        updateSegmentStyles(updatedSegments);
      } catch (error) {
        console.error("Error adding route point:", error);
      }
    }

    clearRouteFromUrl();
  }, [routePoints, selectedSegments]);

  // Save state for undo/redo
  const saveState = useCallback(() => {
    setUndoStack(prev => [...prev, {
      segments: [...selectedSegments],
      points: routePoints.map((p) => ({ ...p })),
    }]);
    setRedoStack([]);
    clearRouteFromUrl();
  }, [selectedSegments, routePoints]);

  // Pre-calculate segment metrics
  const preCalculateSegmentMetrics = useCallback((polylines) => {
    const metrics = {};

    polylines.forEach((polylineData) => {
      const coords = polylineData.coordinates;
      const segmentName = polylineData.segmentName;

      let distance = 0;
      for (let i = 0; i < coords.length - 1; i++) {
        distance += getDistance(coords[i], coords[i + 1]);
      }

      const smoothedCoords = smoothElevations(coords, 100);

      let elevationGainForward = 0;
      let elevationLossForward = 0;
      const minElevationChange = 1.0;

      for (let i = 0; i < smoothedCoords.length - 1; i++) {
        const currentElevation = smoothedCoords[i].elevation;
        const nextElevation = smoothedCoords[i + 1].elevation;
        const elevationChange = nextElevation - currentElevation;

        if (Math.abs(elevationChange) >= minElevationChange) {
          if (elevationChange > 0) {
            elevationGainForward += elevationChange;
          } else {
            elevationLossForward += Math.abs(elevationChange);
          }
        }
      }

      metrics[segmentName] = {
        distance: distance,
        distanceKm: (distance / 1000).toFixed(1),
        forward: {
          elevationGain: Math.round(elevationGainForward),
          elevationLoss: Math.round(elevationLossForward),
        },
        reverse: {
          elevationGain: Math.round(elevationLossForward),
          elevationLoss: Math.round(elevationGainForward),
        },
        startPoint: coords[0],
        endPoint: coords[coords.length - 1],
        smoothedCoords: smoothedCoords,
      };
    });

    setSegmentMetrics(metrics);
  }, []);

  // Update segment styles
  const updateSegmentStyles = useCallback((segments = selectedSegments) => {
    const map = mapRef.current;
    if (!map) return;

    routePolylines.forEach((polylineData) => {
      const layerId = polylineData.layerId;
      if (map.getLayer(layerId)) {
        if (segments.includes(polylineData.segmentName)) {
          map.setPaintProperty(layerId, "line-color", COLORS.SEGMENT_SELECTED);
          map.setPaintProperty(layerId, "line-width", polylineData.originalStyle.weight + 1);
        } else {
          map.setPaintProperty(layerId, "line-color", polylineData.originalStyle.color);
          map.setPaintProperty(layerId, "line-width", polylineData.originalStyle.weight);
        }
      }
    });

    if (map.getLayer("data-markers-layer")) {
      const opacityExpression = [
        "case",
        ["in", ["get", "segmentName"], ["literal", segments]],
        1.0,
        0.45,
      ];

      map.setPaintProperty("data-markers-layer", "icon-opacity", opacityExpression);
    }
  }, [routePolylines, selectedSegments]);

  // Initialize data markers
  const initDataMarkers = async () => {
    const map = mapRef.current;
    if (!map || !segmentsData) return;

    // Load custom icons and setup markers
    // This would contain the data markers implementation
    console.log("Initializing data markers...");
  };

  // Utility functions
  const getClosestPointOnLineSegment = (point, lineStart, lineEnd) => {
    const A = point.lng - lineStart.lng;
    const B = point.lat - lineStart.lat;
    const C = lineEnd.lng - lineStart.lng;
    const D = lineEnd.lat - lineStart.lat;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) {
      param = dot / lenSq;
    }

    let xx, yy;
    if (param < 0) {
      xx = lineStart.lng;
      yy = lineStart.lat;
    } else if (param > 1) {
      xx = lineEnd.lng;
      yy = lineEnd.lat;
    } else {
      xx = lineStart.lng + param * C;
      yy = lineStart.lat + param * D;
    }

    return { lat: yy, lng: xx };
  };

  const getSegmentDataPoints = (segmentName) => {
    const segmentInfo = segmentsData?.[segmentName];
    if (!segmentInfo || !segmentInfo.data || !Array.isArray(segmentInfo.data)) {
      return [];
    }

    const MARKER_EMOJIS = {
      payment: "💵",
      gate: "🚧",
      mud: "⚠️",
      warning: "⚠️",
      slope: "⛰️",
      narrow: "⛍",
      severe: "‼️",
    };

    return segmentInfo.data.map((dataPoint) => ({
      type: dataPoint.type,
      information: dataPoint.information || "",
      emoji: MARKER_EMOJIS[dataPoint.type] || "📍",
    }));
  };

  const getOrderedCoordinates = () => {
    // Implementation for getting ordered coordinates
    return [];
  };

  const getRouteParameter = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get("route");
  };

  const loadRouteFromUrl = () => {
    const routeParam = getRouteParameter();
    if (routeParam && segmentsData) {
      const decodedSegments = decodeRoute(routeParam, segmentsData);
      if (decodedSegments.length > 0) {
        trackRouteOperation("load_from_url", [], decodedSegments, {
          route_param_length: routeParam.length
        });

        setSelectedSegments(decodedSegments);
        setTimeout(() => {
          updateSegmentStyles(decodedSegments);
        }, 500);
      }
    }
  };

  const clearRouteFromUrl = () => {
    const url = new URL(window.location);
    if (url.searchParams.has("route")) {
      url.searchParams.delete("route");
      window.history.replaceState({}, document.title, url.toString());
    }
  };

  const logOperation = (type, data) => {
    const currentState = {
      pointsCount: routePoints.length,
      segmentsCount: selectedSegments.length,
      selectedSegments: [...selectedSegments],
    };

    setOperationsLog(prev => [...prev, {
      timestamp: Date.now(),
      type: type,
      data: data,
      routeState: currentState,
    }]);
  };

  // Event handlers for header actions
  const handleUndo = () => {
    if (undoStack.length > 0) {
      trackUndoRedoEvent("undo", undoStack, redoStack, routePoints, selectedSegments);

      setRedoStack(prev => [...prev, {
        segments: [...selectedSegments],
        points: routePoints.map((p) => ({ ...p })),
      }]);

      const previousState = undoStack[undoStack.length - 1];
      setUndoStack(prev => prev.slice(0, -1));

      setRoutePoints(previousState.points.map((p) => ({ ...p })));
      setSelectedSegments([...previousState.segments]);

      updateSegmentStyles(previousState.segments);
      clearRouteFromUrl();
    }
  };

  const handleRedo = () => {
    if (redoStack.length > 0) {
      trackUndoRedoEvent("redo", undoStack, redoStack, routePoints, selectedSegments);

      setUndoStack(prev => [...prev, {
        segments: [...selectedSegments],
        points: routePoints.map((p) => ({ ...p })),
      }]);

      const nextState = redoStack[redoStack.length - 1];
      setRedoStack(prev => prev.slice(0, -1));

      setRoutePoints(nextState.points.map((p) => ({ ...p })));
      setSelectedSegments([...nextState.segments]);

      updateSegmentStyles(nextState.segments);
      clearRouteFromUrl();
    }
  };

  const handleReset = () => {
    if (selectedSegments.length > 0 || routePoints.length > 0) {
      saveState();
    }

    logOperation("reset", {
      clearedPointsCount: routePoints.length,
      clearedSegmentsCount: selectedSegments.length,
    });

    trackRouteOperation("reset", routePoints, selectedSegments, {
      cleared_points: routePoints.length,
      cleared_segments: selectedSegments.length
    });

    if (routeManagerRef.current) {
      routeManagerRef.current.clearRoute();
    }

    setSelectedSegments([]);
    setRoutePoints([]);
    setUndoStack([]);
    setRedoStack([]);

    updateSegmentStyles([]);
    clearRouteFromUrl();
  };

  const handleSearch = (query) => {
    trackSearchEvent(query, routePoints, selectedSegments);
    // Implementation for search functionality
    console.log("Searching for:", query);
  };

  const handleDownloadGPX = () => {
    if (selectedSegments.length === 0) return;

    trackRouteOperation("download", routePoints, selectedSegments, {
      distance: calculateTotalDistance()
    });

    const orderedCoords = getOrderedCoordinates();
    const gpx = generateGPX(orderedCoords);
    const routeEncoding = encodeRoute(getSegmentIds(selectedSegments));
    const filename = routeEncoding
      ? `route_${routeEncoding.substring(0, 32)}.gpx`
      : "bike_route.gpx";

    executeDownloadGPX(gpx, filename);
  };

  const getSegmentIds = (segmentNames) => {
    return segmentNames
      .map((name) => {
        const segmentInfo = segmentsData?.[name];
        return segmentInfo ? segmentInfo.id : 0;
      })
      .filter((id) => id > 0);
  };

  const calculateTotalDistance = () => {
    let totalDistance = 0;
    selectedSegments.forEach((segmentName) => {
      const metrics = segmentMetrics[segmentName];
      if (metrics) {
        totalDistance += metrics.distance;
      }
    });
    return totalDistance;
  };

  const focusOnSegment = (segmentName) => {
    trackSegmentFocus(segmentName, "recommendation_click");
    console.log("Focusing on segment:", segmentName);
  };

  return (
    <div className="App">
      <Header 
        onSearch={handleSearch}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onReset={handleReset}
        onDownloadGPX={handleDownloadGPX}
        undoDisabled={undoStack.length === 0}
        redoDisabled={redoStack.length === 0}
        resetDisabled={selectedSegments.length === 0 && routePoints.length === 0}
        downloadDisabled={selectedSegments.length === 0}
      />
      
      <div className="main-container">
        <div id="error-message"></div>
        
        <MapContainer 
          selectedSegments={selectedSegments}
          routePoints={routePoints}
          segmentMetrics={segmentMetrics}
        />
        
        <ContentSections 
          onFocusSegment={focusOnSegment}
        />
      </div>
      
      <Footer />
    </div>
  );
}

export default App;
