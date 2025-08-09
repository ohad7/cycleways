let map;
let selectedSegments = [];
let routePolylines = [];
let undoStack = [];
let redoStack = [];
let kmlData = null;
let segmentsData = null;
let segmentMetrics = {}; // Pre-calculated distance, elevation, and directionality data
let routePoints = []; // Array of points that define the route
let pointMarkers = []; // Array of map markers for the points
let isDraggingPoint = false;
let draggedPointIndex = -1;
let routeManager = null; // Instance of RouteManager
let operationsLog = []; // Log of user operations for export
let spatialIndex = null; // Spatial index for efficient segment lookup

const COLORS = {
  WARNING_ORANGE: "#ff9800",
  WARNING_RED: "#f44336",
  SEGMENT_SELECTED: "#006699", // Green for selected segments
  SEGMENT_HOVER: "#666633", // Orange for hovered segments
  SEGMENT_HOVER_SELECTED: "#003399", // Brighter green when hovering over a selected segment
  SEGMENT_SIDEBAR_HOVER: "#666633", // Brown when hovering a segment in the sidebar
  ELEVATION_MARKER: "#ff4444", // Red for the elevation marker
  HIGHLIGHT_WHITE: "#ffffff", // White for highlighting all segments
};



const MIN_ZOOM_LEVEL = 13; // Minimum zoom level when focusing on segments

// Function to highlight all segments in white and then return to original colors
function highlightAllSegments() {
  // First phase: highlight all segments in white
  routePolylines.forEach((polylineData) => {
    const layerId = polylineData.layerId;
    if (map.getLayer(layerId)) {
      map.setPaintProperty(layerId, "line-color", COLORS.HIGHLIGHT_WHITE);
      map.setPaintProperty(
        layerId,
        "line-width",
        polylineData.originalStyle.weight + 2,
      );
    }
  });

  // Second phase: return to original colors after 800ms
  setTimeout(() => {
    routePolylines.forEach((polylineData) => {
      const layerId = polylineData.layerId;
      if (map.getLayer(layerId)) {
        if (selectedSegments.includes(polylineData.segmentName)) {
          // Return selected segments to green
          map.setPaintProperty(layerId, "line-color", COLORS.SEGMENT_SELECTED);
          map.setPaintProperty(
            layerId,
            "line-width",
            polylineData.originalStyle.weight + 1,
          );
        } else {
          // Return non-selected segments to original style
          map.setPaintProperty(
            layerId,
            "line-color",
            polylineData.originalStyle.color,
          );
          map.setPaintProperty(
            layerId,
            "line-width",
            polylineData.originalStyle.weight,
          );
        }
      }
    });
  }, 800);
}

// Save state for undo/redo
function saveState() {
  undoStack.push({
    segments: [...selectedSegments],
    points: routePoints.map((p) => ({ ...p })), // Deep copy of points
  });
  redoStack = []; // Clear redo stack when new action is performed
  updateUndoRedoButtons();
  clearRouteFromUrl(); // Clear route parameter when making changes
}

// Add a new route point
function addRoutePoint(lngLat, fromClick = true) {
  if (fromClick) {
    saveState();
  }

  const point = {
    lng: lngLat.lng,
    lat: lngLat.lat,
    id: Date.now() + Math.random(),
  };

  // Log the operation before making changes
  if (fromClick) {
    logOperation("addPoint", {
      point: { lat: lngLat.lat, lng: lngLat.lng },
      fromClick: fromClick,
    });
  }

  // Add to local routePoints first
  routePoints.push(point);

  // Use RouteManager to add the point and get updated segments
  if (routeManager) {
    try {
      const updatedSegments = routeManager.addPoint({ lat: lngLat.lat, lng: lngLat.lng });
      selectedSegments = updatedSegments;

      // Create marker for the new point
      createPointMarker(point, routePoints.length - 1);

      updateSegmentStyles();
      updateRouteListAndDescription();
    } catch (error) {
      console.error("Error adding route point:", error);
      // Fallback to old method
      createPointMarker(point, routePoints.length - 1);
      recalculateRoute();
    }
  } else {
    // Fallback to old method if RouteManager not available
    createPointMarker(point, routePoints.length - 1);
    recalculateRoute();
  }

  clearRouteFromUrl();
}

// Create a map-integrated point feature for a route point
function createPointMarker(point, index) {
  const pointId = `route-point-${point.id}`;

  // Create GeoJSON point feature
  const pointFeature = {
    type: "Feature",
    id: pointId,
    geometry: {
      type: "Point",
      coordinates: [point.lng, point.lat],
    },
    properties: {
      index: index,
      pointId: point.id,
      type: "route-point",
    },
  };

  // Add or update the source for route points
  if (!map.getSource("route-points")) {
    map.addSource("route-points", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [],
      },
    });

    // Add circle layer for points
    map.addLayer({
      id: "route-points-circle",
      type: "circle",
      source: "route-points",
      paint: {
        "circle-radius": 4,
        "circle-color": "#ff4444",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });

    // Add drag functionality
    let isDragging = false;
    let draggedFeature = null;

    map.on("mousedown", "route-points-circle", (e) => {
      if (e.features.length === 0) return;

      e.preventDefault();
      isDragging = true;
      isDraggingPoint = true;
      draggedFeature = { ...e.features[0] }; // Create a copy
      draggedPointIndex = draggedFeature.properties.index;

      map.getCanvas().style.cursor = "grabbing";
      map.dragPan.disable();
      document.body.style.userSelect = "none";
    });

    map.on("mousemove", (e) => {
      if (!isDragging || !draggedFeature || draggedPointIndex === -1) return;

      const coords = [e.lngLat.lng, e.lngLat.lat];

      // Update route point data
      if (routePoints[draggedPointIndex]) {
        routePoints[draggedPointIndex].lng = e.lngLat.lng;
        routePoints[draggedPointIndex].lat = e.lngLat.lat;
      }

      // Update the source data by recreating all features
      const features = routePoints.map((point, idx) => ({
        type: "Feature",
        id: `route-point-${point.id}`,
        geometry: {
          type: "Point",
          coordinates: [point.lng, point.lat],
        },
        properties: {
          index: idx,
          pointId: point.id,
          type: "route-point",
        },
      }));

      map.getSource("route-points").setData({
        type: "FeatureCollection",
        features: features,
      });

      // Update dragging logic to use RouteManager's recalculateRoute method
      if (routeManager) {
        try {
          const updatedSegments = routeManager.recalculateRoute(routePoints);
          selectedSegments = updatedSegments;
          updateSegmentStyles();
          updateRouteListAndDescription();
        } catch (error) {
          console.error("Error updating route during drag:", error);
          // Fallback to old method if RouteManager fails
          recalculateRoute();
        }
      } else {
        recalculateRoute();
      }
    });

    map.on("mouseup", () => {
      if (!isDragging) return;

      isDragging = false;
      isDraggingPoint = false;

      // Validate that the dragged point is still close enough to a segment
      if (draggedPointIndex !== -1 && routePoints[draggedPointIndex]) {
        const draggedPoint = routePoints[draggedPointIndex];
        const snappedPoint = findClosestSegment(draggedPoint);

        if (!snappedPoint) {
          // No segment close enough - remove this point
          console.log("Dragged point too far from segments, removing point");
          removeRoutePoint(draggedPointIndex);
        }
      }

      draggedPointIndex = -1;
      draggedFeature = null;

      map.getCanvas().style.cursor = "";
      map.dragPan.enable();
      document.body.style.userSelect = "";

      saveState();
      clearRouteFromUrl();
    });

    // Touch events for mobile
    map.on("touchstart", "route-points-circle", (e) => {
      if (e.points.length !== 1 || e.features.length === 0) return;

      e.preventDefault();
      isDragging = true;
      isDraggingPoint = true;
      draggedFeature = { ...e.features[0] }; // Create a copy
      draggedPointIndex = draggedFeature.properties.index;

      map.dragPan.disable();
    });

    map.on("touchmove", (e) => {
      if (!isDragging || !draggedFeature || draggedPointIndex === -1) return;
      e.preventDefault();

      // Update route point data
      if (routePoints[draggedPointIndex]) {
        routePoints[draggedPointIndex].lng = e.lngLat.lng;
        routePoints[draggedPointIndex].lat = e.lngLat.lat;
      }

      // Update the source data by recreating all features
      const features = routePoints.map((point, idx) => ({
        type: "Feature",
        id: `route-point-${point.id}`,
        geometry: {
          type: "Point",
          coordinates: [point.lng, point.lat],
        },
        properties: {
          index: idx,
          pointId: point.id,
          type: "route-point",
        },
      }));

      map.getSource("route-points").setData({
        type: "FeatureCollection",
        features: features,
      });

      // Update touch dragging logic to use RouteManager's recalculateRoute method
      if (routeManager) {
        try {
          const updatedSegments = routeManager.recalculateRoute(routePoints);
          selectedSegments = updatedSegments;
          updateSegmentStyles();
          updateRouteListAndDescription();
        } catch (error) {
          console.error("Error updating route during drag:", error);
          // Fallback to old method if RouteManager fails
          recalculateRoute();
        }
      } else {
        recalculateRoute();
      }
    });

    map.on("touchend", () => {
      if (!isDragging) return;

      isDragging = false;
      isDraggingPoint = false;

      // Validate that the dragged point is still close enough to a segment
      if (draggedPointIndex !== -1 && routePoints[draggedPointIndex]) {
        const draggedPoint = routePoints[draggedPointIndex];
        const snappedPoint = findClosestSegment(draggedPoint);

        if (!snappedPoint) {
          // No segment close enough - remove this point
          console.log("Dragged point too far from segments, removing point");
          removeRoutePoint(draggedPointIndex);
        }
      }

      draggedPointIndex = -1;
      draggedFeature = null;

      map.dragPan.enable();

      saveState();
      clearRouteFromUrl();
    });

    // Right-click to remove point
    map.on("contextmenu", "route-points-circle", (e) => {
      e.preventDefault();
      const feature = e.features[0];
      if (feature) {
        removeRoutePoint(feature.properties.index);
      }
    });

    // Hover effects
    map.on("mouseenter", "route-points-circle", () => {
      map.getCanvas().style.cursor = "grab";
    });

    map.on("mouseleave", "route-points-circle", () => {
      if (!isDragging) {
        map.getCanvas().style.cursor = "";
      }
    });
  }

  // Update the source data with the new point
  const source = map.getSource("route-points");
  const currentData = source._data;

  // Remove any existing point with the same index
  currentData.features = currentData.features.filter(
    (f) => f.properties.index !== index,
  );

  // Add the new point
  currentData.features.push(pointFeature);

  // Update indices for all points
  currentData.features.forEach((feature, idx) => {
    feature.properties.index = idx;
  });

  source.setData(currentData);

  // Store reference for compatibility
  pointMarkers[index] = { pointId: pointId };
}

// Remove a route point
function removeRoutePoint(index) {
  if (index < 0 || index >= routePoints.length) return;

  saveState();

  // Log the operation before making changes
  logOperation("removePoint", {
    index: index,
    point: routePoints[index]
      ? { lat: routePoints[index].lat, lng: routePoints[index].lng }
      : null,
  });

  if (!routeManager) {
    console.warn("RouteManager not initialized");
    // Fallback to old logic if RouteManager is not available
    // Remove the marker safely
    try {
      if (pointMarkers[index] && pointMarkers[index].remove) {
        pointMarkers[index].remove();
      }
    } catch (error) {
      console.warn("Error removing marker:", error);
    }

    // Remove from arrays
    routePoints.splice(index, 1);
    pointMarkers.splice(index, 1);

    // Update remaining markers with correct numbering
    updatePointMarkers();
    recalculateRoute();
    clearRouteFromUrl();
    return;
  }

  try {
    // Use RouteManager to remove point and get updated segments
    const updatedSegments = routeManager.removePoint(index);
    selectedSegments = updatedSegments;

    // Remove from local arrays
    routePoints.splice(index, 1);
    pointMarkers.splice(index, 1);

    // Update map-integrated points safely
    try {
      if (map.getSource("route-points")) {
        const features = routePoints.map((point, idx) => ({
          type: "Feature",
          id: `route-point-${point.id}`,
          geometry: {
            type: "Point",
            coordinates: [point.lng, point.lat],
          },
          properties: {
            index: idx,
            pointId: point.id,
            type: "route-point",
          },
        }));

        map.getSource("route-points").setData({
          type: "FeatureCollection",
          features: features,
        });
      }
    } catch (domError) {
      console.warn("Error updating map points:", domError);
    }

    // Update UI
    updateSegmentStyles();
    updateRouteListAndDescription();
    clearRouteFromUrl();
  } catch (error) {
    console.error("Error removing route point:", error);

    // Fallback: remove point locally and recalculate route manually
    routePoints.splice(index, 1);
    pointMarkers.splice(index, 1);

    // Update map-integrated points safely
    try {
      if (map.getSource("route-points")) {
        const features = routePoints.map((point, idx) => ({
          type: "Feature",
          id: `route-point-${point.id}`,
          geometry: {
            type: "Point",
            coordinates: [point.lng, point.lat],
          },
          properties: {
            index: idx,
            pointId: point.id,
            type: "route-point",
          },
        }));

        map.getSource("route-points").setData({
          type: "FeatureCollection",
          features: features,
        });
      }
    } catch (domError) {
      console.warn("Error updating map points in fallback:", domError);
    }

    // Manually recalculate route using existing logic
    recalculateRoute();
    clearRouteFromUrl();
  }
}

// Update all point markers with correct numbering
function updatePointMarkers() {
  // With custom drag implementation, markers stay in sync automatically
  // This function is kept for compatibility but no longer needs to force positioning
}

// Clear all route points
function clearRoutePoints() {
  // Clear map-integrated points
  if (map.getSource("route-points")) {
    map.getSource("route-points").setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  pointMarkers = [];
  routePoints = [];
}

// Find the closest segment to a point
function findClosestSegment(point) {
  if (!routeManager) {
    console.warn("RouteManager not initialized, cannot find closest segment.");
    return null;
  }
  return routeManager.findClosestSegment(point);
}

// Recalculate the route based on current points
function recalculateRoute() {
  if (routePoints.length === 0) {
    selectedSegments = [];
    updateSegmentStyles();
    updateRouteListAndDescription();
    return;
  }

  if (!routeManager) {
    console.warn("RouteManager not initialized, cannot recalculate route.");
    return;
  }

  try {
    // Use RouteManager to calculate route through points
    const routeInfo = routeManager.getRouteInfo();

    // Find path through all route points
    if (routePoints.length === 1) {
      // Single point - find closest segment
      const closestSegment = findClosestSegment(routePoints[0]);
      if (closestSegment) {
        selectedSegments = [closestSegment];
      }
    } else {
      // Multiple points - find optimal path
      const pathSegments = [];
      const usedSegments = new Set();

      for (let i = 0; i < routePoints.length - 1; i++) {
        const startPoint = routePoints[i];
        const endPoint = routePoints[i + 1];

        const segmentPath = findPathBetweenPoints(startPoint, endPoint);

        // Add segments to path, avoiding duplicates
        for (const segmentName of segmentPath) {
          if (
            pathSegments.length === 0 ||
            pathSegments[pathSegments.length - 1] !== segmentName
          ) {
            pathSegments.push(segmentName);
          }
        }
      }

      selectedSegments = pathSegments;
    }

    updateSegmentStyles();
    updateRouteListAndDescription();
  } catch (error) {
    console.error("Error recalculating route:", error);
  }
}

// Find path between two points using breadth-first search on connected segments
function findPathBetweenPoints(startPoint, endPoint) {
  if (!routeManager) {
    console.warn(
      "RouteManager not initialized, cannot find path between points.",
    );
    return [];
  }
  return routeManager.findPathBetweenPoints(startPoint, endPoint);
}

// Enhanced pathfinding that considers used segments and tries to minimize backtracking
function findPathBetweenPointsOptimal(
  startPoint,
  endPoint,
  usedSegments = new Set(),
) {
  if (!routeManager) {
    console.warn(
      "RouteManager not initialized, cannot find optimal path between points.",
    );
    return [];
  }
  return routeManager.findPathBetweenPointsOptimal(
    startPoint,
    endPoint,
    usedSegments,
  );
}

// Find shortest path between two segments using BFS
function findShortestSegmentPath(startSegmentName, endSegmentName) {
  if (!routeManager) {
    console.warn(
      "RouteManager not initialized, cannot find shortest segment path.",
    );
    return [];
  }
  return routeManager.findShortestSegmentPath(startSegmentName, endSegmentName);
}

// Enhanced pathfinding that considers already used segments and prefers unused routes
function findShortestSegmentPathOptimal(
  startSegmentName,
  endSegmentName,
  usedSegments = new Set(),
) {
  if (!routeManager) {
    console.warn(
      "RouteManager not initialized, cannot find optimal shortest segment path.",
    );
    return [];
  }
  return routeManager.findShortestSegmentPathOptimal(
    startSegmentName,
    endSegmentName,
    usedSegments,
  );
}

// Helper function to check continuity of a list of segments
function checkSegmentsContinuity(segments) {
  if (!routeManager) {
    console.warn(
      "RouteManager not initialized, cannot check segment continuity.",
    );
    return { isContinuous: true, brokenSegmentIndex: -1 };
  }
  return routeManager.checkSegmentsContinuity(segments);
}

function clearRouteFromUrl() {
  const url = new URL(window.location);
  if (url.searchParams.has("route")) {
    url.searchParams.delete("route");
    window.history.replaceState({}, document.title, url.toString());
  }
}

function undo() {
  if (undoStack.length > 0) {
    // Save current state to redo stack
    redoStack.push({
      segments: [...selectedSegments],
      points: routePoints.map((p) => ({ ...p })),
    });

    // Restore previous state
    const previousState = undoStack.pop();

    // Clear and restore points
    clearRoutePoints();
    routePoints = previousState.points.map((p) => ({ ...p }));
    routePoints.forEach((point, index) => {
      createPointMarker(point, index);
    });

    // Use RouteManager's public method to restore state
    if (routeManager) {
      try {
        const restoredSegments = routeManager.restoreFromPoints(routePoints);
        selectedSegments = restoredSegments;

        // If restoration failed, fallback to the saved segments
        if (selectedSegments.length === 0 && previousState.segments.length > 0) {
          console.warn("RouteManager restoration failed, using saved segments");
          selectedSegments = [...previousState.segments];
          // Update RouteManager's internal state to match
          routeManager.updateInternalState(routePoints, selectedSegments);
        }
      } catch (error) {
        console.error("Error during undo restoration:", error);
        // Fallback to saved segments
        selectedSegments = [...previousState.segments];
        if (routeManager) {
          routeManager.updateInternalState(routePoints, selectedSegments);
        }
      }
    } else {
      selectedSegments = [...previousState.segments];
    }

    updateSegmentStyles();
    updateRouteListAndDescription();
    updateUndoRedoButtons();
    clearRouteFromUrl(); // Clear route parameter on undo
  }
}

function redo() {
  if (redoStack.length > 0) {
    // Save current state to undo stack
    undoStack.push({
      segments: [...selectedSegments],
      points: routePoints.map((p) => ({ ...p })),
    });

    // Restore next state
    const nextState = redoStack.pop();

    // Clear and restore points
    clearRoutePoints();
    routePoints = nextState.points.map((p) => ({ ...p }));
    routePoints.forEach((point, index) => {
      createPointMarker(point, index);
    });

    // Use RouteManager's public method to restore state
    if (routeManager) {
      selectedSegments = routeManager.restoreFromPoints(routePoints);
    } else {
      selectedSegments = [...nextState.segments];
    }

    // Update RouteManager's internal state to match
    if (routeManager) {
      routeManager.updateInternalState(routePoints, selectedSegments);
    }

    updateSegmentStyles();
    updateRouteListAndDescription();
    updateUndoRedoButtons();
    clearRouteFromUrl(); // Clear route parameter on redo
  }
}

function updateUndoRedoButtons() {
  document.getElementById("undo-btn").disabled = undoStack.length === 0;
  document.getElementById("redo-btn").disabled = redoStack.length === 0;
  document.getElementById("reset-btn").disabled =
    selectedSegments.length === 0 && routePoints.length === 0;
}

// Function to log user operations for export
function logOperation(type, data) {
  // Get current route state before the operation
  const currentState = {
    pointsCount: routePoints.length,
    segmentsCount: selectedSegments.length,
    selectedSegments: [...selectedSegments],
    segmentIds: selectedSegments
      .map((name) => {
        const segmentInfo = segmentsData[name];
        return segmentInfo ? segmentInfo.id : 0;
      })
      .filter((id) => id > 0),
  };

  operationsLog.push({
    timestamp: Date.now(),
    type: type,
    data: data,
    routeState: currentState,
  });

  console.log("Logged operation:", operationsLog[operationsLog.length - 1]);
}

// Function to export operations as JSON
function exportOperationsJSON() {
  // Get final route state
  const finalSegmentIds = selectedSegments
    .map((name) => {
      const segmentInfo = segmentsData[name];
      return segmentInfo ? segmentInfo.id : 0;
    })
    .filter((id) => id > 0);

  // Create export object
  const exportData = {
    name: `User Test Case - ${new Date()
      .toLocaleString("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
      .replace(/[/:]/g, "-")
      .replace(", ", " ")}`,
    description: `Test case generated from user operations (${operationsLog.length} operations)`,
    geoJsonFile: "bike_roads_v12.geojson",
    segmentsFile: "segments.json",
    operations: operationsLog.map((op) => ({
      type: op.type,
      data: op.data,
      expectedSegmentIds: op.routeState.segmentIds,
      expectedSegmentsCount: op.routeState.segmentsCount,
    })),
    summary: {
      totalOperations: operationsLog.length,
      operationTypes: [...new Set(operationsLog.map((op) => op.type))],
      finalSegmentIds: finalSegmentIds,
      finalSegmentsCount: selectedSegments.length,
    },
  };

  console.log("Exported test case:", exportData);
  return exportData;
}

// Function to show export modal
function showExportModal() {
  const exportData = exportOperationsJSON();
  const jsonString = JSON.stringify(exportData, null, 2);

  // Create modal elements
  const modal = document.createElement("div");
  modal.className = "export-modal";
  modal.innerHTML = `
    <div class="export-modal-content">
      <div class="export-modal-header">
        <h3>📋 Export Operations JSON</h3>
        <button class="export-modal-close">&times;</button>
      </div>
      <div class="export-modal-body">
        <p>Operations exported: <strong>${exportData.operations.length}</strong></p>
        <p>Final segments: <strong>${exportData.summary.finalSegmentsCount}</strong></p>
        <div class="json-container">
          <textarea class="json-textarea" readonly>${jsonString}</textarea>
        </div>
        <div class="export-modal-actions">
          <button id="copy-json-btn" class="copy-json-btn">📄 Copy JSON</button>
          <button id="clear-operations-btn" class="clear-operations-btn">🗑️ Clear Log</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add event listeners
  const closeBtn = modal.querySelector(".export-modal-close");
  const copyBtn = modal.querySelector("#copy-json-btn");
  const clearBtn = modal.querySelector("#clear-operations-btn");
  const textarea = modal.querySelector(".json-textarea");

  closeBtn.addEventListener("click", () => {
    document.body.removeChild(modal);
  });

  copyBtn.addEventListener("click", () => {
    textarea.select();
    navigator.clipboard
      .writeText(jsonString)
      .then(() => {
        copyBtn.textContent = "✅ Copied!";
        copyBtn.style.background = "#4CAF50";
        setTimeout(() => {
          copyBtn.textContent = "📄 Copy JSON";
          copyBtn.style.background = "#4682B4";
        }, 2000);
      })
      .catch(() => {
        document.execCommand("copy");
        copyBtn.textContent = "✅ Copied!";
        copyBtn.style.background = "#4CAF50";
        setTimeout(() => {
          copyBtn.textContent = "📄 Copy JSON";
          copyBtn.style.background = "#4682B4";
        }, 2000);
      });
  });

  clearBtn.addEventListener("click", () => {
    operationsLog = [];
    document.body.removeChild(modal);
    alert("Operations log cleared!");
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  // Add escape key listener
  const handleEscape = (e) => {
    if (e.key === "Escape") {
      document.body.removeChild(modal);
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);
}

function resetRoute() {
  // Log the reset operation
  logOperation("reset", {
    clearedPointsCount: routePoints.length,
    clearedSegmentsCount: selectedSegments.length,
  });

  // Save current state for potential undo
  if (selectedSegments.length > 0 || routePoints.length > 0) {
    saveState();
  }

  // Clear RouteManager state first
  if (routeManager) {
    routeManager.clearRoute();
  }

  // Clear selected segments and points
  selectedSegments = [];
  clearRoutePoints();

  // Clear undo/redo stacks
  undoStack = [];
  redoStack = [];

  // Reset all segment styles to original
  routePolylines.forEach((polylineData) => {
    const layerId = polylineData.layerId;
    map.setPaintProperty(
      layerId,
      "line-color",
      polylineData.originalStyle.color,
    );
    map.setPaintProperty(
      layerId,
      "line-width",
      polylineData.originalStyle.weight,
    );
  });

  // Remove any existing markers
  if (window.hoverMarker) {
    window.hoverMarker.remove();
    window.hoverMarker = null;
  }

  if (window.elevationMarker) {
    window.elevationMarker.remove();
    window.elevationMarker = null;
  }

  // Hide segment name display
  const segmentDisplay = document.getElementById("segment-name-display");
  segmentDisplay.style.display = "none";

  // Update UI
  updateRouteListAndDescription();
  updateUndoRedoButtons();
  clearRouteFromUrl(); // Clear route parameter when resetting
}

function updateSegmentStyles() {
  routePolylines.forEach((polylineData) => {
    const layerId = polylineData.layerId;
    // Check if layer exists before trying to set properties
    if (map.getLayer(layerId)) {
      if (selectedSegments.includes(polylineData.segmentName)) {
        map.setPaintProperty(layerId, "line-color", COLORS.SEGMENT_SELECTED);
        map.setPaintProperty(
          layerId,
          "line-width",
          polylineData.originalStyle.weight + 1,
        );
      } else {
        map.setPaintProperty(
          layerId,
          "line-color",
          polylineData.originalStyle.color,
        );
        map.setPaintProperty(
          layerId,
          "line-width",
          polylineData.originalStyle.weight,
        );
      }
    }
  });
}

function initMap() {
  try {
    mapboxgl.accessToken =
      "pk.eyJ1Ijoib3NlcmZhdHkiLCJhIjoiY21kNmdzb3NnMDlqZTJrc2NzNmh3aGk1aCJ9.dvA6QY0N5pQ2IISZHp53kg";

    map = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: [35.617497, 33.183536], // Centered on the bike routes area
      zoom: 11.5,
    });

    // Set Hebrew language after map loads
    map.on("load", () => {
      // Try to set Hebrew labels, but handle errors gracefully
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
      loadKMLFile();
    });

    // Add global mouse move handler for proximity-based highlighting
    map.on("mousemove", (e) => {
      const mousePoint = e.lngLat;
      const mousePixel = map.project(mousePoint);
      const threshold = 15; // pixels
      let closestSegment = null;

      // Use spatial index for efficient segment lookup
      if (spatialIndex) {
        // Convert pixel threshold to approximate degree threshold
        const degreeThreshold = threshold * 0.00005; // Rough conversion
        const candidateSegment = spatialIndex.findNearestSegment(
          mousePoint.lat, 
          mousePoint.lng, 
          degreeThreshold
        );

        // Verify the candidate with precise pixel distance if found
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

      // Reset all segments to normal style first
      routePolylines.forEach((polylineData) => {
        const layerId = polylineData.layerId;
        if (selectedSegments.includes(polylineData.segmentName)) {
          // Keep selected segments green
          map.setPaintProperty(layerId, "line-color", COLORS.SEGMENT_SELECTED);
          map.setPaintProperty(
            layerId,
            "line-width",
            polylineData.originalStyle.weight + 1,
          );
        } else {
          // Reset non-selected segments to original style
          map.setPaintProperty(
            layerId,
            "line-color",
            polylineData.originalStyle.color,
          );
          map.setPaintProperty(
            layerId,
            "line-width",
            polylineData.originalStyle.weight,
          );
        }
      });

      // Highlight closest segment if found
      if (closestSegment) {
        const layerId = closestSegment.layerId;
        map.getCanvas().style.cursor = "pointer";

        if (!selectedSegments.includes(closestSegment.segmentName)) {
          // Highlight non-selected segment
          map.setPaintProperty(layerId, "line-color", COLORS.SEGMENT_HOVER);
          map.setPaintProperty(
            layerId,
            "line-width",
            closestSegment.originalStyle.weight + 2,
          );
        } else {
          // Make selected segment more prominent
          map.setPaintProperty(
            layerId,
            "line-color",
            COLORS.SEGMENT_HOVER_SELECTED,
          );
          map.setPaintProperty(
            layerId,
            "line-width",
            closestSegment.originalStyle.weight + 3,
          );
        }

        // Show segment info using pre-calculated data
        const name = closestSegment.segmentName;
        const metrics = segmentMetrics[name];
        const segmentDistanceKm = metrics ? metrics.distanceKm : "0.0";
        const segmentElevationGain = metrics
          ? metrics.forward.elevationGain
          : 0;
        const segmentElevationLoss = metrics
          ? metrics.forward.elevationLoss
          : 0;

        const segmentDisplay = document.getElementById("segment-name-display");
        segmentDisplay.innerHTML = `<strong>${name}</strong> <br> 📏 ${segmentDistanceKm} ק"מ • ⬆️ ${segmentElevationGain} מ' • ⬇️ ${segmentElevationLoss} מ'`;

        // Check for warnings in segments data and add to segment display
        const segmentInfo = segmentsData[name];
        if (segmentInfo) {
          if (segmentInfo.winter === false) {
            segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_ORANGE}; font-size: 12px; margin-top: 5px;">❄️  בוץ בחורף</div>`;
          }
          if (segmentInfo.warning) {
            segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_RED}; font-size: 12px; margin-top: 5px;">⚠️ ${segmentInfo.warning}</div>`;
          }
        }

        segmentDisplay.style.display = "block";
      } else {
        // No segment close enough - reset cursor and hide display
        map.getCanvas().style.cursor = "";
        const segmentDisplay = document.getElementById("segment-name-display");
        segmentDisplay.style.display = "none";
      }
    });

    // Add global click handler for adding route points
    map.on("click", (e) => {
      // Don't add points if we're dragging a point
      if (isDraggingPoint) {
        return;
      }

      const clickPoint = e.lngLat;
      const clickPixel = map.project(clickPoint);
      const threshold = 15; // Use same threshold as hover logic

      // Use spatial index for efficient segment lookup
      let closestSegment = null;
      let closestPointOnSegment = null;

      if (spatialIndex) {
        // Convert pixel threshold to approximate degree threshold
        const degreeThreshold = threshold * 0.00005; // Rough conversion
        const candidateSegment = spatialIndex.findNearestSegment(
          clickPoint.lat, 
          clickPoint.lng, 
          degreeThreshold
        );

        // Verify the candidate with precise pixel distance if found
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

      // Only add point if close enough to a segment and snap it to the segment
      if (closestSegment && closestPointOnSegment) {
        addRoutePoint({
          lng: closestPointOnSegment.lng,
          lat: closestPointOnSegment.lat,
        });
      }
    });

    // Map move handlers are no longer needed with custom drag implementation

    // Add context menu handler to prevent browser context menu on map
    map.on("contextmenu", (e) => {
      e.preventDefault();
    });
  } catch (error) {
    document.getElementById("error-message").style.display = "block";
    document.getElementById("error-message").textContent =
      "Error loading map: " + error.message;
  }
}

// Base58 alphabet (Bitcoin-style)
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// Base58 encoding function
function base58Encode(bytes) {
  let result = "";
  let bigInt = 0n;

  // Convert bytes to a big integer
  for (let i = 0; i < bytes.length; i++) {
    bigInt = bigInt * 256n + BigInt(bytes[i]);
  }

  // Convert to base58
  while (bigInt > 0n) {
    const remainder = bigInt % 58n;
    result = BASE58_ALPHABET[Number(remainder)] + result;
    bigInt = bigInt / 58n;
  }

  // Handle leading zeros
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result = "1" + result;
  }

  return result;
}

// Base58 decoding function
function base58Decode(str) {
  let bigInt = 0n;

  // Convert base58 to big integer
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const value = BASE58_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error("Invalid base58 character");
    }
    bigInt = bigInt * 58n + BigInt(value);
  }

  // Convert to bytes
  const bytes = [];
  while (bigInt > 0n) {
    bytes.unshift(Number(bigInt % 256n));
    bigInt = bigInt / 256n;
  }

  // Handle leading '1's (zeros)
  for (let i = 0; i < str.length && str[i] === "1"; i++) {
    bytes.unshift(0);
  }

  return new Uint8Array(bytes);
}

// Route sharing functions
function encodeRoute(segmentNames) {
  if (!segmentNames || segmentNames.length === 0) return "";

  // Convert segment names to IDs using segments data
  const segmentIds = segmentNames
    .map((name) => {
      const segmentInfo = segmentsData[name];
      return segmentInfo ? segmentInfo.id : 0;
    })
    .filter((id) => id > 0);

  if (segmentIds.length === 0) return "";

  // Create binary data with version byte + segment IDs
  // Need to ensure proper alignment for Uint16Array (2-byte aligned)
  const totalBytes = 2 + segmentIds.length * 2; // 2 bytes for version padding + segment data
  const binaryData = new ArrayBuffer(totalBytes);
  const uint8Array = new Uint8Array(binaryData);

  // Write version as first byte, pad second byte to maintain alignment
  uint8Array[0] = ROUTE_VERSION;
  uint8Array[1] = 0; // Padding byte for alignment

  // Write segment IDs as 16-bit values starting from byte offset 2
  const view = new Uint16Array(binaryData, 2);
  segmentIds.forEach((id, index) => {
    view[index] = id;
  });

  // Convert to base58
  return base58Encode(uint8Array);
}

function decodeRoute(routeString) {
  if (!routeString) return [];

  try {
    let uint8Array;

    // Try to determine if this is base58 or base64 encoding
    const isBase58 =
      /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(
        routeString,
      );

    if (isBase58) {
      // Decode from base58 (version 2)
      uint8Array = base58Decode(routeString);
    } else {
      // Decode from base64 (legacy version 1)
      const binaryString = atob(routeString);
      const binaryData = new ArrayBuffer(binaryString.length);
      uint8Array = new Uint8Array(binaryData);

      for (let i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i);
      }
    }

    // Check for empty data
    if (uint8Array.byteLength === 0) {
      console.warn("Empty route data");
      return [];
    }

    // Read version from first byte
    const version = uint8Array[0];

    if (version !== 1 && version !== ROUTE_VERSION) {
      console.warn(
        `Unsupported route version: ${version}. Expected version 1 or ${ROUTE_VERSION}.`,
      );
      return [];
    }

    // Parse segment data (skip version and padding bytes)
    const segmentDataOffset = 2;
    const segmentDataLength = uint8Array.byteLength - segmentDataOffset;

    if (segmentDataLength % 2 !== 0) {
      console.warn("Invalid route data: segment data length is not even");
      return [];
    }

    const view = new Uint16Array(uint8Array.buffer, segmentDataOffset);
    const segmentIds = Array.from(view);

    // Convert IDs back to segment names, handling splits
    const segmentNames = [];

    for (let i = 0; i < segmentIds.length; i++) {
      const segmentId = segmentIds[i];
      let foundSegment = null;

      // Find segment by ID
      for (const segmentName in segmentsData) {
        const segmentInfo = segmentsData[segmentName];
        if (segmentInfo && segmentInfo.id === segmentId) {
          foundSegment = { name: segmentName, info: segmentInfo };
          break;
        }
      }

      if (foundSegment) {
        // Check if this segment has split property
        if (foundSegment.info.split && Array.isArray(foundSegment.info.split)) {
          // Replace with split segments
          const splitSegmentIds = foundSegment.info.split;

          // Find the actual segment names for the split IDs
          const splitSegmentNames = [];
          for (const splitId of splitSegmentIds) {
            for (const segmentName in segmentsData) {
              const segmentInfo = segmentsData[segmentName];
              if (segmentInfo && segmentInfo.id === splitId) {
                splitSegmentNames.push(segmentName);
                break;
              }
            }
          }

          // Wait for routePolylines to be available before processing connectivity
          if (splitSegmentNames.length > 0) {
            // For now, just add them in order - connectivity will be handled later by getOrderedCoordinates
            segmentNames.push(...splitSegmentNames);
          }
        } else {
          // Regular segment, add it
          segmentNames.push(foundSegment.name);
        }
      }
    }

    return segmentNames.filter((name) => name); // Remove empty slots
  } catch (error) {
    console.error("Error decoding route:", error);
    return [];
  }
}

function shareRoute() {
  const routeId = encodeRoute(selectedSegments);
  if (!routeId) {
    alert("אין מסלול לשיתוף. בחרו קטעים כדי ליצור מסלול.");
    return;
  }

  const url = new URL(window.location);
  url.searchParams.set("route", routeId);
  const shareUrl = url.toString();

  // Show share modal
  showShareModal(shareUrl);
}

function showResetModal() {
  // Create modal elements
  const modal = document.createElement("div");
  modal.className = "reset-modal";
  modal.innerHTML = `
    <div class="reset-modal-content">
      <div class="reset-modal-header">
        <h3>🗑️ איפוס מסלול</h3>
      </div>
      <div class="reset-modal-body">
        <p>האם אתה בטוח שברצונך לאפס את המסלול?</p>
        <p class="reset-warning">פעולה זו תמחק את כל הקטעים שנבחרו (${selectedSegments.length} קטעים)</p>
        <div class="reset-modal-buttons">
          <button class="reset-confirm-btn">כן, אפס מסלול</button>
          <button class="reset-cancel-btn">ביטול</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add event listeners
  const confirmBtn = modal.querySelector(".reset-confirm-btn");
  const cancelBtn = modal.querySelector(".reset-cancel-btn");

  confirmBtn.addEventListener("click", () => {
    resetRoute();
    document.body.removeChild(modal);
  });

  cancelBtn.addEventListener("click", () => {
    document.body.removeChild(modal);
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  // Add escape key listener
  const handleEscape = (e) => {
    if (e.key === "Escape") {
      document.body.removeChild(modal);
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);
}

function showShareModal(shareUrl) {
  // Create modal elements
  const modal = document.createElement("div");
  modal.className = "share-modal";
  modal.innerHTML = `
    <div class="share-modal-content">
      <div class="share-modal-header">
        <h3>שיתוף המסלול</h3>
        <button class="share-modal-close">&times;</button>
      </div>
      <div class="share-modal-body">
        <div class="share-url-container">
          <input type="text" class="share-url-input" value="${shareUrl}" readonly>
          <button class="copy-url-btn">העתק קישור</button>
        </div>
        <div class="share-buttons">
          <button class="share-btn-social twitter" onclick="shareToTwitter('${encodeURIComponent(shareUrl)}')">
            🐦 Twitter
          </button>
          <button class="share-btn-social facebook" onclick="shareToFacebook('${encodeURIComponent(shareUrl)}')">
            📘 Facebook
          </button>
          <button class="share-btn-social whatsapp" onclick="shareToWhatsApp('${encodeURIComponent(shareUrl)}')">
            💬 WhatsApp
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add event listeners
  const closeBtn = modal.querySelector(".share-modal-close");
  const copyBtn = modal.querySelector(".copy-url-btn");
  const urlInput = modal.querySelector(".share-url-input");

  closeBtn.addEventListener("click", () => {
    document.body.removeChild(modal);
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  copyBtn.addEventListener("click", () => {
    urlInput.select();
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        copyBtn.textContent = "הועתק!";
        copyBtn.style.background = "#4CAF50";
        setTimeout(() => {
          copyBtn.textContent = "העתק קישור";
          copyBtn.style.background = "#4682B4";
        }, 2000);
      })
      .catch(() => {
        document.execCommand("copy");
        copyBtn.textContent = "הועתק!";
        copyBtn.style.background = "#4CAF50";
        setTimeout(() => {
          copyBtn.textContent = "העתק קישור";
          copyBtn.style.background = "#4682B4";
        }, 2000);
      });
  });
}

function shareToTwitter(url) {
  const text =
    "בדקו את מסלול הרכיבה שיצרתי במפת שבילי אופניים - גליל עליון וגולן!";
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${url}`,
    "_blank",
  );
}

function shareToFacebook(url) {
  window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, "_blank");
}

function shareToWhatsApp(url) {
  const text =
    "בדקו את מסלול הרכיבה שיצרתי במפת שבילי אופניים - גליל עליון וגולן!";
  window.open(
    `https://wa.me/?text=${encodeURIComponent(text + " " + decodeURIComponent(url))}`,
    "_blank",
  );
}

function getRouteParameter() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("route");
}

function loadRouteFromUrl() {
  const routeParam = getRouteParameter();

  if (routeParam && segmentsData) {
    const decodedSegments = decodeRoute(routeParam);
    if (decodedSegments.length > 0) {
      selectedSegments = decodedSegments;
      // Wait a bit for map to be fully loaded before updating styles
      setTimeout(() => {
        updateSegmentStyles();
        updateRouteListAndDescription();
        focusMapOnRoute();
        hideRouteLoadingIndicator();
      }, 500);

      return true;
    } else {
      hideRouteLoadingIndicator();
    }
  }
  return false;
}

function showRouteLoadingIndicator() {
  const routeParam = getRouteParameter();

  if (!routeParam || !segmentsData) {
    return;
  }

  // Remove existing indicator if any
  const existing = document.getElementById("route-loading-indicator");
  if (existing) {
    existing.remove();
  }

  const indicator = document.createElement("div");
  indicator.id = "route-loading-indicator";
  indicator.className = "route-loading";
  indicator.innerHTML = "⏳ טוען מסלול...";

  const legendContainer = document.querySelector(".legend-container");
  legendContainer.appendChild(indicator);
}

function hideRouteLoadingIndicator() {
  const indicator = document.getElementById("route-loading-indicator");
  if (indicator) {
    indicator.remove();
  }
}

async function loadSegmentsData() {
  try {
    const response = await fetch("./segments.json");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    segmentsData = await response.json();
    console.log(
      "Successfully loaded segments.json with",
      Object.keys(segmentsData).length,
      "segments",
    );
  } catch (error) {
    console.warn("Could not load segments.json:", error);
    // Initialize with empty object to prevent errors
    segmentsData = {};
  }
}

async function loadKMLFile() {
  try {
    await loadSegmentsData();
    showRouteLoadingIndicator();
    const response = await fetch("./bike_roads_v12.geojson");
    const geoJsonData = await response.json();
    await parseGeoJSON(geoJsonData);

    // Try to load route from URL after everything is loaded
    setTimeout(() => {
      loadRouteFromUrl();

      // Initialize tutorial after everything is loaded
      if (typeof initTutorial === "function") {
        initTutorial();
      }
    }, 1000);
  } catch (error) {
    document.getElementById("error-message").style.display = "block";
    document.getElementById("error-message").textContent =
      "Error loading GeoJSON file: " + error.message;
  }
}

async function parseGeoJSON(geoJsonData) {
  try {
    kmlData = JSON.stringify(geoJsonData);

    if (!geoJsonData.features || geoJsonData.features.length === 0) {
      document.getElementById("error-message").style.display = "block";
      document.getElementById("error-message").textContent =
        "No route segments found in the GeoJSON file.";
      return;
    }

    document.getElementById("error-message").style.display = "none";

    // Clear existing layers and sources
    routePolylines.forEach((polylineData) => {
      if (map.getLayer(polylineData.layerId)) {
        map.removeLayer(polylineData.layerId);
      }
      if (map.getSource(polylineData.layerId)) {
        map.removeSource(polylineData.layerId);
      }
    });
    routePolylines = [];

    let bounds = new mapboxgl.LngLatBounds();

    geoJsonData.features.forEach((feature) => {
      if (feature.geometry.type !== "LineString") return;

      const name = feature.properties.name || "Unnamed Route";
      const coordinates = feature.geometry.coordinates;

      // Convert coordinates from [lng, lat, elevation] to {lat, lng, elevation} objects
      const coordObjects = coordinates.map((coord) => ({
        lat: coord[1],
        lng: coord[0],
        elevation: coord[2], // Preserve elevation data if available
      }));

      // Extract style information from properties
      let originalColor =
        feature.properties.stroke ||
        feature.properties["stroke-color"] ||
        "#0288d1";

      // Convert colors according to specification
      if (originalColor === "#0288d1" || originalColor === "rgb(2, 136, 209)") {
        originalColor = "rgb(101, 170, 162)";
      } else if (
        originalColor == "#e6ee9c" ||
        originalColor === "rgb(230, 238, 156)"
      ) {
        originalColor = "rgb(138, 147, 158)";
      } else {
        originalColor = "rgb(174, 144, 103)";
      }

      // temporarily overriding weight and opacity:
      //let originalWeight = feature.properties['stroke-width'] || 3;
      //let originalOpacity = feature.properties['stroke-opacity'] || 0.8;
      let originalWeight = 3;
      let originalOpacity = 1.0;

      const layerId = `route-${name.replace(/\s+/g, "-").replace(/[^\w-]/g, "")}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Add source and layer to map
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

      // Store polyline data
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
      routePolylines.push(polylineData);

      // Add coordinates to bounds for auto-fitting
      coordinates.forEach((coord) => bounds.extend(coord));

      // Add hover effects with segment name display
      map.on("mouseenter", layerId, (e) => {
        map.getCanvas().style.cursor = "pointer";
        if (!selectedSegments.includes(name)) {
          map.setPaintProperty(layerId, "line-width", originalWeight + 2);
          map.setPaintProperty(layerId, "line-opacity", 1);
        }

        // Get pre-calculated segment metrics
        const metrics = segmentMetrics[name];
        const segmentDistanceKm = metrics ? metrics.distanceKm : "0.0";
        const segmentElevationGain = metrics
          ? metrics.forward.elevationGain
          : 0;
        const segmentElevationLoss = metrics
          ? metrics.forward.elevationLoss
          : 0;

        // Update segment name display with details
        const segmentDisplay = document.getElementById("segment-name-display");
        segmentDisplay.innerHTML = `<strong>${name}</strong> <br> 📏 ${segmentDistanceKm} ק"מ • ⬆️ ${segmentElevationGain} מ' • ⬇️ ${segmentElevationLoss} מ'`;
        segmentDisplay.style.display = "block";

        // Check for warnings in segments data and add to segment display
        const segmentInfo = segmentsData[name];
        if (segmentInfo) {
          if (segmentInfo.winter === false) {
            segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_ORANGE}; font-size: 12px; margin-top: 5px;">❄️ בוץ בחורף</div>`;
          }
          if (segmentInfo.warning) {
            segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_RED}; font-size: 12px; margin-top: 5px;">⚠️ ${segmentInfo.warning}</div>`;
          }
        }
      });

      // Add hover functionality for selected segments to show distance from start
      map.on("mousemove", layerId, (e) => {
        if (selectedSegments.includes(name)) {
          const hoverPoint = e.lngLat;
          const orderedCoords = getOrderedCoordinates();

          if (orderedCoords.length > 0) {
            // Find the closest point on this specific segment
            let minDistanceToSegment = Infinity;
            let closestPointOnSegment = null;
            let closestSegmentIndex = 0;

            // Find closest point on the current segment
            for (let i = 0; i < coordObjects.length - 1; i++) {
              const segmentStart = coordObjects[i];
              const segmentEnd = coordObjects[i + 1];

              // Calculate closest point on line segment
              const closestPoint = getClosestPointOnLineSegment(
                { lat: hoverPoint.lat, lng: hoverPoint.lng },
                segmentStart,
                segmentEnd,
              );

              const distance = getDistance(
                { lat: hoverPoint.lat, lng: hoverPoint.lng },
                closestPoint,
              );

              if (distance < minDistanceToSegment) {
                minDistanceToSegment = distance;
                closestPointOnSegment = closestPoint;
                closestSegmentIndex = i;
              }
            }

            if (closestPointOnSegment && minDistanceToSegment < 100) {
              // 100 meter threshold
              // Calculate distance from start of route to this point
              let distanceFromStart = 0;

              // Add distance from previous segments
              for (let i = 0; i < selectedSegments.length; i++) {
                const segName = selectedSegments[i];
                if (segName === name) break;

                const prevPolyline = routePolylines.find(
                  (p) => p.segmentName === segName,
                );
                if (prevPolyline) {
                  for (
                    let j = 0;
                    j < prevPolyline.coordinates.length - 1;
                    j++
                  ) {
                    distanceFromStart += getDistance(
                      prevPolyline.coordinates[j],
                      prevPolyline.coordinates[j + 1],
                    );
                  }
                }
              }

              // Add distance within current segment up to hover point
              for (let i = 0; i < closestSegmentIndex; i++) {
                distanceFromStart += getDistance(
                  coordObjects[i],
                  coordObjects[i + 1],
                );
              }

              // Add partial distance to closest point on segment
              const segmentStart = coordObjects[closestSegmentIndex];
              const segmentEnd = coordObjects[closestSegmentIndex + 1];
              const segmentLength = getDistance(segmentStart, segmentEnd);
              const distanceToClosest = getDistance(
                segmentStart,
                closestPointOnSegment,
              );
              const ratio = distanceToClosest / segmentLength;

              if (!isNaN(ratio) && ratio >= 0 && ratio <= 1) {
                distanceFromStart += distanceToClosest;
              }

              const distanceKm = (distanceFromStart / 1000).toFixed(1);

              // Show distance in top right display
              const segmentDisplay = document.getElementById(
                "segment-name-display",
              );
              segmentDisplay.innerHTML = `📍 מרחק מההתחלה: ${distanceKm} ק"מ`;
              segmentDisplay.style.display = "block";

              // Add visible circle marker at closest point
              if (window.hoverMarker) {
                window.hoverMarker.remove();
              }

              const el = document.createElement("div");
              el.className = "hover-circle";
              el.style.cssText = `
                width: 12px;
                height: 12px;
                background: ${COLORS.ELEVATION_MARKER};
                border: 3px solid white;
                border-radius: 50%;
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                cursor: pointer;
              `;

              window.hoverMarker = new mapboxgl.Marker(el)
                .setLngLat([
                  closestPointOnSegment.lng,
                  closestPointOnSegment.lat,
                ])
                .addTo(map);
            }
          }
        }
      });

      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
        if (!selectedSegments.includes(name)) {
          map.setPaintProperty(layerId, "line-width", originalWeight);
          map.setPaintProperty(layerId, "line-opacity", originalOpacity);
        }

        // Hide segment name display
        const segmentDisplay = document.getElementById("segment-name-display");
        segmentDisplay.style.display = "none";

        // Remove hover marker
        if (window.hoverMarker) {
          window.hoverMarker.remove();
          window.hoverMarker = null;
        }
      });
    });

    // Pre-calculate all segment metrics for fast access
    preCalculateSegmentMetrics();

    // Initialize spatial index and populate it with all segments
    spatialIndex = new SpatialIndex();
    routePolylines.forEach(polylineData => {
      spatialIndex.addSegment(polylineData);
    });
    console.log(`Spatial index initialized with ${routePolylines.length} segments`);

    // Initialize RouteManager and load data
    routeManager = new RouteManager();
    await routeManager.load(geoJsonData, segmentsData);
    console.log("RouteManager initialized.");

    // Keep map at current position instead of auto-fitting to all segments
    // if (!bounds.isEmpty()) {
    //   map.fitBounds(bounds, { padding: 20 });
    // }
  } catch (error) {
    document.getElementById("error-message").style.display = "block";
    document.getElementById("error-message").textContent =
      "Error parsing GeoJSON file: " + error.message;
  }
}

// Helper function to calculate distance between two points
function getDistance(point1, point2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (point1.lat * Math.PI) / 180;
  const φ2 = (point2.lat * Math.PI) / 180;
  const Δφ = ((point2.lat - point1.lat) * Math.PI) / 180;
  const Δλ = ((point2.lng - point1.lng) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Function to smooth elevation values using distance-based window smoothing
function smoothElevations(coords, distanceWindow = 100) {
  if (coords.length === 0) {
    return coords;
  }

  // Ensure all coordinates have elevation values
  const coordsWithElevation = coords.map((coord) => {
    let elevation;
    if (coord.elevation !== undefined) {
      elevation = coord.elevation;
    } else {
      // Fallback calculation if elevation is not available
      elevation =
        200 + Math.sin(coord.lat * 10) * 100 + Math.cos(coord.lng * 8) * 50;
    }
    return {
      lat: coord.lat,
      lng: coord.lng,
      elevation: elevation,
    };
  });

  // Apply distance-based window smoothing
  const smoothedElevations = distanceWindowSmoothing(
    coordsWithElevation,
    distanceWindow,
    (index) => coordsWithElevation[index].elevation,
    (accumulated, start, end) => accumulated / (end - start + 1),
  );

  // Preserve original first and last elevations
  if (coordsWithElevation.length > 0) {
    smoothedElevations[0] = coordsWithElevation[0].elevation;
    smoothedElevations[coordsWithElevation.length - 1] =
      coordsWithElevation[coordsWithElevation.length - 1].elevation;
  }

  // Create smoothed coordinate objects
  const smoothed = coordsWithElevation.map((coord, index) => ({
    lat: coord.lat,
    lng: coord.lng,
    elevation: smoothedElevations[index],
  }));

  return smoothed;
}

// Distance-based window smoothing algorithm
function distanceWindowSmoothing(
  points,
  distanceWindow,
  accumulate,
  compute,
  remove = null,
) {
  let result = [];

  let start = 0,
    end = 0,
    accumulated = 0;

  for (let i = 0; i < points.length; i++) {
    // Remove points that are too far behind
    while (
      start + 1 < i &&
      getDistance(points[start], points[i]) > distanceWindow
    ) {
      if (remove) {
        accumulated -= remove(start);
      } else {
        accumulated -= accumulate(start);
      }
      start++;
    }

    // Add points that are within distance ahead
    while (
      end < points.length &&
      getDistance(points[i], points[end]) <= distanceWindow
    ) {
      accumulated += accumulate(end);
      end++;
    }

    result[i] = compute(accumulated, start, end - 1);
  }

  return result;
}

// Pre-calculate all segment metrics for fast access
function preCalculateSegmentMetrics() {
  segmentMetrics = {};

  routePolylines.forEach((polylineData) => {
    const coords = polylineData.coordinates;
    const segmentName = polylineData.segmentName;

    // Calculate distance
    let distance = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      distance += getDistance(coords[i], coords[i + 1]);
    }

    // Apply elevation smoothing before calculating gains/losses
    const smoothedCoords = smoothElevations(coords, 100);

    // Calculate elevation gains and losses in both directions using smoothed data
    let elevationGainForward = 0;
    let elevationLossForward = 0;
    let elevationGainReverse = 0;
    let elevationLossReverse = 0;

    // Forward direction using smoothed elevations with minimum threshold
    const minElevationChange = 1.0; // Ignore elevation changes smaller than 1 meter

    for (let i = 0; i < smoothedCoords.length - 1; i++) {
      const currentElevation = smoothedCoords[i].elevation;
      const nextElevation = smoothedCoords[i + 1].elevation;

      const elevationChange = nextElevation - currentElevation;

      // Only count elevation changes that meet the minimum threshold
      if (Math.abs(elevationChange) >= minElevationChange) {
        if (elevationChange > 0) {
          elevationGainForward += elevationChange;
        } else {
          elevationLossForward += Math.abs(elevationChange);
        }
      }
    }

    // Reverse direction (just swap the gains and losses)
    elevationGainReverse = elevationLossForward;
    elevationLossReverse = elevationGainForward;

    // Store pre-calculated metrics
    segmentMetrics[segmentName] = {
      distance: distance,
      distanceKm: (distance / 1000).toFixed(1),
      forward: {
        elevationGain: Math.round(elevationGainForward),
        elevationLoss: Math.round(elevationLossForward),
      },
      reverse: {
        elevationGain: Math.round(elevationGainReverse),
        elevationLoss: Math.round(elevationLossReverse),
      },
      startPoint: coords[0],
      endPoint: coords[coords.length - 1],
      smoothedCoords: smoothedCoords, // Store smoothed coordinates for elevation profile
    };
  });
}

// Helper function to calculate distance from point to line segment
function distanceToLineSegment(point, lineStart, lineEnd) {
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

  return getDistance(point, { lat: yy, lng: xx });
}

// Helper function to calculate distance from point to line segment in pixels
function distanceToLineSegmentPixels(point, lineStart, lineEnd) {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;
  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * C;
    yy = lineStart.y + param * D;
  }

  const dx = point.x - xx;
  const dy = point.y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

// Helper function to find closest point on line segment
function getClosestPointOnLineSegment(point, lineStart, lineEnd) {
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
}

// Function to check if route is continuous and find first broken segment
function checkRouteContinuity() {
  if (selectedSegments.length <= 1) {
    return { isContinuous: true, brokenSegmentIndex: -1 };
  }

  const tolerance = 100; // 100 meters tolerance
  const orderedCoords = getOrderedCoordinates();

  if (orderedCoords.length === 0) {
    return { isContinuous: true, brokenSegmentIndex: -1 };
  }

  // Check gaps in the ordered coordinates by looking at distances between consecutive segments
  let coordIndex = 0;

  for (let i = 0; i < selectedSegments.length - 1; i++) {
    const currentSegmentName = selectedSegments[i];
    const nextSegmentName = selectedSegments[i + 1];

    const currentPolyline = routePolylines.find(
      (p) => p.segmentName === currentSegmentName,
    );
    const nextPolyline = routePolylines.find(
      (p) => p.segmentName === nextSegmentName,
    );

    if (!currentPolyline || !nextPolyline) {
      continue;
    }

    // Find where current segment ends in ordered coordinates
    const currentSegmentLength = currentPolyline.coordinates.length;
    const currentSegmentEndIndex = coordIndex + currentSegmentLength - 1;

    // Check if we have enough coordinates
    if (currentSegmentEndIndex >= orderedCoords.length - 1) {
      return { isContinuous: false, brokenSegmentIndex: i };
    }

    const currentEnd = orderedCoords[currentSegmentEndIndex];
    const nextStart = orderedCoords[currentSegmentEndIndex + 1];

    const distance = getDistance(currentEnd, nextStart);

    // If distance is greater than tolerance, route is broken
    if (distance > tolerance) {
      return { isContinuous: false, brokenSegmentIndex: i };
    }

    // Move to next segment in ordered coordinates
    // Skip first coordinate of next segment if segments are well connected to avoid duplication
    coordIndex += currentSegmentLength;
    if (distance <= 50) {
      // Well connected segments
      coordIndex -= 1; // Account for coordinate that was skipped in getOrderedCoordinates
    }
  }

  return { isContinuous: true, brokenSegmentIndex: -1 };
}

// Function to check if any selected segments have winter warning and find all of them
function hasWinterSegments() {
  const winterSegments = [];
  for (let i = 0; i < selectedSegments.length; i++) {
    const segmentInfo = segmentsData[selectedSegments[i]];
    if (segmentInfo && segmentInfo.winter === false) {
      winterSegments.push(selectedSegments[i]);
    }
  }
  return {
    hasWinter: winterSegments.length > 0,
    winterSegments: winterSegments,
    count: winterSegments.length,
  };
}

// Function to check if any selected segments have warnings and find all of them
function hasSegmentWarnings() {
  const warningSegments = [];
  for (let i = 0; i < selectedSegments.length; i++) {
    const segmentInfo = segmentsData[selectedSegments[i]];
    if (segmentInfo && segmentInfo.warning) {
      warningSegments.push(selectedSegments[i]);
    }
  }
  return {
    hasWarnings: warningSegments.length > 0,
    warningSegments: warningSegments,
    count: warningSegments.length,
  };
}

// Function to update route warning visibility
function updateRouteWarning() {
  const routeWarning = document.getElementById("route-warning");
  const winterWarning = document.getElementById("winter-warning");
  const segmentWarning = document.getElementById("segment-warning");

  const continuityResult = checkRouteContinuity();
  const winterResult = hasWinterSegments();
  const warningsResult = hasSegmentWarnings();

  // Show broken route warning
  if (selectedSegments.length > 1 && !continuityResult.isContinuous) {
    routeWarning.style.display = "block";
  } else {
    routeWarning.style.display = "none";
  }

  // Show winter warning with count
  if (winterResult.hasWinter) {
    const countText = winterResult.count > 1 ? ` (${winterResult.count})` : "";
    winterWarning.innerHTML = `❄️בוץ בחורף${countText}`;
    winterWarning.style.display = "block";

    // Reset winter warning cycling index when warnings change
    if (
      !window.winterWarningIndex ||
      winterResult.winterSegments.length !== window.lastWinterCount
    ) {
      window.winterWarningIndex = 0;
      window.lastWinterCount = winterResult.winterSegments.length;
    }
  } else {
    winterWarning.style.display = "none";
    window.winterWarningIndex = 0;
    window.lastWinterCount = 0;
  }

  // Show segment warnings indicator with count
  if (warningsResult.hasWarnings) {
    const countText =
      warningsResult.count > 1 ? ` (${warningsResult.count})` : "";
    segmentWarning.innerHTML = `⚠️ אזהרות ${countText}`;
    segmentWarning.style.display = "block";

    // Reset segment warning cycling index when warnings change
    if (
      !window.segmentWarningIndex ||
      warningsResult.warningSegments.length !== window.lastWarningCount
    ) {
      window.segmentWarningIndex = 0;
      window.lastWarningCount = warningsResult.warningSegments.length;
    }
  } else {
    segmentWarning.style.display = "none";
    window.segmentWarningIndex = 0;
    window.lastWarningCount = 0;
  }
}

// Function to focus map on a specific segment
function focusOnSegment(segmentName) {
  const polyline = routePolylines.find((p) => p.segmentName === segmentName);
  if (!polyline) return;

  const coords = polyline.coordinates;
  if (coords.length === 0) return;

  returnToStartingPosition();

  // Show segment details in display
  const metrics = segmentMetrics[segmentName];
  const segmentDistanceKm = metrics ? metrics.distanceKm : "0.0";
  const segmentElevationGain = metrics ? metrics.forward.elevationGain : 0;
  const segmentElevationLoss = metrics ? metrics.forward.elevationLoss : 0;

  const segmentDisplay = document.getElementById("segment-name-display");
  segmentDisplay.innerHTML = `<strong>${segmentName}</strong> <br> 📏 ${segmentDistanceKm} ק"מ • ⬆️ ${segmentElevationGain} מ' • ⬇️ ${segmentElevationLoss} מ'`;

  // Check for warnings in segments data and add to segment display
  const segmentInfo = segmentsData[segmentName];
  if (segmentInfo) {
    if (segmentInfo.winter === false) {
      segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_ORANGE}; font-size: 12px; margin-top: 5px;">❄️ בוץ בחורף</div>`;
    }
    if (segmentInfo.warning) {
      segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_RED}; font-size: 12px; margin-top: 5px;">⚠️ ${segmentInfo.warning}</div>`;
    }
  }

  segmentDisplay.style.display = "block";

  // Calculate bounds for the segment
  let minLat = coords[0].lat,
    maxLat = coords[0].lat;
  let minLng = coords[0].lng,
    maxLng = coords[0].lng;

  coords.forEach((coord) => {
    minLat = Math.min(minLat, coord.lat);
    maxLat = Math.max(maxLat, coord.lat);
    minLng = Math.min(minLng, coord.lng);
    maxLng = Math.max(maxLng, coord.lng);
  });

  // Add some padding around the segment
  const latPadding = (maxLat - minLat) * 0.3 || 0.005;
  const lngPadding = (maxLng - minLng) * 0.3 || 0.005;

  const bounds = new mapboxgl.LngLatBounds(
    [minLng - lngPadding, minLat - latPadding],
    [maxLng + lngPadding, maxLat + latPadding],
  );

  // Zoom to fit the segment bounds with minimum zoom limit
  map.fitBounds(bounds, {
    padding: 50,
    duration: 1000,
    maxZoom: MIN_ZOOM_LEVEL,
  });

  // Highlight the segment after a short delay to allow map to zoom
  setTimeout(() => {
    const layerId = polyline.layerId;
    const originalColor = map.getPaintProperty(layerId, "line-color");
    const originalWidth = map.getPaintProperty(layerId, "line-width");

    let blinkCount = 0;
    const maxBlinks = 4; // 2 complete blinks (on-off-on-off)

    const blinkInterval = setInterval(() => {
      if (blinkCount % 2 === 0) {
        // Blink on - highlight with white
        map.setPaintProperty(layerId, "line-color", COLORS.HIGHLIGHT_WHITE);
        map.setPaintProperty(layerId, "line-width", originalWidth + 4);
      } else {
        // Blink off - return to original/selected color
        if (selectedSegments.includes(segmentName)) {
          map.setPaintProperty(layerId, "line-color", COLORS.SEGMENT_SELECTED);
          map.setPaintProperty(
            layerId,
            "line-width",
            polyline.originalStyle.weight + 1,
          );
        } else {
          map.setPaintProperty(
            layerId,
            "line-color",
            polyline.originalStyle.color,
          );
          map.setPaintProperty(
            layerId,
            "line-width",
            polyline.originalStyle.weight,
          );
        }
      }

      blinkCount++;

      // Stop blinking after maxBlinks and ensure final state is correct
      if (blinkCount >= maxBlinks) {
        clearInterval(blinkInterval);

        // Final state - ensure it's in the correct color
        if (selectedSegments.includes(segmentName)) {
          map.setPaintProperty(layerId, "line-color", COLORS.SEGMENT_SELECTED);
          map.setPaintProperty(
            layerId,
            "line-width",
            polyline.originalStyle.weight + 1,
          );
        } else {
          map.setPaintProperty(
            layerId,
            "line-color",
            polyline.originalStyle.color,
          );
          map.setPaintProperty(
            layerId,
            "line-width",
            polyline.originalStyle.weight,
          );
        }
      }
    }, 250); // 250ms intervals = 4 blinks in 1 second
  }, 200);
}

// Function to focus map on the entire selected route
function focusMapOnRoute() {
  if (selectedSegments.length === 0) {
    return;
  }

  // Calculate bounds for all selected segments
  let bounds = new mapboxgl.LngLatBounds();
  let hasCoordinates = false;

  selectedSegments.forEach((segmentName) => {
    const polyline = routePolylines.find((p) => p.segmentName === segmentName);
    if (polyline && polyline.coordinates.length > 0) {
      polyline.coordinates.forEach((coord) => {
        bounds.extend([coord.lng, coord.lat]);
        hasCoordinates = true;
      });
    }
  });

  if (hasCoordinates && !bounds.isEmpty()) {
    // Zoom to fit the route bounds with padding
    map.fitBounds(bounds, {
      padding: 80,
      duration: 1500,
      maxZoom: 14, // Don't zoom in too much for long routes
    });
  }
}

// Function to load route from encoding and select segments (with undo stack management)
function loadRouteFromEncoding(routeEncoding) {
  if (!routeEncoding || !segmentsData) {
    console.warn("Invalid route encoding or segments data not loaded");
    return false;
  }

  try {
    const decodedSegments = decodeRoute(routeEncoding);
    if (decodedSegments.length === 0) {
      console.warn("No segments decoded from route encoding");
      return false;
    }

    // Save current state for undo if there are currently selected segments
    if (selectedSegments.length > 0) {
      saveState();
    }

    // Clear existing selections
    selectedSegments = [];

    // Reset all segment styles to original
    routePolylines.forEach((polylineData) => {
      const layerId = polylineData.layerId;
      if (map.getLayer && map.getLayer(layerId)) {
        map.setPaintProperty(
          layerId,
          "line-color",
          polylineData.originalStyle.color,
        );
        map.setPaintProperty(
          layerId,
          "line-width",
          polylineData.originalStyle.weight,
        );
      }
    });

    // Add decoded segments to selection
    selectedSegments = [...decodedSegments];

    // Update visual styles and UI
    updateSegmentStyles();
    updateRouteListAndDescription();
    updateUndoRedoButtons();

    // Focus map on the loaded route
    setTimeout(() => {
      focusMapOnRoute();
    }, 200);

    console.log(`Loaded route with ${selectedSegments.length} segments`);
    return true;
  } catch (error) {
    console.error("Error loading route from encoding:", error);
    return false;
  }
}

// Function to order coordinates based on route connectivity
function getOrderedCoordinates() {
  if (selectedSegments.length === 0) {
    return [];
  }

  let orderedCoords = [];

  for (let i = 0; i < selectedSegments.length; i++) {
    const segmentName = selectedSegments[i];
    const polyline = routePolylines.find((p) => p.segmentName === segmentName);

    if (!polyline) {
      continue;
    }

    let coords = [...polyline.coordinates];

    // For the first segment, check if we need to orient it correctly
    if (i === 0) {
      // If there's a second segment, orient the first segment to connect better
      if (selectedSegments.length > 1) {
        const nextSegmentName = selectedSegments[1];
        const nextPolyline = routePolylines.find(
          (p) => p.segmentName === nextSegmentName,
        );

        if (nextPolyline) {
          const nextCoords = nextPolyline.coordinates;
          const firstStart = coords[0];
          const firstEnd = coords[coords.length - 1];
          const nextStart = nextCoords[0];
          const nextEnd = nextCoords[nextCoords.length - 1];

          // Calculate all possible connection distances
          const distances = [
            getDistance(firstEnd, nextStart), // first end to next start
            getDistance(firstEnd, nextEnd), // first end to next end
            getDistance(firstStart, nextStart), // first start to next start
            getDistance(firstStart, nextEnd), // first start to next end
          ];

          const minDistance = Math.min(...distances);
          const minIndex = distances.indexOf(minDistance);

          // If the best connection is from first start, reverse the first segment
          if (minIndex === 2 || minIndex === 3) {
            coords.reverse();
          }
        }
      }
      orderedCoords = [...coords];
    } else {
      // For subsequent segments, determine which end connects better
      const lastPoint = orderedCoords[orderedCoords.length - 1];
      const segmentStart = coords[0];
      const segmentEnd = coords[coords.length - 1];

      const distanceToStart = getDistance(lastPoint, segmentStart);
      const distanceToEnd = getDistance(lastPoint, segmentEnd);

      // If the end is closer, reverse the coordinates
      if (distanceToEnd < distanceToStart) {
        coords.reverse();
      }

      // Add coordinates with better duplication handling
      const firstPoint = coords[0];
      const connectionDistance = getDistance(lastPoint, firstPoint);

      // If segments are well connected (within 50 meters), skip first point to avoid duplication
      // If segments are far apart (gap > 50 meters), include all points to show the gap
      if (connectionDistance <= 50) {
        orderedCoords.push(...coords.slice(1));
      } else {
        orderedCoords.push(...coords);
      }
    }
  }

  return orderedCoords;
}

// Function to generate elevation profile
function generateElevationProfile() {
  const orderedCoords = getOrderedCoordinates();
  if (orderedCoords.length === 0) return "";

  let elevationHtml = '<div class="elevation-profile">';
  elevationHtml += "<h4>גרף גובה (Elevation Profile)</h4>";
  elevationHtml +=
    '<div class="elevation-chart" id="elevation-chart" style="position: relative;">';

  const totalDistance = orderedCoords.reduce((total, coord, index) => {
    if (index === 0) return 0;
    return total + getDistance(orderedCoords[index - 1], coord);
  }, 0);

  if (totalDistance === 0) {
    elevationHtml += "</div></div>";
    return elevationHtml;
  }

  // Create continuous elevation profile with interpolation
  const profileWidth = 300; // pixels
  const elevationData = [];

  // First, apply smoothing to the entire route coordinates and calculate elevation for all coordinates
  const routeWithElevation = orderedCoords.map((coord) => {
    let elevation;
    if (coord.elevation !== undefined) {
      elevation = coord.elevation;
    } else {
      // Fallback: calculate elevation based on position (simulated)
      elevation =
        200 + Math.sin(coord.lat * 10) * 100 + Math.cos(coord.lng * 8) * 50;
    }
    return { ...coord, elevation };
  });

  // Apply smoothing to the entire route
  const smoothedRouteCoords = smoothElevations(routeWithElevation, 100); // Slightly larger window for route-level smoothing

  const coordsWithElevation = smoothedRouteCoords.map((coord, index) => {
    const distance =
      index === 0
        ? 0
        : smoothedRouteCoords.slice(0, index + 1).reduce((total, c, idx) => {
            if (idx === 0) return 0;
            return total + getDistance(smoothedRouteCoords[idx - 1], c);
          }, 0);
    return { ...coord, distance };
  });

  // Find min/max elevation
  let minElevation = Math.min(...coordsWithElevation.map((c) => c.elevation));
  let maxElevation = Math.max(...coordsWithElevation.map((c) => c.elevation));
  const elevationRange = maxElevation - minElevation || 100;

  // Create continuous profile by interpolating between points
  for (let x = 0; x <= profileWidth; x++) {
    const distanceAtX = (x / profileWidth) * totalDistance;

    // Find the two closest points to interpolate between
    let beforePoint = null;
    let afterPoint = null;

    for (let i = 0; i < coordsWithElevation.length - 1; i++) {
      if (
        coordsWithElevation[i].distance <= distanceAtX &&
        coordsWithElevation[i + 1].distance >= distanceAtX
      ) {
        beforePoint = coordsWithElevation[i];
        afterPoint = coordsWithElevation[i + 1];
        break;
      }
    }

    let elevation, coord;
    if (beforePoint && afterPoint && beforePoint !== afterPoint) {
      // Interpolate elevation and coordinates
      const ratio =
        (distanceAtX - beforePoint.distance) /
        (afterPoint.distance - beforePoint.distance);
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
      ((elevation - minElevation) / elevationRange) * 80 + 10,
    );
    const distancePercent = (x / profileWidth) * 100;

    elevationData.push({
      elevation,
      distance: distanceAtX,
      coord,
      heightPercent,
      distancePercent,
      pixelX: x,
    });
  }

  // Create continuous elevation profile using SVG path
  let pathData = "";
  elevationData.forEach((point, index) => {
    const x = point.distancePercent;
    const y = 100 - point.heightPercent; // Flip Y coordinate for SVG

    if (index === 0) {
      pathData += `M ${x} ${y}`;
    } else {
      pathData += ` L ${x} ${y}`;
    }
  });

  // Close the path to create a filled area
  pathData += ` L 100 100 L 0 100 Z`;

  // Add SVG for continuous elevation profile with proper viewBox
  elevationHtml += `
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style="position: absolute; top: 0; left: 0;">
      <defs>
        <linearGradient id="elevationGradient" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" style="stop-color:#748873;stop-opacity:1" />
          <stop offset="33%" style="stop-color:#D1A980;stop-opacity:1" />
          <stop offset="66%" style="stop-color:#E5E0D8;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#F8F8F8;stop-opacity:1" />
        </linearGradient>
      </defs>
      <path d="${pathData}" fill="url(#elevationGradient)" stroke="#748873" stroke-width="0.5"/>
    </svg>
  `;

  // Add invisible hover overlay that covers the entire height
  elevationHtml +=
    '<div class="elevation-hover-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; cursor: pointer;"></div>';

  elevationHtml += "</div>";
  elevationHtml += '<div class="elevation-labels">';
  elevationHtml += `<span class="distance-label">${(totalDistance / 1000).toFixed(1)} ק"מ</span>`;
  elevationHtml += '<span class="distance-label">0 ק"מ</span>';
  elevationHtml += "</div>";
  elevationHtml += "</div>";

  // Store elevation data globally for hover functionality
  window.currentElevationData = elevationData;
  window.currentTotalDistance = totalDistance;

  return elevationHtml;
}

function updateRouteListAndDescription() {
  const routeDescription = document.getElementById("route-description");
  const downloadButton = document.getElementById("download-gpx");
  const descriptionPanel = document.getElementById("route-description-panel");

  if (selectedSegments.length === 0 && routePoints.length === 0) {
    routeDescription.innerHTML =
      "לחץ על המפה ליד קטעי דרך כדי לבנות את המסלול שלך.";
    downloadButton.disabled = true;
    updateRouteWarning();
    updateUndoRedoButtons(); // Update reset button state
    descriptionPanel.style.display = "none"; // Hide description panel
    return;
  } else {
    descriptionPanel.style.display = "block"; // Ensure description panel is visible when segments are selected
  }

  // Calculate total distance using pre-calculated data
  let totalDistance = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;

  selectedSegments.forEach((segmentName) => {
    const metrics = segmentMetrics[segmentName];
    if (metrics) {
      totalDistance += metrics.distance;
    }
  });

  // Calculate elevation changes using pre-calculated data and smart directionality
  totalElevationGain = 0;
  totalElevationLoss = 0;

  // Determine directionality for each segment and use pre-calculated elevation data
  for (let segIndex = 0; segIndex < selectedSegments.length; segIndex++) {
    const segmentName = selectedSegments[segIndex];
    const metrics = segmentMetrics[segmentName];

    if (!metrics) continue;

    let isReversed = false;

    // Determine if this segment needs to be reversed based on connectivity
    if (segIndex > 0) {
      // Get connection info from previous segment
      const prevSegmentName = selectedSegments[segIndex - 1];
      const prevMetrics = segmentMetrics[prevSegmentName];

      if (prevMetrics) {
        // Use pre-calculated endpoints to determine connectivity
        const prevStart = prevMetrics.startPoint;
        const prevEnd = prevMetrics.endPoint;
        const currentStart = metrics.startPoint;
        const currentEnd = metrics.endPoint;

        // Check which connection makes more sense based on previous segment's orientation
        let prevLastPoint;
        if (segIndex === 1) {
          // For the first connection, determine previous segment's orientation
          if (selectedSegments.length > 1) {
            const nextSegmentName = selectedSegments[1];
            const nextMetrics = segmentMetrics[nextSegmentName];

            if (nextMetrics) {
              const distances = [
                getDistance(prevEnd, currentStart),
                getDistance(prevEnd, currentEnd),
                getDistance(prevStart, currentStart),
                getDistance(prevStart, currentEnd),
              ];

              const minIndex = distances.indexOf(Math.min(...distances));
              prevLastPoint =
                minIndex === 2 || minIndex === 3 ? prevStart : prevEnd;
            } else {
              prevLastPoint = prevEnd;
            }
          } else {
            prevLastPoint = prevEnd;
          }
        } else {
          // For subsequent segments, assume the previous one ended correctly
          prevLastPoint = prevEnd; // This would need to be tracked better, but simplified for now
        }

        const distanceToStart = getDistance(prevLastPoint, currentStart);
        const distanceToEnd = getDistance(prevLastPoint, currentEnd);

        isReversed = distanceToEnd < distanceToStart;
      }
    } else if (selectedSegments.length > 1) {
      // For first segment, check orientation with second segment
      const nextSegmentName = selectedSegments[1];
      const nextMetrics = segmentMetrics[nextSegmentName];

      if (nextMetrics) {
        const firstStart = metrics.startPoint;
        const firstEnd = metrics.endPoint;
        const nextStart = nextMetrics.startPoint;
        const nextEnd = nextMetrics.endPoint;

        const distances = [
          getDistance(firstEnd, nextStart),
          getDistance(firstEnd, nextEnd),
          getDistance(firstStart, nextStart),
          getDistance(firstStart, nextEnd),
        ];

        const minIndex = distances.indexOf(Math.min(...distances));
        isReversed = minIndex === 2 || minIndex === 3;
      }
    }

    // Use pre-calculated elevation data based on direction
    if (isReversed) {
      totalElevationGain += metrics.reverse.elevationGain;
      totalElevationLoss += metrics.reverse.elevationLoss;
    } else {
      totalElevationGain += metrics.forward.elevationGain;
      totalElevationLoss += metrics.forward.elevationLoss;
    }
  }

  totalElevationGain = Math.round(totalElevationGain);
  totalElevationLoss = Math.round(totalElevationLoss);

  const totalDistanceKm = (totalDistance / 1000).toFixed(1);

  const elevationProfile = generateElevationProfile();

  routeDescription.innerHTML = `
    <strong>מרחק:</strong> ${totalDistanceKm} ק"מ • <strong>⬆️</strong> ${totalElevationGain} מ' • <strong>⬇️</strong> ${totalElevationLoss} מ'
    ${elevationProfile}
  `;

  downloadButton.disabled = false;
  updateRouteWarning();
  updateUndoRedoButtons(); // Update reset button state

  // Add elevation profile hover functionality after DOM is updated
  setTimeout(() => {
    const elevationOverlay = document.querySelector(".elevation-hover-overlay");
    if (elevationOverlay && window.currentElevationData) {
      // Common function to handle both mouse and touch events
      const handleElevationInteraction = (clientX) => {
        const rect = elevationOverlay.getBoundingClientRect();
        const x = clientX - rect.left;
        const xPercent = (x / rect.width) * 100;

        // Find closest elevation data point
        let closestPoint = null;
        let minDistance = Infinity;

        window.currentElevationData.forEach((point) => {
          const distance = Math.abs(point.distancePercent - xPercent);
          if (distance < minDistance) {
            minDistance = distance;
            closestPoint = point;
          }
        });

        if (closestPoint) {
          // Remove existing elevation marker if any
          if (window.elevationMarker) {
            window.elevationMarker.remove();
          }

          // Create red circle marker
          const el = document.createElement("div");
          el.className = "elevation-marker";
          el.style.cssText = `
            width: 16px;
            height: 16px;
            background: ${COLORS.ELEVATION_MARKER};
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 2px 8px rgba(255, 0, 0, 0.6);
            cursor: pointer;
          `;

          window.elevationMarker = new mapboxgl.Marker(el)
            .setLngLat([closestPoint.coord.lng, closestPoint.coord.lat])
            .addTo(map);

          // Update segment display with elevation info
          const segmentDisplay = document.getElementById(
            "segment-name-display",
          );
          segmentDisplay.innerHTML = `📍 מרחק: ${(closestPoint.distance / 1000).toFixed(1)} km • גובה: ${Math.round(closestPoint.elevation)} m`;
          segmentDisplay.style.display = "block";
        }
      };

      const handleElevationLeave = () => {
        // Remove elevation marker
        if (window.elevationMarker) {
          window.elevationMarker.remove();
          window.elevationMarker = null;
        }

        // Hide segment display
        const segmentDisplay = document.getElementById("segment-name-display");
        segmentDisplay.style.display = "none";
      };

      // Mouse events for desktop
      elevationOverlay.addEventListener("mousemove", (e) => {
        handleElevationInteraction(e.clientX);
      });

      elevationOverlay.addEventListener("mouseleave", handleElevationLeave);

      // Touch events for mobile
      elevationOverlay.addEventListener("touchstart", (e) => {
        e.preventDefault(); // Prevent scrolling
        const touch = e.touches[0];
        handleElevationInteraction(touch.clientX);
      });

      elevationOverlay.addEventListener("touchmove", (e) => {
        e.preventDefault(); // Prevent scrolling
        const touch = e.touches[0];
        handleElevationInteraction(touch.clientX);
      });

      elevationOverlay.addEventListener("touchend", (e) => {
        e.preventDefault();
        // Don't hide immediately on touch end to allow viewing
        // Instead, hide after a delay
        setTimeout(handleElevationLeave, 2000);
      });

      elevationOverlay.addEventListener("touchcancel", (e) => {
        e.preventDefault();
        handleElevationLeave();
      });
    }
  }, 100);
}

function removeSegment(segmentName) {
  const index = selectedSegments.indexOf(segmentName);
  if (index > -1) {
    saveState();
    selectedSegments.splice(index, 1);

    // Reset polyline to original style
    const polyline = routePolylines.find((p) => p.segmentName === segmentName);
    if (polyline) {
      map.setPaintProperty(
        polyline.layerId,
        "line-color",
        polyline.originalStyle.color,
      );
      map.setPaintProperty(
        polyline.layerId,
        "line-width",
        polyline.originalStyle.weight,
      );
    }

    updateSegmentStyles();
    updateRouteListAndDescription();
    updateRouteWarning(); // Ensure warnings are updated after removal
    clearRouteFromUrl(); // Clear route parameter when removing segments
  }
}

// Function to calculate bounding box of all segments
function getSegmentsBoundingBox() {
  if (!routePolylines || routePolylines.length === 0) {
    return null;
  }

  let minLat = Infinity,
    maxLat = -Infinity;
  let minLng = Infinity,
    maxLng = -Infinity;

  routePolylines.forEach((polylineData) => {
    polylineData.coordinates.forEach((coord) => {
      minLat = Math.min(minLat, coord.lat);
      maxLat = Math.max(maxLat, coord.lat);
      minLng = Math.min(minLng, coord.lng);
      maxLng = Math.max(maxLng, coord.lng);
    });
  });

  // Extend by approximately 5km (roughly 0.045 degrees)
  const extension = 0.045;

  return {
    minLat: minLat - extension,
    maxLat: maxLat + extension,
    minLng: minLng - extension,
    maxLng: maxLng + extension,
  };
}

// Function to check if point is within bounding box
function isPointWithinBounds(lat, lng, bounds) {
  return (
    lat >= bounds.minLat &&
    lat <= bounds.maxLat &&
    lng >= bounds.minLng &&
    lng <= bounds.maxLng
  );
}

// Function to zoom out and show all segments
function zoomToShowAllSegments() {
  if (!routePolylines || routePolylines.length === 0) {
    return;
  }

  let bounds = new mapboxgl.LngLatBounds();

  // Add all segment coordinates to bounds
  routePolylines.forEach((polylineData) => {
    polylineData.coordinates.forEach((coord) => {
      bounds.extend([coord.lng, coord.lat]);
    });
  });

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, {
      padding: 50,
      duration: 1000,
    });
  }
}

// Function to show location warning modal
function showLocationWarningModal() {
  const modal = document.createElement("div");
  modal.className = "location-warning-modal";
  modal.innerHTML = `
    <div class="location-warning-modal-content">
      <div class="location-warning-modal-header">
        <h3>⚠️ מיקום מחוץ לאזור המפה</h3>
        <button class="location-warning-modal-close">&times;</button>
      </div>
      <div class="location-warning-modal-body">
        <p>אין לנו עדיין שבילים במפה במקום זה</p>
        <p>המפה מכסה כרגע את אזור הגליל העליון והגולן בלבד</p>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add event listeners
  const closeBtn = modal.querySelector(".location-warning-modal-close");

  closeBtn.addEventListener("click", () => {
    document.body.removeChild(modal);
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  // Add escape key listener
  const handleEscape = (e) => {
    if (e.key === "Escape") {
      document.body.removeChild(modal);
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);
}

// Search functionality
function searchLocation() {
  const searchInput = document.getElementById("location-search");
  const searchError = document.getElementById("search-error");
  const query = searchInput.value.trim();

  if (!query) {
    searchError.textContent = "נא להכניס מיקום לחיפוש";
    searchError.style.display = "block";
    return;
  }

  searchError.style.display = "none";

  // Use Nominatim (OpenStreetMap) geocoding service
  const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;

  fetch(geocodeUrl)
    .then((response) => response.json())
    .then((data) => {
      if (data && data.length > 0) {
        const result = data[0];
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);

        // Check if the location is within our segments bounding box
        const bounds = getSegmentsBoundingBox();
        if (bounds && !isPointWithinBounds(lat, lon, bounds)) {
          // Zoom out to show all segments before showing warning
          zoomToShowAllSegments();

          // Show warning after a brief delay to allow zoom animation
          setTimeout(() => {
            showLocationWarningModal();
          }, 500);

          searchInput.value = "";
          return;
        }

        // Only pan to the location without showing markers or popups
        map.flyTo({
          center: [lon, lat],
          zoom: 11.5,
          duration: 1000,
        });

        searchInput.value = "";
      } else {
        searchError.textContent = "מיקום לא נמצא. נא לנסות מונח חיפוש אחר.";
        searchError.style.display = "block";
      }
    })
    .catch((error) => {
      console.error("Search error:", error);
      searchError.textContent = "שגיאה בחיפוש מיקום. נא לנסות שוב.";
      searchError.style.display = "block";
    });
}

// Function to scroll to top of page
function returnToStartingPosition() {
  // Clear URL hash
  if (window.location.hash) {
    history.pushState(
      null,
      null,
      window.location.pathname + window.location.search,
    );
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

function showDownloadModal() {
  // Create modal elements
  const modal = document.createElement("div");
  modal.className = "download-modal";
  modal.innerHTML = `
    <div class="download-modal-content">
      <div class="download-modal-header">
        <h3>הורדת מסלול GPX</h3>
        <button class="download-modal-close">&times;</button>
      </div>
      <div class="download-modal-body">
        <h4>קטעי מסלול נבחרים</h4>
        <div id="route-segments-list"></div>

        <h4>תיאור המסלול</h4>
        <div id="download-route-description"></div>

        <div class="download-modal-actions">
          <button id="download-gpx-final" class="download-confirm-btn">📥 הורדת GPX</button>
          <button id="share-route-modal" class="share-final-btn" title="שיתוף מסלול">🔗 שיתוף מסלול</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Populate route segments list
  const routeSegmentsList = modal.querySelector("#route-segments-list");
  if (selectedSegments.length === 0) {
    routeSegmentsList.innerHTML =
      '<p style="color: #666; font-style: italic;">אין קטעים נבחרים</p>';
  } else {
    let segmentsHtml = '<div class="modal-route-list">';
    selectedSegments.forEach((segmentName, index) => {
      // Check for warnings
      let warningIcons = "";
      const segmentInfo = segmentsData[segmentName];
      // if (segmentInfo) {
      //   if (segmentInfo.winter === false) {
      //     warningIcons += ' ❄️';
      //   }
      //   if (segmentInfo.warning) {
      //     warningIcons += ' ⚠️';
      //   }
      // }

      segmentsHtml += `
        <div class="modal-segment-item">
          <span><strong>${index + 1}.</strong> ${segmentName}${warningIcons}</span>
      `;

      // Add warning details below the segment name
      if (segmentInfo) {
        if (segmentInfo.winter === false) {
          segmentsHtml += `
            <div style="color: #ff9800; font-size: 12px; margin-top: 5px; margin-right: 20px;">
              ❄️ מסלול בוצי בחורף
            </div>
          `;
        }
        if (segmentInfo.warning) {
          segmentsHtml += `
            <div style="color: #f44336; font-size: 12px; margin-top: 5px; margin-right: 20px;">
              ⚠️ ${segmentInfo.warning}
            </div>
          `;
        }
      }

      segmentsHtml += "</div>";
    });
    segmentsHtml += "</div>";
    routeSegmentsList.innerHTML = segmentsHtml;
  }

  // Populate route description
  const downloadRouteDescription = modal.querySelector(
    "#download-route-description",
  );
  downloadRouteDescription.innerHTML =
    document.getElementById("route-description").innerHTML;

  // Add event listeners
  const closeBtn = modal.querySelector(".download-modal-close");
  const downloadBtn = modal.querySelector("#download-gpx-final");
  const shareBtn = modal.querySelector("#share-route-modal");

  closeBtn.addEventListener("click", () => {
    document.body.removeChild(modal);
  });

  downloadBtn.addEventListener("click", () => {
    downloadGPX();
    document.body.removeChild(modal);
  });

  shareBtn.addEventListener("click", () => {
    shareRoute();
    document.body.removeChild(modal);
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  // Add escape key listener
  const handleEscape = (e) => {
    if (e.key === "Escape") {
      document.body.removeChild(modal);
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);
}

function downloadGPX() {
  if (!kmlData) return;

  const orderedCoords = getOrderedCoordinates();

  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="BikeRoutePlanner" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <trk>
    <name>מסלול רכיבה מתוכנן</name>
    <trkseg>`;

  orderedCoords.forEach((coord) => {
    // Use actual elevation from coordinates if available, otherwise calculate
    let elevation;
    if (coord.elevation !== undefined) {
      elevation = coord.elevation;
    } else {
      // Fallback: calculate elevation based on position (simulated)
      elevation =
        200 + Math.sin(coord.lat * 10) * 100 + Math.cos(coord.lng * 8) * 50;
    }
    gpx += `
      <trkpt lat="${coord.lat}" lon="${coord.lng}">
        <ele>${Math.round(elevation)}</ele>
      </trkpt>`;
  });

  gpx += `
    </trkseg>
  </trk>
</gpx>`;

  // Generate filename using encoded route (first 32 characters)
  const routeEncoding = encodeRoute(selectedSegments);
  const filename = routeEncoding
    ? `route_${routeEncoding.substring(0, 32)}.gpx`
    : "bike_route.gpx";

  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Hash navigation functionality
function handleHashNavigation() {
  const hash = window.location.hash.substring(1); // Remove the # symbol
  if (hash) {
    const section = document.getElementById(hash);
    if (section) {
      section.scrollIntoView({ behavior: "smooth" });
    }
  }
}

// Function to scroll to section and update URL hash
function scrollToSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (section) {
    // Update URL hash without triggering page reload
    history.pushState(null, null, `#${sectionId}`);
    section.scrollIntoView({ behavior: "smooth" });
  }
}

// Event listeners
document.addEventListener("DOMContentLoaded", function () {
  // Initialize the map when page loads
  initMap();

  // Handle initial hash navigation on page load
  handleHashNavigation();

  // Handle hash changes (back/forward browser navigation)
  window.addEventListener("hashchange", handleHashNavigation);

  // Download GPX functionality
  document.getElementById("download-gpx").addEventListener("click", () => {
    showDownloadModal();
  });

  // Search functionality
  document
    .getElementById("search-btn")
    .addEventListener("click", searchLocation);
  document
    .getElementById("location-search")
    .addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        searchLocation();
      }
    });

  // Undo/redo buttons
  document.getElementById("undo-btn").addEventListener("click", undo);
  document.getElementById("redo-btn").addEventListener("click", redo);

  // Reset button
  document.getElementById("reset-btn").addEventListener("click", () => {
    if (selectedSegments.length > 0) {
      showResetModal();
    } else {
      resetRoute();
    }
  });

  // Warning box click handlers
  document
    .getElementById("route-warning")
    .addEventListener("click", function () {
      const continuityResult = checkRouteContinuity();
      if (
        !continuityResult.isContinuous &&
        continuityResult.brokenSegmentIndex >= 0
      ) {
        // Focus on the segment that caused the break (the one after the broken connection)
        const breakingSegmentIndex = continuityResult.brokenSegmentIndex + 1;
        if (breakingSegmentIndex < selectedSegments.length) {
          const segmentName = selectedSegments[breakingSegmentIndex];
          focusOnSegment(segmentName);
        }
      }
    });

  document
    .getElementById("winter-warning")
    .addEventListener("click", function () {
      const winterResult = hasWinterSegments();
      if (winterResult.hasWinter && winterResult.winterSegments.length > 0) {
        // Initialize index if not set
        if (window.winterWarningIndex === undefined) {
          window.winterWarningIndex = 0;
        }

        // Focus on current segment
        const segmentName =
          winterResult.winterSegments[window.winterWarningIndex];
        focusOnSegment(segmentName);

        // Move to next segment for next click
        window.winterWarningIndex =
          (window.winterWarningIndex + 1) % winterResult.winterSegments.length;
      }
    });

  document
    .getElementById("segment-warning")
    .addEventListener("click", function () {
      const warningsResult = hasSegmentWarnings();
      if (
        warningsResult.hasWarnings &&
        warningsResult.warningSegments.length > 0
      ) {
        // Initialize index if not set
        if (window.segmentWarningIndex === undefined) {
          window.segmentWarningIndex = 0;
        }

        // Focus on current segment
        const segmentName =
          warningsResult.warningSegments[window.segmentWarningIndex];
        focusOnSegment(segmentName);

        // Move to next segment for next click
        window.segmentWarningIndex =
          (window.segmentWarningIndex + 1) %
          warningsResult.warningSegments.length;
      }
    });

  // Help tutorial button
  const helpBtn = document.getElementById("help-tutorial-btn");
  if (helpBtn) {
    helpBtn.addEventListener("click", () => {
      if (
        typeof tutorial !== "undefined" &&
        tutorial !== null &&
        typeof tutorial.startManually === "function"
      ) {
        tutorial.startManually();
      } else {
        console.warn("Tutorial not available");
      }
    });
  }

  // Mobile menu toggle
  const mobileMenuBtn = document.getElementById("mobile-menu-btn");
  const navLinks = document.getElementById("nav-links");

  if (mobileMenuBtn && navLinks) {
    // Function to manage z-index when menu opens/closes
    const manageZIndex = (isMenuOpen) => {
      const searchContainer = document.querySelector(".search-container");
      const legendContainer = document.querySelector(".legend-container");

      if (isMenuOpen) {
        // Store original z-index values and set to lower values
        if (searchContainer) {
          searchContainer.dataset.originalZIndex =
            getComputedStyle(searchContainer).zIndex;
          searchContainer.style.zIndex = "100";
        }
        if (legendContainer) {
          legendContainer.dataset.originalZIndex =
            getComputedStyle(legendContainer).zIndex;
          legendContainer.style.zIndex = "100";
        }
      } else {
        // Restore original z-index values
        if (searchContainer && searchContainer.dataset.originalZIndex) {
          if (searchContainer.dataset.originalZIndex === "auto") {
            searchContainer.style.zIndex = "";
          } else {
            searchContainer.style.zIndex =
              searchContainer.dataset.originalZIndex;
          }
          delete searchContainer.dataset.originalZIndex;
        }
        if (legendContainer && legendContainer.dataset.originalZIndex) {
          if (legendContainer.dataset.originalZIndex === "auto") {
            legendContainer.style.zIndex = "";
          } else {
            legendContainer.style.zIndex =
              legendContainer.dataset.originalZIndex;
          }
          delete legendContainer.dataset.originalZIndex;
        }
      }
    };

    mobileMenuBtn.addEventListener("click", () => {
      const isMenuOpen = !navLinks.classList.contains("active");
      navLinks.classList.toggle("active");
      manageZIndex(isMenuOpen);
    });

    // Close menu when clicking on a nav link
    const navLinkItems = navLinks.querySelectorAll(".nav-link");
    navLinkItems.forEach((link) => {
      link.addEventListener("click", () => {
        navLinks.classList.remove("active");
        manageZIndex(false);
      });
    });

    // Close menu when clicking outside
    document.addEventListener("click", (e) => {
      if (!mobileMenuBtn.contains(e.target) && !navLinks.contains(e.target)) {
        if (navLinks.classList.contains("active")) {
          navLinks.classList.remove("active");
          manageZIndex(false);
        }
      }
    });
  }

  // Keyboard shortcuts for undo/redo and export
  document.addEventListener("keydown", function (e) {
    //console.log('e.ctrlKey:' + e.ctrlKey + ' key:' + e.key)

    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "Z") {
      e.preventDefault();
      redo();
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "D") {
      e.preventDefault();
      showExportModal();
    }
  });
});

const ROUTE_VERSION = 2;

// RouteManager is imported from route-manager.js