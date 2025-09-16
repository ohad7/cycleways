/**
 * RouteManager - Handles route planning logic including loading geojson data,
 * managing route points, and calculating optimal routes through segments.
 */
class RouteManager {
  constructor() {
    this.segments = new Map(); // segmentName -> segment data
    this.segmentMetrics = new Map(); // segmentName -> pre-calculated metrics
    this.routePoints = [];
    this.selectedSegments = [];
    this.adjacencyMap = new Map(); // segment connectivity graph (segment-level)
    this.endpointGraph = new Map(); // node-level graph: "<segment>|S" or "<segment>|E" -> [{to, weight}]
  }

  /**
   * Load geojson and segments data
   * @param {Object} geoJsonData - The geojson feature collection
   * @param {Object} segmentsData - The segments metadata
   */
  async load(geoJsonData, segmentsData) {
    this.segments.clear();
    this.segmentMetrics.clear();
    this.adjacencyMap.clear();
    this.endpointGraph.clear();
    this.segmentsMetadata = segmentsData || {};

    if (!geoJsonData?.features) {
      throw new Error("Invalid geojson data");
    }

    // Load segments from geojson
    geoJsonData.features.forEach((feature) => {
      if (feature.geometry?.type !== "LineString") return;

      const name = feature.properties?.name || "Unnamed Route";
      const coordinates = feature.geometry.coordinates.map((coord) => ({
        lat: coord[1],
        lng: coord[0],
        elevation: coord[2] || 0,
      }));

      // Merge geojson properties with segments metadata
      const segmentMetadata = this.segmentsMetadata[name] || {};
      const mergedProperties = {
        ...feature.properties,
        ...segmentMetadata,
      };

      this.segments.set(name, {
        name,
        coordinates,
        properties: mergedProperties,
      });
    });

    // Pre-calculate metrics for all segments
    this._preCalculateMetrics();

    // Build connectivity graphs
    this._buildAdjacencyMap(); // legacy segment-level (still used elsewhere)
    this._buildEndpointGraph(); // new endpoint-level weighted graph

  }

  /**
   * Add a route point and recalculate the route
   * @param {Object} point - {lat, lng}
   * @returns {Array} Updated list of selected segments
   */
  addPoint(point) {
    if (!point?.lat || !point?.lng) {
      throw new Error("Invalid point coordinates");
    }

    // Snap point to nearest segment
    const snappedPoint = this._snapToNearestSegment(point);
    if (!snappedPoint) {
      return this.selectedSegments;
    }

    this.routePoints.push({
      ...snappedPoint,
      id: Date.now() + Math.random(),
    });

    this._recalculateRoute();
    return [...this.selectedSegments];
  }

  /**
   * Get segments near a hover point for highlighting
   * @param {Object} point - {lat, lng}
   * @param {number} threshold - Distance threshold in meters (default: 100)
   * @returns {Array} Array of nearby segment names
   */
  getHoverSegments(point, threshold = 100) {
    if (!point?.lat || !point?.lng) return [];

    const nearbySegments = [];

    for (const [segmentName, segment] of this.segments) {
      const coords = segment.coordinates;
      for (let i = 0; i < coords.length - 1; i++) {
        const distance = this._distanceToLineSegment(
          point,
          coords[i],
          coords[i + 1],
        );
        if (distance <= threshold) {
          nearbySegments.push(segmentName);
          break;
        }
      }
    }

    return nearbySegments;
  }

  /**
   * Remove a route point by index
   * @param {number} index - Index of point to remove
   * @returns {Array} Updated list of selected segments
   */
  removePoint(index) {
    if (index < 0 || index >= this.routePoints.length) {
      return [...this.selectedSegments];
    }

    // Remove the point from internal array
    this.routePoints.splice(index, 1);

    // Recalculate route based on remaining points
    this._recalculateRoute();

    return [...this.selectedSegments];
  }

  /**
   * Clear all route points and segments
   * @returns {Array} Empty segments array
   */
  clearRoute() {
    this.routePoints = [];
    this.selectedSegments = [];
    return [];
  }

  /**
   * Recalculate route based on current points
   * @param {Array} points - Array of route points
   * @returns {Array} Updated list of selected segments
   */
  recalculateRoute(points) {
    // Re-snap points to nearest segments to ensure they're valid
    this.routePoints = points
      .map((point) => {
        if (!point || point.lat === undefined || point.lng === undefined) {
          return null;
        }

        // Re-snap the point to the nearest segment
        const snappedPoint = this._snapToNearestSegment({
          lat: point.lat,
          lng: point.lng,
        });

        if (snappedPoint) {
          return {
            ...point,
            lat: snappedPoint.lat,
            lng: snappedPoint.lng,
            segmentName: snappedPoint.segmentName,
          };
        }

        return point; // Keep original if snapping fails
      })
      .filter((point) => point !== null);

    this._recalculateRoute();
    return [...this.selectedSegments];
  }

  /**
   * Find closest segment to a point
   * @param {Object} point - {lat, lng}
   * @returns {string|null} Closest segment name
   */
  findClosestSegment(point) {
    const snapped = this._snapToNearestSegment(point);
    return snapped ? snapped.segmentName : null;
  }

  /**
   * Find path between two points
   * @param {Object} startPoint - {lat, lng}
   * @param {Object} endPoint - {lat, lng}
   * @returns {Array} Array of segment names forming the path
   */
  findPathBetweenPoints(startPoint, endPoint) {
    return this._findPathBetweenPoints(startPoint, endPoint);
  }

  /**
   * Get current route information
   * @returns {Object} Route data including points, segments, and metrics
   */
  getRouteInfo() {
    const totalDistance = this._calculateTotalDistance();
    const elevation = this._calculateElevationChanges();

    return {
      points: [...this.routePoints],
      segments: [...this.selectedSegments],
      distance: totalDistance,
      elevationGain: elevation.gain,
      elevationLoss: elevation.loss,
      orderedCoordinates: this._getOrderedCoordinates(),
    };
  }

  /**
   * Get segment information by name
   * @param {string} segmentName
   * @returns {Object|null} Segment data with metrics
   */
  getSegmentInfo(segmentName) {
    const segment = this.segments.get(segmentName);
    const metrics = this.segmentMetrics.get(segmentName);

    if (!segment) return null;

    return {
      ...segment,
      metrics: metrics || null,
    };
  }

  /**
   * Restore route state from an array of points
   * @param {Array} points - Array of route points with {lat, lng, id}
   * @returns {Array} Updated list of selected segments
   */
  restoreFromPoints(points) {
    // Filter and validate points
    const validPoints = points.filter(
      (point) => point && point.lat !== undefined && point.lng !== undefined,
    );

    if (validPoints.length === 0) {
      this.clearRoute();
      return [];
    }

    // Store the current segments before clearing
    const previousSegments = [...this.selectedSegments];

    // Clear current state
    this.clearRoute();

    // Add each point and snap them to segments to ensure they have segmentName
    for (const point of validPoints) {
      const snappedPoint = this._snapToNearestSegment(point);
      if (snappedPoint) {
        this.routePoints.push({
          lat: snappedPoint.lat,
          lng: snappedPoint.lng,
          id: point.id || Date.now() + Math.random(),
          segmentName: snappedPoint.segmentName,
        });
      } else {
        // If snapping fails, keep original point but try to find closest segment
        const closestSegment = this.findClosestSegment(point);
        this.routePoints.push({
          lat: point.lat,
          lng: point.lng,
          id: point.id || Date.now() + Math.random(),
          segmentName: closestSegment,
        });
      }
    }

    // Recalculate route based on the restored points
    this._recalculateRoute();

    // If recalculation failed and we have no segments, try to restore the previous segments
    if (this.selectedSegments.length === 0 && previousSegments.length > 0) {
      console.warn(
        "Route recalculation failed, attempting to restore previous segments",
      );
      this.selectedSegments = [...previousSegments];
    }

    return [...this.selectedSegments];
  }

  /**
   * Update internal state without recalculation (for undo/redo operations)
   * @param {Array} points - Array of route points
   * @param {Array} segments - Array of segment names
   */
  updateInternalState(points, segments) {
    this.routePoints = points.map((p) => ({ ...p }));
    this.selectedSegments = [...segments];
  }

  /**
   * Check if a list of segments forms a continuous route
   * @param {Array} segments - Array of segment names
   * @returns {Object} {isContinuous: boolean, brokenSegmentIndex: number}
   */
  checkSegmentsContinuity(segments) {
    if (segments.length <= 1) {
      return { isContinuous: true, brokenSegmentIndex: -1 };
    }

    const tolerance = 100; // 100 meters tolerance
    const orderedCoords = this._getOrderedCoordinatesForSegments(segments);

    if (orderedCoords.length === 0) {
      return { isContinuous: true, brokenSegmentIndex: -1 };
    }

    // Check gaps in the ordered coordinates by looking at distances between consecutive segments
    let coordIndex = 0;

    for (let i = 0; i < segments.length - 1; i++) {
      const currentSegmentName = segments[i];
      const nextSegmentName = segments[i + 1];

      const currentSegment = this.segments.get(currentSegmentName);
      const nextSegment = this.segments.get(nextSegmentName);

      if (!currentSegment || !nextSegment) {
        continue;
      }

      // Find where current segment ends in ordered coordinates
      const currentSegmentLength = currentSegment.coordinates.length;
      const currentSegmentEndIndex = coordIndex + currentSegmentLength - 1;

      // Check if we have enough coordinates
      if (currentSegmentEndIndex >= orderedCoords.length - 1) {
        return { isContinuous: false, brokenSegmentIndex: i };
      }

      const currentEnd = orderedCoords[currentSegmentEndIndex];
      const nextStart = orderedCoords[currentSegmentEndIndex + 1];

      const distance = this._getDistance(currentEnd, nextStart);

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

  // Private methods

  _preCalculateMetrics() {
    for (const [segmentName, segment] of this.segments) {
      const coords = segment.coordinates;

      // Calculate distance
      let distance = 0;
      for (let i = 0; i < coords.length - 1; i++) {
        distance += this._getDistance(coords[i], coords[i + 1]);
      }

      // Apply elevation smoothing
      const smoothedCoords = this._smoothElevations(coords, 100);

      // Calculate elevation changes
      let elevationGainForward = 0;
      let elevationLossForward = 0;
      const minElevationChange = 1.0;

      for (let i = 0; i < smoothedCoords.length - 1; i++) {
        const elevationChange =
          smoothedCoords[i + 1].elevation - smoothedCoords[i].elevation;

        if (Math.abs(elevationChange) >= minElevationChange) {
          if (elevationChange > 0) {
            elevationGainForward += elevationChange;
          } else {
            elevationLossForward += Math.abs(elevationChange);
          }
        }
      }

      this.segmentMetrics.set(segmentName, {
        distance,
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
        smoothedCoords,
      });
    }
  }

  _buildAdjacencyMap() {
    const connectionThreshold = 50; // meters

    for (const segmentName of this.segments.keys()) {
      this.adjacencyMap.set(segmentName, []);
    }

    const segmentArray = Array.from(this.segments.entries());

    for (let i = 0; i < segmentArray.length; i++) {
      for (let j = i + 1; j < segmentArray.length; j++) {
        const [name1, segment1] = segmentArray[i];
        const [name2, segment2] = segmentArray[j];

        if (
          this._areSegmentsConnected(segment1, segment2, connectionThreshold)
        ) {
          this.adjacencyMap.get(name1).push(name2);
          this.adjacencyMap.get(name2).push(name1);
        }
      }
    }
  }

  _buildEndpointGraph() {
    // Nodes: "<segment>|S" and "<segment>|E"
    // Edges:
    //  - Within a segment: S <-> E with weight = segment length
    //  - Between segments: touching endpoints get 0-weight transitions
    const connectionThreshold = 50; // meters

    const segEntries = Array.from(this.segments.entries());

    // Initialize nodes + internal edges
    for (const [name, _seg] of segEntries) {
      const nodeS = `${name}|S`;
      const nodeE = `${name}|E`;
      if (!this.endpointGraph.has(nodeS)) this.endpointGraph.set(nodeS, []);
      if (!this.endpointGraph.has(nodeE)) this.endpointGraph.set(nodeE, []);

      const metrics = this.segmentMetrics.get(name);
      const w = metrics ? metrics.distance : 0;

      // Bidirectional edge representing traversing the segment
      this.endpointGraph
        .get(nodeS)
        .push({ to: nodeE, weight: w, segment: name });
      this.endpointGraph
        .get(nodeE)
        .push({ to: nodeS, weight: w, segment: name });
    }

    // Zero-weight connections between touching endpoints of different segments
    for (let i = 0; i < segEntries.length; i++) {
      for (let j = i + 1; j < segEntries.length; j++) {
        const [name1, seg1] = segEntries[i];
        const [name2, seg2] = segEntries[j];

        const s1 = seg1.coordinates[0];
        const e1 = seg1.coordinates[seg1.coordinates.length - 1];
        const s2 = seg2.coordinates[0];
        const e2 = seg2.coordinates[seg2.coordinates.length - 1];

        const pairs = [
          [`${name1}|S`, s1, `${name2}|S`, s2],
          [`${name1}|S`, s1, `${name2}|E`, e2],
          [`${name1}|E`, e1, `${name2}|S`, s2],
          [`${name1}|E`, e1, `${name2}|E`, e2],
        ];

        for (const [nA, pA, nB, pB] of pairs) {
          if (this._getDistance(pA, pB) <= connectionThreshold) {
            // Bidirectional zero-weight transition (junction)
            this.endpointGraph.get(nA).push({ to: nB, weight: 0 });
            this.endpointGraph.get(nB).push({ to: nA, weight: 0 });
          }
        }
      }
    }
  }

  _areSegmentsConnected(segment1, segment2, threshold) {
    const coords1 = segment1.coordinates;
    const coords2 = segment2.coordinates;

    if (coords1.length === 0 || coords2.length === 0) return false;

    const endpoints1 = [coords1[0], coords1[coords1.length - 1]];
    const endpoints2 = [coords2[0], coords2[coords2.length - 1]];

    for (const point1 of endpoints1) {
      for (const point2 of endpoints2) {
        if (this._getDistance(point1, point2) <= threshold) {
          return true;
        }
      }
    }

    return false;
  }

  _snapToNearestSegment(point) {
    let closestSegment = null;
    let minDistance = Infinity;
    let closestPoint = null;
    const threshold = 100; // meters

    for (const [segmentName, segment] of this.segments) {
      const coords = segment.coordinates;

      for (let i = 0; i < coords.length - 1; i++) {
        const segmentStart = coords[i];
        const segmentEnd = coords[i + 1];
        const pointOnSegment = this._getClosestPointOnLineSegment(
          point,
          segmentStart,
          segmentEnd,
        );
        const distance = this._getDistance(point, pointOnSegment);

        if (distance < threshold && distance < minDistance) {
          minDistance = distance;
          closestSegment = segmentName;
          closestPoint = pointOnSegment;
        }
      }
    }

    return closestPoint
      ? { ...closestPoint, segmentName: closestSegment }
      : null;
  }

  _recalculateRoute() {
    // Filter out any undefined or invalid points from routePoints
    this.routePoints = this.routePoints.filter(
      (point) => point && point.lat !== undefined && point.lng !== undefined,
    );

    if (this.routePoints.length === 0) {
      this.selectedSegments = [];
      return;
    }

    if (this.routePoints.length === 1) {
      const point = this.routePoints[0];
      if (point && point.segmentName) {
        this.selectedSegments = [point.segmentName];
      } else {
        this.selectedSegments = [];
      }
      return;
    }

    // Find optimal route through all points
    try {
      this.selectedSegments = this._findOptimalRouteThroughPoints(
        this.routePoints,
      );
    } catch (error) {
      console.error("Error in _findOptimalRouteThroughPoints:", error);
      this.selectedSegments = [];
    }
  }

  _findOptimalRouteThroughPoints(points) {
    if (points.length === 0) return [];

    // Filter out any undefined or invalid points
    const validPoints = points.filter(
      (point) => point && point.lat !== undefined && point.lng !== undefined,
    );

    if (validPoints.length === 0) return [];
    if (validPoints.length === 1) {
      return validPoints[0].segmentName ? [validPoints[0].segmentName] : [];
    }

    let allSegments = [];

    // Process each new point by extending the route
    for (let i = 0; i < validPoints.length; i++) {
      const point = validPoints[i];

      if (i === 0) {
        // First point - just add its segment
        if (point.segmentName) {
          allSegments.push(point.segmentName);
        }
      } else {
        // Extend route to reach this new point
        const extensionSegments = this._findRouteExtensionToPoint(
          point,
          allSegments,
        );

        allSegments.push(...extensionSegments);
      }
    }

    return allSegments;
  }

  _findRouteExtensionToPoint(targetPoint, currentRouteSegments) {
    if (!targetPoint.segmentName) return [];

    const closestSegmentToPoint = targetPoint.segmentName;

    // If the route is empty, the extension is just the target point's segment
    if (currentRouteSegments.length === 0) {
      return [closestSegmentToPoint];
    }

    const lastSegmentOfRoute =
      currentRouteSegments[currentRouteSegments.length - 1];

    // Check if we're clicking on the same segment as the last one
    if (lastSegmentOfRoute === closestSegmentToPoint) {
      return [];
    }

    // Different segment - proceed with normal adjacency logic
    const routeEndpoint = this._getCurrentRouteEndpoint(currentRouteSegments);
    if (!routeEndpoint) return [closestSegmentToPoint];

    // Check direct connectivity from the actual route endpoint
    const connectionsFromLastSegment =
      this.adjacencyMap.get(lastSegmentOfRoute) || [];

    if (connectionsFromLastSegment.includes(closestSegmentToPoint)) {
      // If it's only the second segment being added and it's adjacent, return it directly
      if (currentRouteSegments.length == 1) {
        return [closestSegmentToPoint];
      }
      // Check if the target segment is reachable from the current route endpoint
      const targetSegmentData = this.segments.get(closestSegmentToPoint);
      if (!targetSegmentData) return [closestSegmentToPoint];

      const targetCoords = targetSegmentData.coordinates;
      const targetStart = targetCoords[0];
      const targetEnd = targetCoords[targetCoords.length - 1];

      // Check distances from route endpoint to both ends of target segment
      const distanceToTargetStart = this._getDistance(
        routeEndpoint,
        targetStart,
      );
      const distanceToTargetEnd = this._getDistance(routeEndpoint, targetEnd);
      const connectionThreshold = 50; // meters

      if (
        Math.min(distanceToTargetStart, distanceToTargetEnd) <=
        connectionThreshold
      ) {
        // Direct connection possible
        return [closestSegmentToPoint];
      } else {
        // Need to reverse through the last segment first to reach the other end
        console.log("Need to reverse through last segment to reach target");
        return [lastSegmentOfRoute, closestSegmentToPoint];
      }
    } else {

      // Not directly connected - find the shortest path using endpoint graph
      const targetSegmentData = this.segments.get(closestSegmentToPoint);
      if (!targetSegmentData) return [closestSegmentToPoint];

      // Use the *actual* clicked point on the target segment to pick its entry endpoint
      const targetEntryPoint = {
        lat: targetPoint.lat,
        lng: targetPoint.lng,
      };

      const path = this._findPathToSegmentEntryPoint(
        lastSegmentOfRoute,
        closestSegmentToPoint,
        targetEntryPoint,
        routeEndpoint,
      );

      if (!path || path.length === 0) {
        return [closestSegmentToPoint];
      }

      // When it's the second segment being added, don't assume directinality and thus don't reverse
      if (
        currentRouteSegments.length == 1 &&
        path[0] == currentRouteSegments[0]
      ) {
        path.shift();
        return path;
      }

      return path;
    }
  }

  _isReversalPath(currentRouteSegments, potentialPath) {
    if (currentRouteSegments.length === 0 || potentialPath.length === 0)
      return false;
    const lastSegmentOfRoute =
      currentRouteSegments[currentRouteSegments.length - 1];
    return potentialPath[0] === lastSegmentOfRoute;
  }

  _isSegmentReversedInRoute(segmentName, routeSegments) {
    const segmentIndex = routeSegments.lastIndexOf(segmentName);
    if (segmentIndex === -1 || segmentIndex === 0) return false;

    // Get the segment and its predecessor in the route
    const segment = this.segments.get(segmentName);
    const prevSegmentName = routeSegments[segmentIndex - 1];
    const prevSegment = this.segments.get(prevSegmentName);

    if (!segment || !prevSegment) return false;

    const segmentStart = segment.coordinates[0];
    const segmentEnd = segment.coordinates[segment.coordinates.length - 1];
    const prevSegmentStart = prevSegment.coordinates[0];
    const prevSegmentEnd =
      prevSegment.coordinates[prevSegment.coordinates.length - 1];

    // Determine how the previous segment connects to this segment
    const distanceFromPrevEndToSegmentStart = this._getDistance(
      prevSegmentEnd,
      segmentStart,
    );
    const distanceFromPrevEndToSegmentEnd = this._getDistance(
      prevSegmentEnd,
      segmentEnd,
    );
    const distanceFromPrevStartToSegmentStart = this._getDistance(
      prevSegmentStart,
      segmentStart,
    );
    const distanceFromPrevStartToSegmentEnd = this._getDistance(
      prevSegmentStart,
      segmentEnd,
    );

    const minDistance = Math.min(
      distanceFromPrevEndToSegmentStart,
      distanceFromPrevEndToSegmentEnd,
      distanceFromPrevStartToSegmentStart,
      distanceFromPrevStartToSegmentEnd,
    );

    // If the closest connection is to the end of the current segment, it's reversed
    return (
      minDistance === distanceFromPrevEndToSegmentEnd ||
      minDistance === distanceFromPrevStartToSegmentEnd
    );
  }

  _findPathBetweenPoints(startPoint, endPoint, usedSegments = new Set()) {
    const startSegment = this._findSegmentForPoint(startPoint);
    const endSegment = this._findSegmentForPoint(endPoint);

    if (!startSegment || !endSegment) return [];
    if (startSegment === endSegment) {
      return [startSegment];
    }

    // Determine which endpoint of the start segment to start from (closer to the actual startPoint)
    const startEndpointKey = this._nearestEndpointKeyToPoint(
      startSegment,
      startPoint,
    );
    const routeEndpointPoint = this._getEndpointCoords(
      startSegment,
      startEndpointKey,
    );

    // Determine target entry endpoint of the end segment (closer to the actual endPoint)
    const targetEndpointKey = this._nearestEndpointKeyToPoint(
      endSegment,
      endPoint,
    );
    const targetEntryPoint = this._getEndpointCoords(
      endSegment,
      targetEndpointKey,
    );

    // Use shortest path algorithm over endpoint graph
    const shortestPath = this._findShortestSegmentPath(
      startSegment,
      endSegment,
      {
        routeEndpointPoint,
        targetEntryPoint,
      },
    );

    return shortestPath;
  }

  _findSegmentForPoint(point) {
    if (point.segmentName) return point.segmentName;

    const snapped = this._snapToNearestSegment(point);
    return snapped ? snapped.segmentName : null;
  }

  /**
   * NEW: Dijkstra on endpoint graph (segments as edges, endpoints as nodes).
   * @param {string} startSegmentName
   * @param {string} endSegmentName
   * @param {Object} options - {routeEndpointPoint?: {lat,lng}, targetEntryPoint?: {lat,lng}}
   * @returns {string[]} ordered list of segment names to traverse
   */
  _findShortestSegmentPath(startSegmentName, endSegmentName, options = {}) {
    if (startSegmentName === endSegmentName) return [startSegmentName];

    // Decide start node
    let startNode;
    const startS = `${startSegmentName}|S`;
    const startE = `${startSegmentName}|E`;
    if (options.routeEndpointPoint) {
      const sCoord = this._getEndpointCoords(startSegmentName, "S");
      const eCoord = this._getEndpointCoords(startSegmentName, "E");
      const dS = this._getDistance(options.routeEndpointPoint, sCoord);
      const dE = this._getDistance(options.routeEndpointPoint, eCoord);
      startNode = dS <= dE ? startS : startE;
    } else {
      // default: continue from the geometric end of the segment
      startNode = startE;
    }

    // Decide target node
    let targetNode;
    const endS = `${endSegmentName}|S`;
    const endE = `${endSegmentName}|E`;
    if (options.targetEntryPoint) {
      const sCoord = this._getEndpointCoords(endSegmentName, "S");
      const eCoord = this._getEndpointCoords(endSegmentName, "E");
      const dS = this._getDistance(options.targetEntryPoint, sCoord);
      const dE = this._getDistance(options.targetEntryPoint, eCoord);
      targetNode = dS <= dE ? endS : endE;
    } else {
      // If not specified, we will run once to each end and pick shorter
      const pathToS = this._dijkstraPath(startNode, endS);
      const pathToE = this._dijkstraPath(startNode, endE);
      const wS = this._pathWeight(pathToS);
      const wE = this._pathWeight(pathToE);
      const better = wS <= wE ? pathToS : pathToE;
      return this._nodesPathToSegments(better);
    }

    // Single Dijkstra to chosen endpoint
    const nodePath = this._dijkstraPath(startNode, targetNode);
    if (!nodePath || nodePath.length === 0) {
      // Fallback if disconnected
      return [startSegmentName, endSegmentName];
    }
    return this._nodesPathToSegments(nodePath);
  }

  /**
   * Convert a node path ["A|S","A|E","B|E","B|S"...] into the list of segments traversed.
   * We push a segment when the path crosses within a segment (S<->E for that same segment).
   */
  _nodesPathToSegments(nodePath) {
    if (!nodePath || nodePath.length < 2) return [];

    const segments = [];
    for (let i = 0; i < nodePath.length - 1; i++) {
      const [segA, endA] = nodePath[i].split("|");
      const [segB, endB] = nodePath[i + 1].split("|");
      if (segA === segB && endA !== endB) {
        // traversed this segment
        // avoid duplicates if same segment appears consecutively
        if (segments.length === 0 || segments[segments.length - 1] !== segA) {
          segments.push(segA);
        }
      }
    }
    return segments;
  }

  _dijkstraPath(srcNode, dstNode) {
    // Classic Dijkstra without a heap (graph is modest)
    const nodes = Array.from(this.endpointGraph.keys());
    if (!nodes.includes(srcNode) || !nodes.includes(dstNode)) return [];

    const dist = new Map();
    const prev = new Map();
    const visited = new Set();

    for (const n of nodes) dist.set(n, Infinity);
    dist.set(srcNode, 0);

    while (visited.size < nodes.length) {
      // pick unvisited node with smallest dist
      let u = null;
      let best = Infinity;
      for (const n of nodes) {
        if (!visited.has(n) && dist.get(n) < best) {
          best = dist.get(n);
          u = n;
        }
      }
      if (u === null) break; // disconnected
      if (u === dstNode) break;

      visited.add(u);
      const edges = this.endpointGraph.get(u) || [];
      for (const { to, weight } of edges) {
        if (visited.has(to)) continue;
        const alt = dist.get(u) + (Number.isFinite(weight) ? weight : 0);
        if (alt < dist.get(to)) {
          dist.set(to, alt);
          prev.set(to, u);
        }
      }
    }

    if (!prev.has(dstNode) && srcNode !== dstNode) {
      // Might still be reachable if src==dst; otherwise, disconnected
      if (srcNode !== dstNode) return [];
    }

    // Reconstruct path
    const path = [];
    let curr = dstNode;
    path.unshift(curr);
    while (prev.has(curr)) {
      curr = prev.get(curr);
      path.unshift(curr);
    }
    return path;
  }

  _pathWeight(nodePath) {
    if (!nodePath || nodePath.length < 2) return Infinity;
    let total = 0;
    for (let i = 0; i < nodePath.length - 1; i++) {
      const edges = this.endpointGraph.get(nodePath[i]) || [];
      const e = edges.find((x) => x.to === nodePath[i + 1]);
      total += e ? e.weight : Infinity;
    }
    return total;
  }

  _findPathFromPointToSegmentEntry(
    startSegmentName,
    targetSegmentName,
    targetEntryPoint,
    routeEndpoint = null, // Added to explicitly pass the route's current endpoint
  ) {
    // If routeEndpoint is not provided, find it from the startSegmentName
    if (!routeEndpoint) {
      const startSegmentData = this.segments.get(startSegmentName);
      if (!startSegmentData) return [];
      routeEndpoint =
        startSegmentData.coordinates[startSegmentData.coordinates.length - 1];
    }

    // Use the endpoint-aware shortest path
    return this._findPathToSegmentEntryPoint(
      startSegmentName,
      targetSegmentName,
      targetEntryPoint,
      routeEndpoint,
    );
  }

  _findClosestSegmentName(point) {
    const snapped = this._snapToNearestSegment(point);
    return snapped ? snapped.segmentName : null;
  }

  /**
   * FIXED: respects targetEntryPoint (third param) + routeEndpoint.
   * Picks start endpoint (on startSegmentName) nearest to routeEndpoint,
   * and target endpoint (on targetSegmentName) nearest to targetEntryPoint,
   * then runs endpoint-graph Dijkstra to produce segment sequence.
   */
  _findPathToSegmentEntryPoint(
    startSegmentName,
    targetSegmentName,
    targetEntryPoint,
    routeEndpoint, // The actual end point of the current route
  ) {
    const startSegmentData = this.segments.get(startSegmentName);
    const targetSegmentData = this.segments.get(targetSegmentName);
    if (!startSegmentData || !targetSegmentData) return [];

    // Choose concrete endpoints
    const routeEndpointPoint =
      routeEndpoint ||
      startSegmentData.coordinates[startSegmentData.coordinates.length - 1];

    const path = this._findShortestSegmentPath(
      startSegmentName,
      targetSegmentName,
      {
        routeEndpointPoint,
        targetEntryPoint,
      },
    );

    // Avoid adding the end segment if it's already the last one in the path
    if (path.length > 0 && path[path.length - 1] !== targetSegmentName) {
      path.push(targetSegmentName);
    }

    return path || [];
  }

  _getCurrentRouteEndpoint(segments) {
    if (segments.length === 0) return null;

    const orderedCoords = this._getOrderedCoordinatesForSegments(segments);
    return orderedCoords.length > 0
      ? orderedCoords[orderedCoords.length - 1]
      : null;
  }

  _isSegmentNecessaryForConnection(
    existingSegments,
    candidateSegment,
    pathSegments,
  ) {
    // If this is one of only two segments in the path, it's necessary
    if (pathSegments.length <= 2) return true;

    // If we have no existing segments, the first one is necessary
    if (existingSegments.length === 0) return true;

    // Check if this segment connects to the last segment in our route
    const lastSegment = existingSegments[existingSegments.length - 1];
    const candidateIndex = pathSegments.indexOf(candidateSegment);
    const lastSegmentIndex = pathSegments.indexOf(lastSegment);

    // Only add if this segment immediately follows the last one in the shortest path
    // and there's no alternative direct connection
    if (candidateIndex === lastSegmentIndex + 1) {
      // Check if the last segment and candidate are actually connected
      const lastSegmentConnections = this.adjacencyMap.get(lastSegment) || [];
      return lastSegmentConnections.includes(candidateSegment);
    }

    return false;
  }

  _getOrderedCoordinates() {
    return this._getOrderedCoordinatesForSegments(this.selectedSegments);
  }

  _getOrderedCoordinatesForSegments(segments) {
    if (segments.length === 0) return [];

    let orderedCoords = [];

    for (let i = 0; i < segments.length; i++) {
      const segmentName = segments[i];
      const segment = this.segments.get(segmentName);
      if (!segment) continue;

      let coords = [...segment.coordinates];

      if (i === 0) {
        // Orient first segment correctly if there's a second segment
        if (segments.length > 1) {
          const nextSegment = this.segments.get(segments[1]);
          if (nextSegment) {
            coords = this._orientSegmentForConnection(
              coords,
              nextSegment.coordinates,
              true,
            );
          }
        }
        orderedCoords = [...coords];
      } else {
        // Orient subsequent segments to connect with previous
        const lastPoint = orderedCoords[orderedCoords.length - 1];
        coords = this._orientSegmentForConnection(
          coords,
          null,
          false,
          lastPoint,
        );

        const firstPoint = coords[0];
        const connectionDistance = this._getDistance(lastPoint, firstPoint);

        if (connectionDistance <= 50) {
          orderedCoords.push(...coords.slice(1));
        } else {
          orderedCoords.push(...coords);
        }
      }
    }

    return orderedCoords;
  }

  _orientSegmentForConnection(coords, nextCoords, isFirst, lastPoint = null) {
    if (isFirst && nextCoords) {
      const firstStart = coords[0];
      const firstEnd = coords[coords.length - 1];
      const nextStart = nextCoords[0];
      const nextEnd = nextCoords[nextCoords.length - 1];

      const distances = [
        this._getDistance(firstEnd, nextStart),
        this._getDistance(firstEnd, nextEnd),
        this._getDistance(firstStart, nextStart),
        this._getDistance(firstStart, nextEnd),
      ];

      const minIndex = distances.indexOf(Math.min(...distances));
      return minIndex === 2 || minIndex === 3 ? coords.reverse() : coords;
    }

    if (lastPoint) {
      const segmentStart = coords[0];
      const segmentEnd = coords[coords.length - 1];

      const distanceToStart = this._getDistance(lastPoint, segmentStart);
      const distanceToEnd = this._getDistance(lastPoint, segmentEnd);

      return distanceToEnd < distanceToStart ? coords.reverse() : coords;
    }

    return coords;
  }

  _calculateTotalDistance() {
    let totalDistance = 0;
    for (const segmentName of this.selectedSegments) {
      const metrics = this.segmentMetrics.get(segmentName);
      if (metrics) {
        totalDistance += metrics.distance;
      }
    }
    return totalDistance;
  }

  _calculateElevationChanges() {
    let totalGain = 0;
    let totalLoss = 0;

    for (let i = 0; i < this.selectedSegments.length; i++) {
      const segmentName = this.selectedSegments[i];
      const metrics = this.segmentMetrics.get(segmentName);
      if (!metrics) continue;

      let isReversed = false;
      if (i > 0) {
        // Determine orientation based on connectivity
        const prevSegmentName = this.selectedSegments[i - 1];
        const prevMetrics = this.segmentMetrics.get(prevSegmentName);

        if (prevMetrics) {
          const currentStart = metrics.startPoint;
          const currentEnd = metrics.endPoint;
          const prevEnd = prevMetrics.endPoint;

          const distanceToStart = this._getDistance(prevEnd, currentStart);
          const distanceToEnd = this._getDistance(prevEnd, currentEnd);

          isReversed = distanceToEnd < distanceToStart;
        }
      }

      if (isReversed) {
        totalGain += metrics.reverse.elevationGain;
        totalLoss += metrics.reverse.elevationLoss;
      } else {
        totalGain += metrics.forward.elevationGain;
        totalLoss += metrics.forward.elevationLoss;
      }
    }

    return {
      gain: Math.round(totalGain),
      loss: Math.round(totalLoss),
    };
  }

  // Utility methods

  _getEndpointCoords(segmentName, key /* "S" | "E" */) {
    const seg = this.segments.get(segmentName);
    if (!seg) return null;
    if (key === "S") return seg.coordinates[0];
    return seg.coordinates[seg.coordinates.length - 1];
  }

  _nearestEndpointKeyToPoint(segmentName, point) {
    const s = this._getEndpointCoords(segmentName, "S");
    const e = this._getEndpointCoords(segmentName, "E");
    const dS = this._getDistance(point, s);
    const dE = this._getDistance(point, e);
    return dS <= dE ? "S" : "E";
  }

  _getDistance(point1, point2) {
    // Add null/undefined checks
    if (
      !point1 ||
      !point2 ||
      point1.lat === undefined ||
      point1.lng === undefined ||
      point2.lat === undefined ||
      point2.lng === undefined
    ) {
      console.warn("Invalid points passed to _getDistance:", point1, point2);
      return Infinity; // Return a large distance for invalid points
    }

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

  _distanceToLineSegment(point, lineStart, lineEnd) {
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

    return this._getDistance(point, { lat: yy, lng: xx });
  }

  _getClosestPointOnLineSegment(point, lineStart, lineEnd) {
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

  _smoothElevations(coords, distanceWindow = 100) {
    if (coords.length === 0) return coords;

    const coordsWithElevation = coords.map((coord) => ({
      lat: coord.lat,
      lng: coord.lng,
      elevation:
        coord.elevation !== undefined
          ? coord.elevation
          : 200 + Math.sin(coord.lat * 10) * 100 + Math.cos(coord.lng * 8) * 50,
    }));

    const smoothedElevations = this._distanceWindowSmoothing(
      coordsWithElevation,
      distanceWindow,
      (index) => coordsWithElevation[index].elevation,
      (accumulated, start, end) => accumulated / (end - start + 1),
    );

    if (coordsWithElevation.length > 0) {
      smoothedElevations[0] = coordsWithElevation[0].elevation;
      smoothedElevations[coordsWithElevation.length - 1] =
        coordsWithElevation[coordsWithElevation.length - 1].elevation;
    }

    return coordsWithElevation.map((coord, index) => ({
      lat: coord.lat,
      lng: coord.lng,
      elevation: smoothedElevations[index],
    }));
  }

  _minimizePath(fullPath, startSegment, endSegment) {
    // If path is short, return as is
    if (fullPath.length <= 3) return fullPath;

    // Try to find a shorter connection
    // For now, just return the start and end segments if they represent the user's clicks
    return [startSegment, endSegment];
  }

  _arePointsInCorrectDirection(startPoint, endPoint, startSegment, endSegment) {
    // Get segment coordinates
    const startSegmentData = this.segments.get(startSegment);
    const endSegmentData = this.segments.get(endSegment);

    if (!startSegmentData || !endSegmentData) return true;

    // Find positions of points along their segments
    const startPosition = this._getPositionAlongSegment(
      startPoint,
      startSegmentData.coordinates,
    );
    const endPosition = this._getPositionAlongSegment(
      endPoint,
      endSegmentData.coordinates,
    );

    // If same segment, ensure end point is after start point
    if (startSegment === endSegment) {
      return endPosition >= startPosition;
    }

    return true; // For different segments, assume direction is correct
  }

  _getPositionAlongSegment(point, segmentCoords, isReversed = false) {
    let minDistance = Infinity;
    let bestPosition = 0;
    let accumulatedDistance = 0;

    // If segment is reversed, we need to calculate position from the end
    const coords = isReversed ? [...segmentCoords].reverse() : segmentCoords;

    for (let i = 0; i < coords.length - 1; i++) {
      const segmentStart = coords[i];
      const segmentEnd = coords[i + 1];
      const closestPoint = this._getClosestPointOnLineSegment(
        point,
        segmentStart,
        segmentEnd,
      );
      const distance = this._getDistance(point, closestPoint);

      if (distance < minDistance) {
        minDistance = distance;
        // Calculate position as distance along segment
        const distanceToClosest = this._getDistance(segmentStart, closestPoint);
        bestPosition = accumulatedDistance + distanceToClosest;
      }

      accumulatedDistance += this._getDistance(segmentStart, segmentEnd);
    }

    return bestPosition;
  }

  _calculatePathDistance(segmentPath) {
    let totalDistance = 0;
    for (const segmentName of segmentPath) {
      const metrics = this.segmentMetrics.get(segmentName);
      if (metrics) {
        totalDistance += metrics.distance;
      }
    }
    return totalDistance;
  }

  _distanceWindowSmoothing(points, distanceWindow, accumulate, compute) {
    let result = [];
    let start = 0,
      end = 0,
      accumulated = 0;

    for (let i = 0; i < points.length; i++) {
      while (
        start + 1 < i &&
        this._getDistance(points[start], points[i]) > distanceWindow
      ) {
        accumulated -= accumulate(start);
        start++;
      }

      while (
        end < points.length &&
        this._getDistance(points[i], points[end]) <= distanceWindow
      ) {
        accumulated += accumulate(end);
        end++;
      }

      result[i] = compute(accumulated, start, end - 1);
    }

    return result;
  }
}

export default RouteManager;

// Export for use in other files
if (typeof module !== "undefined" && module.exports) {
  module.exports = RouteManager;
}
