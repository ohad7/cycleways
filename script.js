let map;
let selectedSegments = [];
let routePolylines = [];
let undoStack = [];
let redoStack = [];
let kmlData = null;
let segmentsData = null;

const COLORS = {
  WARNING_ORANGE: '#ff9800',
  WARNING_RED: '#f44336',
  SEGMENT_SELECTED: '#00ff00', // Green for selected segments
  SEGMENT_HOVER: '#ff6600', // Orange for hovered segments
  SEGMENT_HOVER_SELECTED: '#00dd00', // Brighter green when hovering over a selected segment
  SEGMENT_SIDEBAR_HOVER: '#654321', // Brown when hovering a segment in the sidebar
  ELEVATION_MARKER: '#ff4444', // Red for the elevation marker
};

// Save state for undo/redo
function saveState() {
  undoStack.push([...selectedSegments]);
  redoStack = []; // Clear redo stack when new action is performed
  updateUndoRedoButtons();
  clearRouteFromUrl(); // Clear route parameter when making changes
}

function clearRouteFromUrl() {
  const url = new URL(window.location);
  if (url.searchParams.has('route')) {
    url.searchParams.delete('route');
    window.history.replaceState({}, document.title, url.toString());
  }
}

function undo() {
  if (undoStack.length > 0) {
    redoStack.push([...selectedSegments]);
    selectedSegments = undoStack.pop();
    updateSegmentStyles();
    updateRouteListAndDescription();
    updateUndoRedoButtons();
    clearRouteFromUrl(); // Clear route parameter on undo
  }
}

function redo() {
  if (redoStack.length > 0) {
    undoStack.push([...selectedSegments]);
    selectedSegments = redoStack.pop();
    updateSegmentStyles();
    updateRouteListAndDescription();
    updateUndoRedoButtons();
    clearRouteFromUrl(); // Clear route parameter on redo
  }
}

function updateUndoRedoButtons() {
  document.getElementById('undo-btn').disabled = undoStack.length === 0;
  document.getElementById('redo-btn').disabled = redoStack.length === 0;
}

function resetRoute() {
  // Save current state for potential undo
  if (selectedSegments.length > 0) {
    saveState();
  }

  // Clear selected segments
  selectedSegments = [];

  // Clear undo/redo stacks
  undoStack = [];
  redoStack = [];

  // Reset all segment styles to original
  routePolylines.forEach(polylineData => {
    const layerId = polylineData.layerId;
    map.setPaintProperty(layerId, 'line-color', polylineData.originalStyle.color);
    map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight);
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
  const segmentDisplay = document.getElementById('segment-name-display');
  segmentDisplay.style.display = 'none';

  // Update UI
  updateRouteListAndDescription();
  updateUndoRedoButtons();
  clearRouteFromUrl(); // Clear route parameter when resetting
}

function updateSegmentStyles() {
  routePolylines.forEach(polylineData => {
    const layerId = polylineData.layerId;
    // Check if layer exists before trying to set properties
    if (map.getLayer(layerId)) {
      if (selectedSegments.includes(polylineData.segmentName)) {
        map.setPaintProperty(layerId, 'line-color', COLORS.SEGMENT_SELECTED);
        map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight + 1);
      } else {
        map.setPaintProperty(layerId, 'line-color', polylineData.originalStyle.color);
        map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight);
      }
    }
  });
}

function initMap() {
  try {
    mapboxgl.accessToken = 'pk.eyJ1Ijoib3NlcmZhdHkiLCJhIjoiY21kNmdzb3NnMDlqZTJrc2NzNmh3aGk1aCJ9.dvA6QY0N5pQ2IISZHp53kg';

    map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: [35.617497, 33.183536], // Centered on the bike routes area
      zoom: 11.5
    });

    // Set Hebrew language after map loads
    map.on('load', () => {
      map.setLayoutProperty('country-label', 'text-field', [
        'get',
        ['literal', 'name_he'],
        ['literal', 'name']
      ]);
      map.setLayoutProperty('state-label', 'text-field', [
        'get',
        ['literal', 'name_he'],
        ['literal', 'name']
      ]);
      map.setLayoutProperty('settlement-label', 'text-field', [
        'get',
        ['literal', 'name_he'],
        ['literal', 'name']
      ]);
      loadKMLFile();
    });



    // Add global mouse move handler for proximity-based highlighting
    map.on('mousemove', (e) => {
      const mousePoint = e.lngLat;
      const mousePixel = map.project(mousePoint);
      const threshold = 15; // pixels
      let closestSegment = null;
      let minDistance = Infinity;

      // Find closest segment within threshold
      routePolylines.forEach(polylineData => {
        const coords = polylineData.coordinates;
        for (let i = 0; i < coords.length - 1; i++) {
          const startPixel = map.project([coords[i].lng, coords[i].lat]);
          const endPixel = map.project([coords[i + 1].lng, coords[i + 1].lat]);

          const distance = distanceToLineSegmentPixels(
            mousePixel,
            startPixel,
            endPixel
          );

          if (distance < threshold && distance < minDistance) {
            minDistance = distance;
            closestSegment = polylineData;
          }
        }
      });

      // Reset all segments to normal style first
      routePolylines.forEach(polylineData => {
        const layerId = polylineData.layerId;
        if (selectedSegments.includes(polylineData.segmentName)) {
          // Keep selected segments green
          map.setPaintProperty(layerId, 'line-color', COLORS.SEGMENT_SELECTED);
          map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight + 1);
        } else {
          // Reset non-selected segments to original style
          map.setPaintProperty(layerId, 'line-color', polylineData.originalStyle.color);
          map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight);
        }
      });

      // Highlight closest segment if found
      if (closestSegment) {
        const layerId = closestSegment.layerId;
        map.getCanvas().style.cursor = 'pointer';

        if (!selectedSegments.includes(closestSegment.segmentName)) {
          // Highlight non-selected segment
          map.setPaintProperty(layerId, 'line-color', COLORS.SEGMENT_HOVER);
          map.setPaintProperty(layerId, 'line-width', closestSegment.originalStyle.weight + 2);
        } else {
          // Make selected segment more prominent
          map.setPaintProperty(layerId, 'line-color', COLORS.SEGMENT_HOVER_SELECTED);
          map.setPaintProperty(layerId, 'line-width', closestSegment.originalStyle.weight + 3);
        }

        // Show segment info
        const name = closestSegment.segmentName;
        let segmentDistance = 0;
        for (let i = 0; i < closestSegment.coordinates.length - 1; i++) {
          segmentDistance += getDistance(closestSegment.coordinates[i], closestSegment.coordinates[i + 1]);
        }
        const segmentDistanceKm = (segmentDistance / 1000).toFixed(1);
        const segmentElevationGain = Math.round(closestSegment.coordinates.length * 0.4);
        const segmentElevationLoss = Math.round(closestSegment.coordinates.length * 0.3);

        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.innerHTML = `<strong>${name}</strong> • 📏 ${segmentDistanceKm} ק"מ • ⬆️ ${segmentElevationGain} מ' • ⬇️ ${segmentElevationLoss} מ'`;

        // Check for warnings in segments data and add to segment display
        const segmentInfo = segmentsData[name];
        if (segmentInfo) {
          if (segmentInfo.winter === false) {
            segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_ORANGE}; font-size: 12px; margin-top: 5px;">❄️ מסלול בוצי בחורף</div>`;
          }
          if (segmentInfo.warning) {
            segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_RED}; font-size: 12px; margin-top: 5px;">⚠️ ${segmentInfo.warning}</div>`;
          }
        }

        segmentDisplay.style.display = 'block';
      } else {
        // No segment close enough - reset cursor and hide display
        map.getCanvas().style.cursor = '';
        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.style.display = 'none';
      }
    });

    // Add global click handler for proximity-based selection
    map.on('click', (e) => {
      const clickPoint = e.lngLat;
      const clickPixel = map.project(clickPoint);
      const threshold = 15; // pixels
      let closestSegment = null;
      let minDistance = Infinity;

      // Find closest segment within threshold
      routePolylines.forEach(polylineData => {
        const coords = polylineData.coordinates;
        for (let i = 0; i < coords.length - 1; i++) {
          const startPixel = map.project([coords[i].lng, coords[i].lat]);
          const endPixel = map.project([coords[i + 1].lng, coords[i + 1].lat]);

          const distance = distanceToLineSegmentPixels(
            clickPixel,
            startPixel,
            endPixel
          );

          if (distance < threshold && distance < minDistance) {
            minDistance = distance;
            closestSegment = polylineData;
          }
        }
      });

      // Select/deselect closest segment if found
      if (closestSegment) {
        const name = closestSegment.segmentName;
        const layerId = closestSegment.layerId;

        if (!selectedSegments.includes(name)) {
          saveState();
          selectedSegments.push(name);
          map.setPaintProperty(layerId, 'line-color', COLORS.SEGMENT_SELECTED);
          map.setPaintProperty(layerId, 'line-width', closestSegment.originalStyle.weight + 1);

          // Smart focusing logic (same as before)
          if (closestSegment.coordinates.length > 0 && selectedSegments.length > 1) {
            const previousSegmentName = selectedSegments[selectedSegments.length - 2];
            const previousPolyline = routePolylines.find(p => p.segmentName === previousSegmentName);

            if (previousPolyline) {
              const prevCoords = previousPolyline.coordinates;
              const prevStart = prevCoords[0];
              const prevEnd = prevCoords[prevCoords.length - 1];

              const currentStart = closestSegment.coordinates[0];
              const currentEnd = closestSegment.coordinates[closestSegment.coordinates.length - 1];

              const prevEndToCurrentStart = getDistance(prevEnd, currentStart);
              const prevEndToCurrentEnd = getDistance(prevEnd, currentEnd);
              const prevStartToCurrentStart = getDistance(prevStart, currentStart);
              const prevStartToCurrentEnd = getDistance(prevStart, currentEnd);

              const minDistance = Math.min(prevEndToCurrentStart, prevEndToCurrentEnd, prevStartToCurrentStart, prevStartToCurrentEnd);

              let focusPoint;
              if (minDistance === prevEndToCurrentStart) {
                focusPoint = [currentEnd.lng, currentEnd.lat];
              } else if (minDistance === prevEndToCurrentEnd) {
                focusPoint = [currentStart.lng, currentStart.lat];
              } else if (minDistance === prevStartToCurrentStart) {
                focusPoint = [currentEnd.lng, currentEnd.lat];
              } else {
                focusPoint = [currentStart.lng, currentStart.lat];
              }

              map.panTo(focusPoint, {
                duration: 1000
              });
            }
          }
        } else {
          saveState();
          const index = selectedSegments.indexOf(name);
          selectedSegments.splice(index, 1);
          map.setPaintProperty(layerId, 'line-color', closestSegment.originalStyle.color);
          map.setPaintProperty(layerId, 'line-width', closestSegment.originalStyle.weight);
        }
        updateRouteListAndDescription();
      }
    });

  } catch (error) {
    document.getElementById('error-message').style.display = 'block';
    document.getElementById('error-message').textContent = 'Error loading map: ' + error.message;
  }
}

// Route sharing functions
function encodeRoute(segmentNames) {
  if (!segmentNames || segmentNames.length === 0) return '';

  // Convert segment names to IDs using segments data
  const segmentIds = segmentNames.map(name => {
    const segmentInfo = segmentsData[name];
    return segmentInfo ? segmentInfo.id : 0;
  }).filter(id => id > 0);

  if (segmentIds.length === 0) return '';

  // Convert to 16-bit binary representation
  const binaryData = new ArrayBuffer(segmentIds.length * 2);
  const view = new Uint16Array(binaryData);

  segmentIds.forEach((id, index) => {
    view[index] = id;
  });

  // Convert to base64
  const uint8Array = new Uint8Array(binaryData);
  let binaryString = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binaryString += String.fromCharCode(uint8Array[i]);
  }

  return btoa(binaryString);
}

function decodeRoute(routeString) {
  if (!routeString) return [];

  try {
    // Decode from base64
    const binaryString = atob(routeString);
    const binaryData = new ArrayBuffer(binaryString.length);
    const uint8Array = new Uint8Array(binaryData);

    for (let i = 0; i < binaryString.length; i++) {
      uint8Array[i] = binaryString.charCodeAt(i);
    }

    // Convert back to 16-bit integers
    const view = new Uint16Array(binaryData);
    const segmentIds = Array.from(view);

    // Convert IDs back to segment names
    const segmentNames = [];
    for (const segmentName in segmentsData) {
      const segmentInfo = segmentsData[segmentName];
      if (segmentInfo && segmentIds.includes(segmentInfo.id)) {
        const index = segmentIds.indexOf(segmentInfo.id);
        segmentNames[index] = segmentName;
      }
    }

    return segmentNames.filter(name => name); // Remove empty slots
  } catch (error) {
    console.error('Error decoding route:', error);
    return [];
  }
}

function shareRoute() {
  const routeId = encodeRoute(selectedSegments);
  if (!routeId) {
    alert('אין מסלול לשיתוף. בחרו קטעים כדי ליצור מסלול.');
    return;
  }

  const url = new URL(window.location);
  url.searchParams.set('route', routeId);
  const shareUrl = url.toString();

  // Show share modal
  showShareModal(shareUrl);
}

function showShareModal(shareUrl) {
  // Create modal elements
  const modal = document.createElement('div');
  modal.className = 'share-modal';
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
  const closeBtn = modal.querySelector('.share-modal-close');
  const copyBtn = modal.querySelector('.copy-url-btn');
  const urlInput = modal.querySelector('.share-url-input');

  closeBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  copyBtn.addEventListener('click', () => {
    urlInput.select();
    navigator.clipboard.writeText(shareUrl).then(() => {
      copyBtn.textContent = 'הועתק!';
      copyBtn.style.background = '#4CAF50';
      setTimeout(() => {
        copyBtn.textContent = 'העתק קישור';
        copyBtn.style.background = '#4682B4';
      }, 2000);
    }).catch(() => {
      document.execCommand('copy');
      copyBtn.textContent = 'הועתק!';
      copyBtn.style.background = '#4CAF50';
      setTimeout(() => {
        copyBtn.textContent = 'העתק קישור';
        copyBtn.style.background = '#4682B4';
      }, 2000);
    });
  });
}

function shareToTwitter(url) {
  const text = 'בדקו את מסלול הרכיבה שיצרתי במפת שבילי אופניים - גליל עליון וגולן!';
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${url}`, '_blank');
}

function shareToFacebook(url) {
  window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank');
}

function shareToWhatsApp(url) {
  const text = 'בדקו את מסלול הרכיבה שיצרתי במפת שבילי אופניים - גליל עליון וגולן!';
  window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + decodeURIComponent(url))}`, '_blank');
}

function getRouteParameter() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('route');
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
  const existing = document.getElementById('route-loading-indicator');
  if (existing) {
    existing.remove();
  }

  const indicator = document.createElement('div');
  indicator.id = 'route-loading-indicator';
  indicator.className = 'route-loading';
  indicator.innerHTML = '⏳ טוען מסלול...';

  const legendContainer = document.querySelector('.legend-container');
  legendContainer.appendChild(indicator);
}

function hideRouteLoadingIndicator() {
  const indicator = document.getElementById('route-loading-indicator');
  if (indicator) {
    indicator.remove();
  }
}

async function loadSegmentsData() {
  try {
    const response = await fetch('./segments.json');
    segmentsData = await response.json();
  } catch (error) {
    console.warn('Could not load segments.json:', error);
    segmentsData = {};
  }
}

async function loadKMLFile() {
  try {
    await loadSegmentsData();
    showRouteLoadingIndicator();
    const response = await fetch('./bike_roads_v03.geojson');
    const geoJsonData = await response.json();
    parseGeoJSON(geoJsonData);

    // Try to load route from URL after everything is loaded
    setTimeout(() => {
      loadRouteFromUrl();
    }, 1000);
  } catch (error) {
    document.getElementById('error-message').style.display = 'block';
    document.getElementById('error-message').textContent = 'Error loading GeoJSON file: ' + error.message;
  }
}

function parseGeoJSON(geoJsonData) {
  try {
    kmlData = JSON.stringify(geoJsonData);

    if (!geoJsonData.features || geoJsonData.features.length === 0) {
      document.getElementById('error-message').style.display = 'block';
      document.getElementById('error-message').textContent = 'No route segments found in the GeoJSON file.';
      return;
    }

    document.getElementById('error-message').style.display = 'none';

    // Clear existing layers and sources
    routePolylines.forEach(polylineData => {
      if (map.getLayer(polylineData.layerId)) {
        map.removeLayer(polylineData.layerId);
      }
      if (map.getSource(polylineData.layerId)) {
        map.removeSource(polylineData.layerId);
      }
    });
    routePolylines = [];

    let bounds = new mapboxgl.LngLatBounds();

    geoJsonData.features.forEach(feature => {
      if (feature.geometry.type !== 'LineString') return;

      const name = feature.properties.name || 'Unnamed Route';
      const coordinates = feature.geometry.coordinates;

      // Convert coordinates from [lng, lat, elevation] to {lat, lng, elevation} objects
      const coordObjects = coordinates.map(coord => ({
        lat: coord[1],
        lng: coord[0],
        elevation: coord[2] // Preserve elevation data if available
      }));

      // Extract style information from properties
      let originalColor = feature.properties.stroke || feature.properties['stroke-color'] || '#0288d1';

      // Convert colors according to specification
      if (originalColor === '#0288d1' || originalColor === 'rgb(2, 136, 209)') {
        originalColor = 'rgb(101, 170, 162)';
      } else if (originalColor == '#e6ee9c' || originalColor === 'rgb(230, 238, 156)') {
        originalColor = 'rgb(138, 147, 158)';
      } else {
        originalColor = 'rgb(174, 144, 103)';
      }

      // temporarily overriding weight and opacity:
      //let originalWeight = feature.properties['stroke-width'] || 3;
      //let originalOpacity = feature.properties['stroke-opacity'] || 0.8;
      let originalWeight = 3;
      let originalOpacity = 0.9;

      const layerId = `route-${name.replace(/\s+/g, '-').replace(/[^\w-]/g, '')}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Add source and layer to map
      map.addSource(layerId, {
        type: 'geojson',
        data: feature
      });

      map.addLayer({
        id: layerId,
        type: 'line',
        source: layerId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': originalColor,
          'line-width': originalWeight,
          'line-opacity': originalOpacity
        }
      });

      // Store polyline data
      const polylineData = {
        segmentName: name,
        layerId: layerId,
        coordinates: coordObjects,
        originalStyle: {
          color: originalColor,
          weight: originalWeight,
          opacity: originalOpacity
        }
      };
      routePolylines.push(polylineData);

      // Add coordinates to bounds for auto-fitting
      coordinates.forEach(coord => bounds.extend(coord));

      // Add hover effects with segment name display
      map.on('mouseenter', layerId, (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (!selectedSegments.includes(name)) {
          map.setPaintProperty(layerId, 'line-width', originalWeight + 2);
          map.setPaintProperty(layerId, 'line-opacity', 1);
        }

        // Calculate segment details
        let segmentDistance = 0;
        for (let i = 0; i < coordObjects.length - 1; i++) {
          segmentDistance += getDistance(coordObjects[i], coordObjects[i + 1]);
        }
        const segmentDistanceKm = (segmentDistance / 1000).toFixed(1);

        // Calculate actual elevation gain and loss from coordinate data
        let segmentElevationGain = 0;
        let segmentElevationLoss = 0;

        for (let i = 0; i < coordObjects.length - 1; i++) {
          let currentElevation, nextElevation;

          if (coordObjects[i].elevation !== undefined) {
            currentElevation = coordObjects[i].elevation;
          } else {
            currentElevation = 200 + Math.sin(coordObjects[i].lat * 10) * 100 + Math.cos(coordObjects[i].lng * 8) * 50;
          }

          if (coordObjects[i + 1].elevation !== undefined) {
            nextElevation = coordObjects[i + 1].elevation;
          } else {
            nextElevation = 200 + Math.sin(coordObjects[i + 1].lat * 10) * 100 + Math.cos(coordObjects[i + 1].lng * 8) * 50;
          }

          const elevationChange = nextElevation - currentElevation;
          if (elevationChange > 0) {
            segmentElevationGain += elevationChange;
          } else {
            segmentElevationLoss += Math.abs(elevationChange);
          }
        }

        segmentElevationGain = Math.round(segmentElevationGain);
        segmentElevationLoss = Math.round(segmentElevationLoss);

        // Update segment name display with details
        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.innerHTML = `<strong>${name}</strong> • 📏 ${segmentDistanceKm} ק"מ • ⬆️ ${segmentElevationGain} מ' • ⬇️ ${segmentElevationLoss} מ'`;
        segmentDisplay.style.display = 'block';

        // Check for warnings in segments data and add to segment display
        const segmentInfo = segmentsData[name];
        if (segmentInfo) {
          if (segmentInfo.winter === false) {
            segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_ORANGE}; font-size: 12px; margin-top: 5px;">❄️ מסלול בוצי בחורף</div>`;
          }
          if (segmentInfo.warning) {
            segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_RED}; font-size: 12px; margin-top: 5px;">⚠️ ${segmentInfo.warning}</div>`;
          }
        }
      });

      // Add hover functionality for selected segments to show distance from start
      map.on('mousemove', layerId, (e) => {
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
                segmentEnd
              );

              const distance = getDistance(
                { lat: hoverPoint.lat, lng: hoverPoint.lng },
                closestPoint
              );

              if (distance < minDistanceToSegment) {
                minDistanceToSegment = distance;
                closestPointOnSegment = closestPoint;
                closestSegmentIndex = i;
              }
            }

            if (closestPointOnSegment && minDistanceToSegment < 100) { // 100 meter threshold
              // Calculate distance from start of route to this point
              let distanceFromStart = 0;

              // Add distance from previous segments
              for (let i = 0; i < selectedSegments.length; i++) {
                const segName = selectedSegments[i];
                if (segName === name) break;

                const prevPolyline = routePolylines.find(p => p.segmentName === segName);
                if (prevPolyline) {
                  for (let j = 0; j < prevPolyline.coordinates.length - 1; j++) {
                    distanceFromStart += getDistance(prevPolyline.coordinates[j], prevPolyline.coordinates[j + 1]);
                  }
                }
              }

              // Add distance within current segment up to hover point
              for (let i = 0; i < closestSegmentIndex; i++) {
                distanceFromStart += getDistance(coordObjects[i], coordObjects[i + 1]);
              }

              // Add partial distance to closest point on segment
              const segmentStart = coordObjects[closestSegmentIndex];
              const segmentEnd = coordObjects[closestSegmentIndex + 1];
              const segmentLength = getDistance(segmentStart, segmentEnd);
              const distanceToClosest = getDistance(segmentStart, closestPointOnSegment);
              const ratio = distanceToClosest / segmentLength;

              if (!isNaN(ratio) && ratio >= 0 && ratio <= 1) {
                distanceFromStart += distanceToClosest;
              }

              const distanceKm = (distanceFromStart / 1000).toFixed(1);

              // Show distance in top right display
              const segmentDisplay = document.getElementById('segment-name-display');
              segmentDisplay.innerHTML = `📍 מרחק מההתחלה: ${distanceKm} ק"מ`;
              segmentDisplay.style.display = 'block';

              // Add visible circle marker at closest point
              if (window.hoverMarker) {
                window.hoverMarker.remove();
              }

              const el = document.createElement('div');
              el.className = 'hover-circle';
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
                .setLngLat([closestPointOnSegment.lng, closestPointOnSegment.lat])
                .addTo(map);
            }
          }
        }
      });

      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
        if (!selectedSegments.includes(name)) {
          map.setPaintProperty(layerId, 'line-width', originalWeight);
          map.setPaintProperty(layerId, 'line-opacity', originalOpacity);
        }

        // Hide segment name display
        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.style.display = 'none';

        // Remove hover marker
        if (window.hoverMarker) {
          window.hoverMarker.remove();          window.hoverMarker = null;
        }
      });
    });

    // Keep map at current position instead of auto-fitting to all segments
    // if (!bounds.isEmpty()) {
    //   map.fitBounds(bounds, { padding: 20 });
    // }

  } catch (error) {
    document.getElementById('error-message').style.display = 'block';
    document.getElementById('error-message').textContent = 'Error parsing GeoJSON file: ' + error.message;
  }
}

// Helper function to calculate distance between two points
function getDistance(point1, point2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = point1.lat * Math.PI / 180;
  const φ2 = point2.lat * Math.PI / 180;
  const Δφ = (point2.lat - point1.lat) * Math.PI / 180;
  const Δλ = (point2.lng - point1.lng) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
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
  if (selectedSegments.length <= 1) return { isContinuous: true, brokenSegmentIndex: -1 };

  const tolerance = 100; // 100 meters tolerance

  for (let i = 0; i < selectedSegments.length - 1; i++) {
    const currentSegmentName = selectedSegments[i];
    const nextSegmentName = selectedSegments[i + 1];

    const currentPolyline = routePolylines.find(p => p.segmentName === currentSegmentName);
    const nextPolyline = routePolylines.find(p => p.segmentName === nextSegmentName);

    if (!currentPolyline || !nextPolyline) continue;

    const currentCoords = currentPolyline.coordinates;
    const nextCoords = nextPolyline.coordinates;

    // Get endpoints of current segment
    const currentStart = currentCoords[0];
    const currentEnd = currentCoords[currentCoords.length - 1];

    // Get endpoints of next segment
    const nextStart = nextCoords[0];
    const nextEnd = nextCoords[nextCoords.length - 1];

    // Check all possible connections
    const distances = [
      getDistance(currentEnd, nextStart),
      getDistance(currentEnd, nextEnd),
      getDistance(currentStart, nextStart),
      getDistance(currentStart, nextEnd)
    ];

    const minDistance = Math.min(...distances);

    // If minimum distance is greater than tolerance, route is broken
    if (minDistance > tolerance) {
      return { isContinuous: false, brokenSegmentIndex: i };
    }
  }

  return { isContinuous: true, brokenSegmentIndex: -1 };
}

// Function to check if any selected segments have winter warning and find first one
function hasWinterSegments() {
  for (let i = 0; i < selectedSegments.length; i++) {
    const segmentInfo = segmentsData[selectedSegments[i]];
    if (segmentInfo && segmentInfo.winter === false) {
      return { hasWinter: true, firstWinterSegment: selectedSegments[i] };
    }
  }
  return { hasWinter: false, firstWinterSegment: null };
}

// Function to check if any selected segments have warnings and find first one
function hasSegmentWarnings() {
  for (let i = 0; i < selectedSegments.length; i++) {
    const segmentInfo = segmentsData[selectedSegments[i]];
    if (segmentInfo && segmentInfo.warning) {
      return { hasWarnings: true, firstWarningSegment: selectedSegments[i] };
    }
  }
  return { hasWarnings: false, firstWarningSegment: null };
}

// Function to update route warning visibility
function updateRouteWarning() {
  const routeWarning = document.getElementById('route-warning');
  const winterWarning = document.getElementById('winter-warning');
  const segmentWarning = document.getElementById('segment-warning');

  const continuityResult = checkRouteContinuity();
  const winterResult = hasWinterSegments();
  const warningsResult = hasSegmentWarnings();

  // Show broken route warning
  if (selectedSegments.length > 1 && !continuityResult.isContinuous) {
    routeWarning.style.display = 'block';
  } else {
    routeWarning.style.display = 'none';
  }

  // Show winter warning
  if (winterResult.hasWinter) {
    winterWarning.style.display = 'block';
  } else {
    winterWarning.style.display = 'none';
  }

  // Show segment warnings indicator
  if (warningsResult.hasWarnings) {
    segmentWarning.style.display = 'block';
  } else {
    segmentWarning.style.display = 'none';
  }
}

// Function to focus map on a specific segment
function focusOnSegment(segmentName) {
  const polyline = routePolylines.find(p => p.segmentName === segmentName);
  if (!polyline) return;

  const coords = polyline.coordinates;
  if (coords.length === 0) return;

  // Calculate bounds for the segment
  let minLat = coords[0].lat, maxLat = coords[0].lat;
  let minLng = coords[0].lng, maxLng = coords[0].lng;

  coords.forEach(coord => {
    minLat = Math.min(minLat, coord.lat);
    maxLat = Math.max(maxLat, coord.lat);
    minLng = Math.min(minLng, coord.lng);
    maxLng = Math.max(maxLng, coord.lng);
  });

  // Add some padding around the segment
  const latPadding = (maxLat - minLat) * 0.2 || 0.01;
  const lngPadding = (maxLng - minLng) * 0.2 || 0.01;

  const bounds = new mapboxgl.LngLatBounds(
    [minLng - lngPadding, minLat - latPadding],
    [maxLng + lngPadding, maxLat + latPadding]
  );

  map.fitBounds(bounds, {
    padding: 50,
    duration: 1000
  });

  // Temporarily highlight the segment
  const layerId = polyline.layerId;
  const originalColor = map.getPaintProperty(layerId, 'line-color');
  const originalWidth = map.getPaintProperty(layerId, 'line-width');

  map.setPaintProperty(layerId, 'line-color', '#ff0000');
  map.setPaintProperty(layerId, 'line-width', originalWidth + 3);

  // Reset after 2 seconds
  setTimeout(() => {
    if (selectedSegments.includes(segmentName)) {
      map.setPaintProperty(layerId, 'line-color', COLORS.SEGMENT_SELECTED);
      map.setPaintProperty(layerId, 'line-width', polyline.originalStyle.weight + 1);
    } else {
      map.setPaintProperty(layerId, 'line-color', polyline.originalStyle.color);
      map.setPaintProperty(layerId, 'line-width', polyline.originalStyle.weight);
    }
  }, 2000);
}

// Function to order coordinates based on route connectivity
function getOrderedCoordinates() {
  if (selectedSegments.length === 0) return [];

  let orderedCoords = [];

  for (let i = 0; i < selectedSegments.length; i++) {
    const segmentName = selectedSegments[i];
    const polyline = routePolylines.find(p => p.segmentName === segmentName);

    if (!polyline) continue;

    let coords = [...polyline.coordinates];

    // For the first segment, check if we need to orient it correctly
    if (i === 0) {
      // If there's a second segment, orient the first segment to connect better
      if (selectedSegments.length > 1) {
        const nextSegmentName = selectedSegments[1];
        const nextPolyline = routePolylines.find(p => p.segmentName === nextSegmentName);

        if (nextPolyline) {
          const nextCoords = nextPolyline.coordinates;
          const firstStart = coords[0];
          const firstEnd = coords[coords.length - 1];
          const nextStart = nextCoords[0];
          const nextEnd = nextCoords[nextCoords.length - 1];

          // Calculate all possible connection distances
          const distances = [
            getDistance(firstEnd, nextStart),    // first end to next start
            getDistance(firstEnd, nextEnd),      // first end to next end
            getDistance(firstStart, nextStart),  // first start to next start
            getDistance(firstStart, nextEnd)     // first start to next end
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

      // Add coordinates (skip first point to avoid duplication if they're very close)
      const firstPoint = coords[0];
      if (getDistance(lastPoint, firstPoint) > 10) { // 10 meters threshold
        orderedCoords.push(...coords);
      } else {
        orderedCoords.push(...coords.slice(1));
      }
    }
  }

  return orderedCoords;
}

// Function to generate elevation profile
function generateElevationProfile() {
  const orderedCoords = getOrderedCoordinates();
  if (orderedCoords.length === 0) return '';

  let elevationHtml = '<div class="elevation-profile">';
  elevationHtml += '<h4>גרף גובה (Elevation Profile)</h4>';
  elevationHtml += '<div class="elevation-chart" id="elevation-chart" style="position: relative;">';

  const totalDistance = orderedCoords.reduce((total, coord, index) => {
    if (index === 0) return 0;
    return total + getDistance(orderedCoords[index - 1], coord);
  }, 0);

  if (totalDistance === 0) {
    elevationHtml += '</div></div>';
    return elevationHtml;
  }

  // Create continuous elevation profile with interpolation
  const profileWidth = 300; // pixels
  const elevationData = [];

  // First, calculate elevation for all coordinates
  const coordsWithElevation = orderedCoords.map((coord, index) => {
    // Use actual elevation from coordinates if available, otherwise calculate
    let elevation;
    if (coord.elevation !== undefined) {
      elevation = coord.elevation;
    } else {
      // Fallback: calculate elevation based on position (simulated)
      elevation = 200 + Math.sin(coord.lat * 10) * 100 + Math.cos(coord.lng * 8) * 50;
    }

    const distance = index === 0 ? 0 : orderedCoords.slice(0, index + 1).reduce((total, c, idx) => {
      if (idx === 0) return 0;
      return total + getDistance(orderedCoords[idx - 1], c);
    }, 0);
    return { ...coord, elevation, distance };
  });

  // Find min/max elevation
  let minElevation = Math.min(...coordsWithElevation.map(c => c.elevation));
  let maxElevation = Math.max(...coordsWithElevation.map(c => c.elevation));
  const elevationRange = maxElevation - minElevation || 100;

  // Create continuous profile by interpolating between points
  for (let x = 0; x <= profileWidth; x++) {
    const distanceAtX = (x / profileWidth) * totalDistance;

    // Find the two closest points to interpolate between
    let beforePoint = null;
    let afterPoint = null;

    for (let i = 0; i < coordsWithElevation.length - 1; i++) {
      if (coordsWithElevation[i].distance <= distanceAtX && coordsWithElevation[i + 1].distance >= distanceAtX) {
        beforePoint = coordsWithElevation[i];
        afterPoint = coordsWithElevation[i + 1];
        break;
      }
    }

    let elevation, coord;
    if (beforePoint && afterPoint && beforePoint !== afterPoint) {
      // Interpolate elevation and coordinates
      const ratio = (distanceAtX - beforePoint.distance) / (afterPoint.distance - beforePoint.distance);
      elevation = beforePoint.elevation + (afterPoint.elevation - beforePoint.elevation) * ratio;
      coord = {
        lat: beforePoint.lat + (afterPoint.lat - beforePoint.lat) * ratio,
        lng: beforePoint.lng + (afterPoint.lng - beforePoint.lng) * ratio
      };
    } else if (beforePoint) {
      elevation = beforePoint.elevation;
      coord = beforePoint;
    } else {
      elevation = coordsWithElevation[0].elevation;
      coord = coordsWithElevation[0];
    }

    const heightPercent = Math.max(5, ((elevation - minElevation) / elevationRange) * 80 + 10);
    const distancePercent = (x / profileWidth) * 100;

    elevationData.push({
      elevation,
      distance: distanceAtX,
      coord,
      heightPercent,
      distancePercent,
      pixelX: x
    });
  }

  // Create continuous elevation profile using SVG path
  let pathData = '';
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
  elevationHtml += '<div class="elevation-hover-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; cursor: pointer;"></div>';

  elevationHtml += '</div>';
  elevationHtml += '<div class="elevation-labels">';
  elevationHtml += `<span class="distance-label">${(totalDistance / 1000).toFixed(1)} ק"מ</span>`;
  elevationHtml += '<span class="distance-label">0 ק"מ</span>';
  elevationHtml += '</div>';
  elevationHtml += '</div>';

  // Store elevation data globally for hover functionality
  window.currentElevationData = elevationData;
  window.currentTotalDistance = totalDistance;

  return elevationHtml;
}

function updateRouteListAndDescription() {
  const routeList = document.getElementById('route-list');
  const routeDescription = document.getElementById('route-description');
  const downloadButton = document.getElementById('download-gpx');

  if (selectedSegments.length === 0) {
    routeList.innerHTML = '<p style="color: #666; font-style: italic;">תכננו מסלול על ידי לחיצה על קטע והוספתו למסלול. ליחצו על הסר כדי להסיר קטע ממסלול. בסיום הורידו קובץ GPX כדי להעלות לאפליקציית הניווט שלכם.</p>';
    routeDescription.innerHTML = 'לחץ על קטעי מפה כדי לבנות את המסלול שלך.';
    downloadButton.disabled = true;
    updateRouteWarning();
    return;
  }

  routeList.innerHTML = '';
  selectedSegments.forEach((segmentName, index) => {
    const segmentDiv = document.createElement('div');
    segmentDiv.className = 'segment-item';

    // Check for warnings
    let warningIcons = '';
    const segmentInfo = segmentsData[segmentName];
    if (segmentInfo) {
      if (segmentInfo.winter === false) {
        warningIcons += ' ❄️';
      }
      if (segmentInfo.warning) {
        warningIcons += ' ⚠️';
      }
    }

    segmentDiv.innerHTML = `
      <span><strong>${index + 1}.</strong> ${segmentName}${warningIcons}</span>
      <button class="remove-btn" onclick="removeSegment('${segmentName}')">הסר</button>
    `;

    // Add hover effects for sidebar segments
    segmentDiv.addEventListener('mouseenter', () => {
      const polyline = routePolylines.find(p => p.segmentName === segmentName);
      if (polyline) {
        map.setPaintProperty(polyline.layerId, 'line-color', COLORS.SEGMENT_SIDEBAR_HOVER);
        map.setPaintProperty(polyline.layerId, 'line-width', polyline.originalStyle.weight + 3);

        // Show segment summary in top right display
        const coordObjects = polyline.coordinates;
        let segmentDistance = 0;
        for (let i = 0; i < coordObjects.length - 1; i++) {
          segmentDistance += getDistance(coordObjects[i], coordObjects[i + 1]);
        }
        const segmentDistanceKm = (segmentDistance / 1000).toFixed(1);
        const segmentElevationGain = Math.round(coordObjects.length * 0.4);
        const segmentElevationLoss = Math.round(coordObjects.length * 0.3);

        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.innerHTML = `<strong>${segmentName}</strong> • 📏 ${segmentDistanceKm} ק"מ • ⬆️ ${segmentElevationGain} מ' • ⬇️ ${segmentElevationLoss} מ'`;
        segmentDisplay.style.display = 'block';

        // Check for warnings in segments data and add to segment display
        const segmentInfo = segmentsData[segmentName];
        if (segmentInfo) {
          if (segmentInfo.winter === false) {
            segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_ORANGE}; font-size: 12px; margin-top: 5px;">❄️ מסלול בוצי בחורף</div>`;
          }
          if (segmentInfo.warning) {
            segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_RED}; font-size: 12px; margin-top: 5px;">⚠️ ${segmentInfo.warning}</div>`;
          }
        }
      }
    });

    segmentDiv.addEventListener('mouseleave', () => {
      const polyline = routePolylines.find(p => p.segmentName === segmentName);
      if (polyline) {
        map.setPaintProperty(polyline.layerId, 'line-color', COLORS.SEGMENT_SELECTED);
        map.setPaintProperty(polyline.layerId, 'line-width', polyline.originalStyle.weight + 1);

        // Hide segment summary display
        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.style.display = 'none';
      }
    });

    routeList.appendChild(segmentDiv);
  });

  // Calculate total distance and elevation changes
  const orderedCoords = getOrderedCoordinates();
  let totalDistance = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;

  for (let i = 0; i < orderedCoords.length - 1; i++) {
    totalDistance += getDistance(orderedCoords[i], orderedCoords[i + 1]);
  }

  // Calculate actual elevation changes from coordinate data
  totalElevationGain = 0;
  totalElevationLoss = 0;

  for (let i = 0; i < orderedCoords.length - 1; i++) {
    let currentElevation, nextElevation;

    if (orderedCoords[i].elevation !== undefined) {
      currentElevation = orderedCoords[i].elevation;
    } else {
      currentElevation = 200 + Math.sin(orderedCoords[i].lat * 10) * 100 + Math.cos(orderedCoords[i].lng * 8) * 50;
    }

    if (orderedCoords[i + 1].elevation !== undefined) {
      nextElevation = orderedCoords[i + 1].elevation;
    } else {
      nextElevation = 200 + Math.sin(orderedCoords[i + 1].lat * 10) * 100 + Math.cos(orderedCoords[i + 1].lng * 8) * 50;
    }

    const elevationChange = nextElevation - currentElevation;
    if (elevationChange > 0) {
      totalElevationGain += elevationChange;
    } else {
      totalElevationLoss += Math.abs(elevationChange);
    }
  }

  totalElevationGain = Math.round(totalElevationGain);
  totalElevationLoss = Math.round(totalElevationLoss);

  const totalDistanceKm = (totalDistance / 1000).toFixed(1);

  const elevationProfile = generateElevationProfile();

  routeDescription.innerHTML = `
    <strong>📏 מרחק:</strong> ${totalDistanceKm} ק"מ
    <strong>⬆️</strong> ${totalElevationGain} מ'
    <strong>⬇️</strong> ${totalElevationLoss} מ'
    ${elevationProfile}
  `;

  downloadButton.disabled = false;
  updateRouteWarning();

  // Add elevation profile hover functionality after DOM is updated
  setTimeout(() => {
    const elevationOverlay = document.querySelector('.elevation-hover-overlay');
    if (elevationOverlay && window.currentElevationData) {
      elevationOverlay.addEventListener('mousemove', (e) => {
        const rect = elevationOverlay.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const xPercent = (x / rect.width) * 100;

        // Find closest elevation data point
        let closestPoint = null;
        let minDistance = Infinity;

        window.currentElevationData.forEach(point => {
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
          const el = document.createElement('div');
          el.className = 'elevation-marker';
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
          const segmentDisplay = document.getElementById('segment-name-display');
          segmentDisplay.innerHTML = `📍 מרחק: ${(closestPoint.distance / 1000).toFixed(1)} ק"מ • גובה: ${Math.round(closestPoint.elevation)} מ'`;
          segmentDisplay.style.display = 'block';
        }
      });

      elevationOverlay.addEventListener('mouseleave', () => {
        // Remove elevation marker
        if (window.elevationMarker) {
          window.elevationMarker.remove();
          window.elevationMarker = null;
        }

        // Hide segment display
        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.style.display = 'none';
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
    const polyline = routePolylines.find(p => p.segmentName === segmentName);
    if (polyline) {
      map.setPaintProperty(polyline.layerId, 'line-color', polyline.originalStyle.color);
      map.setPaintProperty(polyline.layerId, 'line-width', polyline.originalStyle.weight);
    }

    updateSegmentStyles();
    updateRouteListAndDescription();
    clearRouteFromUrl(); // Clear route parameter when removing segments
  }
}

// Search functionality
function searchLocation() {
  const searchInput = document.getElementById('location-search');
  const searchError = document.getElementById('search-error');
  const query = searchInput.value.trim();

  if (!query) {
    searchError.textContent = 'נא להכניס מיקום לחיפוש';
    searchError.style.display = 'block';
    return;
  }

  searchError.style.display = 'none';

  // Use Nominatim (OpenStreetMap) geocoding service
  const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;

  fetch(geocodeUrl)
    .then(response => response.json())
    .then(data => {
      if (data && data.length > 0) {
        const result = data[0];
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);

        // Only pan to the location without showing markers or popups
        const zoomLevel = result.type === 'city' ? 12 :
          result.type === 'town' ? 13 :
            result.type === 'village' ? 14 : 13;

        map.flyTo({
          center: [lon, lat],
          zoom: zoomLevel,
          duration: 1000
        });

        searchInput.value = '';
      } else {
        searchError.textContent = 'מיקום לא נמצא. נא לנסות מונח חיפוש אחר.';
        searchError.style.display = 'block';
      }
    })
    .catch(error => {
      console.error('Search error:', error);
      searchError.textContent = 'שגיאה בחיפוש מיקום. נא לנסות שוב.';
      searchError.style.display = 'block';
    });
}

// Function to scroll to section
function scrollToSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (section) {
    section.scrollIntoView({ behavior: 'smooth' });
  }
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
  // Initialize the map when page loads
  initMap();

  // Download GPX functionality
  document.getElementById('download-gpx').addEventListener('click', () => {
    if (!kmlData) return;

    const orderedCoords = getOrderedCoordinates();

    let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="BikeRoutePlanner" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <trk>
    <name>מסלול רכיבה מתוכנן</name>
    <trkseg>`;

    orderedCoords.forEach(coord => {
      // Use actual elevation from coordinates if available, otherwise calculate
      let elevation;
      if (coord.elevation !== undefined) {
        elevation = coord.elevation;
      } else {
        // Fallback: calculate elevation based on position (simulated)
        elevation = 200 + Math.sin(coord.lat * 10) * 100 + Math.cos(coord.lng * 8) * 50;
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

    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bike_route.gpx';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Search functionality
  document.getElementById('search-btn').addEventListener('click', searchLocation);
  document.getElementById('location-search').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      searchLocation();
    }
  });

  // Undo/redo buttons
  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('redo-btn').addEventListener('click', redo);

  // Reset button
  document.getElementById('reset-btn').addEventListener('click', () => {
    if (selectedSegments.length > 0) {
      if (confirm('האם אתה בטוח שברצונך לאפס את המסלול? פעולה זו תמחק את כל הקטעים שנבחרו.')) {
        resetRoute();
      }
    } else {
      resetRoute();
    }
  });

  // Share route button
  document.getElementById('share-route').addEventListener('click', shareRoute);

  // Legend toggle functionality
  document.getElementById('legend-toggle').addEventListener('click', function() {
    const legendBox = document.getElementById('legend-box');
    const isOpen = legendBox.classList.contains('open');

    if (isOpen) {
      legendBox.classList.remove('open');
      legendBox.classList.add('closed');
    } else {
      legendBox.classList.remove('closed');
      legendBox.classList.add('open');
    }
  });

  // Warning box click handlers
  document.getElementById('route-warning').addEventListener('click', function() {
    const continuityResult = checkRouteContinuity();
    if (!continuityResult.isContinuous && continuityResult.brokenSegmentIndex >= 0) {
      const segmentName = selectedSegments[continuityResult.brokenSegmentIndex];
      focusOnSegment(segmentName);
    }
  });

  document.getElementById('winter-warning').addEventListener('click', function() {
    const winterResult = hasWinterSegments();
    if (winterResult.hasWinter && winterResult.firstWinterSegment) {
      focusOnSegment(winterResult.firstWinterSegment);
    }
  });

  document.getElementById('segment-warning').addEventListener('click', function() {
    const warningsResult = hasSegmentWarnings();
    if (warningsResult.hasWarnings && warningsResult.firstWarningSegment) {
      focusOnSegment(warningsResult.firstWarningSegment);
    }
  });

  // Keyboard shortcuts for undo/redo
  document.addEventListener('keydown', function(e) {
    //console.log('e.ctrlKey:' + e.ctrlKey + ' key:' + e.key)

    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Z') {
      e.preventDefault();
      redo();
    }
  });
});