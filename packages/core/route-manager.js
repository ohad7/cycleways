/**
 * RouteManager - Handles route planning logic including loading geojson data,
 * managing route points, and calculating optimal routes through segments.
 */

// When snapping a route point to the base graph, prefer a CycleWays-matched edge
// over a non-CW edge as long as the CW edge is within this many metres of the
// geometrically closest edge. Keeps endpoints on the CycleWays network where a
// CW path runs near a road, without snapping to a clearly-distant cycleway.
// See plans/cw-edge-snap-preference/design.md.
const CW_SNAP_PREFERENCE_MARGIN_METERS = 20;

// The CW preference also requires the CW edge to be within this multiple of
// the closest edge's distance (with a small floor so tiny distances still
// allow the preference). Without this, a click 2 m from a road would snap to
// a CW path 18 m away, and re-snapping a point that sits exactly on a road
// would migrate it onto any CW edge within the absolute margin.
const CW_SNAP_PREFERENCE_MAX_RATIO = 4;
const CW_SNAP_PREFERENCE_RATIO_FLOOR_METERS = 6;

// When a click carries metersPerPixel (from the map's zoom at click time),
// snap distances are expressed in screen pixels instead of fixed metres so
// zooming in lets users pick points precisely while zoomed-out clicks keep
// fat-finger tolerance. Values are clamped to the fixed-metre defaults above.
const SNAP_THRESHOLD_PIXELS = 40;
const SNAP_THRESHOLD_MIN_METERS = 25;
const CW_SNAP_PREFERENCE_PIXELS = 12;
const CW_SNAP_PREFERENCE_MIN_METERS = 4;
const DEFAULT_BASE_SNAP_CANDIDATES = 4;
const MAX_BASE_SNAP_CANDIDATES = 6;
const SNAP_DISPLACEMENT_COST_PER_METER = 10;
// A short reverse/forward overlap at an interior shaping point is usually an
// incidental snap onto a dangling edge, not a useful route instruction. Give
// that boundary a bounded preference penalty so a nearby continuous candidate
// can win without deleting unavoidable or deliberate out-and-back geometry.
// See plans/via-point-spur/design.md.
const SHORT_VIA_REVERSAL_MAX_OVERLAP_METERS = 12;
const SHORT_VIA_REVERSAL_PENALTY_COST = 100;
const BASE_TRAVERSAL_EPSILON_METERS = 0.01;

function clampMeters(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const {
  DEFAULT_CONNECTOR_STRATEGY,
  evaluateConnectorEdge,
} = require("./src/routing/connectorCostModel.js");
const {
  bicycleTraversalVerdict,
  validateTraversalSlices,
} = require("./src/routing/bicycleTraversalPolicy.js");
const {
  buildRouteAttestation,
} = require("./src/routing/routeAttestation.js");

class RouteManager {
  constructor() {
    this.segments = new Map(); // segmentName -> segment data
    this.segmentMetrics = new Map(); // segmentName -> pre-calculated metrics
    this.routePoints = [];
    this.selectedSegments = [];
    this.adjacencyMap = new Map(); // segment connectivity graph (segment-level)
    this.endpointGraph = new Map(); // node-level graph: "<segment>|S" or "<segment>|E" -> [{to, weight}]
    this.snapThresholdMeters = 100;
    this.baseRoutingNetwork = null;
    this.baseRoutingNodeIds = new Set();
    this.baseRoutingEdges = new Map();
    this.baseRoutingEdgesByShareId = new Map();
    this.baseRoutingAdjacency = new Map();
    this.baseRoutingSpatialGrid = new Map();
    this.baseRoutingSpatialSegments = [];
    this.baseRoutingGridCellMeters = 120;
    this.baseRoutingMetersPerDegreeLng = 111320;
    this.baseRoutingMetersPerDegreeLat = 111320;
    this.baseRoutingUphillCostMetersPerMeter = 8;
    this.baseRoutingGraphVersion = "";
    this.baseRoutingTraversalPolicy = {
      strict: false,
      policyId: null,
      policyDigest: null,
    };
    this.segmentNamesById = new Map();
    this.baseRouteInfo = null;
    this.lastRouteFailure = null;
    this._connectorCostProfile = false;
    this._connectorStrategy = null;
    this._connectorSnapAnyEndpoints = false;
  }

  /**
   * Load geojson and segments data
   * @param {Object} geoJsonData - The geojson feature collection
   * @param {Object} segmentsData - The segments metadata
   */
  async load(geoJsonData, segmentsData, baseRoutingNetwork = null) {
    this.segments.clear();
    this.segmentMetrics.clear();
    this.adjacencyMap.clear();
    this.endpointGraph.clear();
    this.segmentsMetadata = segmentsData || {};
    this.segmentNamesById = new Map(
      Object.entries(this.segmentsMetadata)
        .map(([name, metadata]) => [Number(metadata?.id), name])
        .filter(([segmentId]) => Number.isFinite(segmentId)),
    );

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
    this._loadBaseRoutingNetwork(baseRoutingNetwork);

  }

  /**
   * Add unseen base graph nodes and edges to the active routing network.
   * This keeps shard growth incremental without rebuilding existing indexes.
   * @param {Object} network - Base routing network subset
   * @returns {Object} Number of newly indexed nodes and edges
   */
  mergeBaseRoutingNetwork(network) {
    return this._mergeBaseRoutingNetwork(network);
  }

  /**
   * Add a route point and recalculate the route
   * @param {Object} point - {lat, lng}
   * @returns {Array} Updated list of selected segments
   */
  addPoint(point) {
    if (!this._isValidPoint(point)) {
      throw new Error("Invalid point coordinates");
    }

    if (this.baseRoutingNetwork) {
      const requestedPoints = this.routePoints.map((routePoint) => ({
        ...(routePoint.requestedCoordinate || routePoint),
        id: routePoint.id,
        occurrenceId: routePoint.occurrenceId,
        legPurpose: routePoint.legPurpose,
      }));
      return this.recalculateRoute([
        ...requestedPoints,
        { ...point, id: point.id || Date.now() + Math.random() },
      ]);
    }

    // Snap point to nearest segment
    const snappedPoint = this.snapToNetwork(point);
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

    if (this.baseRoutingNetwork) {
      const requestedPoints = this.routePoints
        .filter((_, pointIndex) => pointIndex !== index)
        .map((routePoint) => ({
          ...(routePoint.requestedCoordinate || routePoint),
          id: routePoint.id,
          occurrenceId: routePoint.occurrenceId,
          legPurpose: routePoint.legPurpose,
        }));
      return this.recalculateRoute(requestedPoints);
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
    this.baseRouteInfo = null;
    this.lastRouteFailure = null;
    return [];
  }

  /**
   * Recalculate route based on current points
   * @param {Array} points - Array of route points
   * @returns {Array} Updated list of selected segments
   */
  recalculateRoute(points) {
    if (this.baseRoutingNetwork) {
      const validPoints = (Array.isArray(points) ? points : []).filter((point) =>
        this._isValidPoint(point),
      );
      if (validPoints.length === 0) {
        this.clearRoute();
        return [];
      }
      const candidate = this.planBaseRouteCandidate(validPoints);
      if (!candidate.ok) {
        // Planning is transactional: an invalid edit cannot replace a route
        // that is already committed and usable.
        if (this.baseRouteInfo && !this.baseRouteInfo.failure) {
          return [...this.selectedSegments];
        }
        this.routePoints = candidate.routePoints;
        this.baseRouteInfo = this._emptyBaseRoute(candidate.failure);
        this.selectedSegments = [];
        this.lastRouteFailure = candidate.failure;
        return [];
      }
      this.routePoints = candidate.routePoints;
      this.baseRouteInfo = candidate.route;
      this.selectedSegments = [...candidate.route.segments];
      this.lastRouteFailure = null;
      return [...this.selectedSegments];
    }

    this.routePoints = this._snapRoutePoints(points);

    this._recalculateRoute();
    return [...this.selectedSegments];
  }

  /**
   * Calculate route output for candidate points without mutating current route state.
   * @param {Array} points - Array of route points
   * @returns {Object} Preview route info
   */
  previewRouteInfo(points) {
    if (this.baseRoutingNetwork) {
      const candidate = this.planBaseRouteCandidate(points);
      const baseRoute = candidate.route || this._emptyBaseRoute(candidate.failure);
      return {
        points: candidate.routePoints,
        segments: baseRoute.segments,
        orderedCoordinates: baseRoute.orderedCoordinates,
        failure: candidate.failure,
      };
    }
    const routePoints = this._snapRoutePoints(points);
    const segments =
      routePoints.length >= 2
        ? this._findOptimalRouteThroughPoints(routePoints)
        : [];

    return {
      points: routePoints,
      segments,
      orderedCoordinates: this._getRouteCoordinatesThroughPoints(routePoints),
    };
  }

  /**
   * Compute a base-graph route preview from raw coordinates without committing
   * it as the planner's active route.
   */
  previewBaseRoute(points, { costProfile = "default", connectorStrategy = null } = {}) {
    const connectorProfile = costProfile === "connector";
    const strategy = connectorProfile ? connectorStrategy : null;
    const snapAny = Boolean(strategy && strategy.snap === "any");
    if (!this.baseRoutingNetwork) {
      return {
        geometry: [],
        distanceMeters: 0,
        failure: "no-base-network",
        snappedEndpoints: [],
        routingValidation: null,
      };
    }
    this._connectorCostProfile = connectorProfile;
    this._connectorStrategy = strategy;
    this._connectorSnapAnyEndpoints = snapAny;
    let candidate;
    try {
      candidate = this.planBaseRouteCandidate(points, {
        edgeFilter:
          connectorProfile && !snapAny
            ? (edge) => this._connectorEdgeAllowedFor(edge, strategy)
            : null,
      });
    } finally {
      this._connectorCostProfile = false;
      this._connectorStrategy = null;
      this._connectorSnapAnyEndpoints = false;
    }
    const route = candidate.route || this._emptyBaseRoute(candidate.failure);
    const snapped = candidate.routePoints || [];
    const snappedEndpoints =
      snapped.length >= 2 ? [snapped[0], snapped[snapped.length - 1]] : snapped;
    if (
      route.failure ||
      !Array.isArray(route.orderedCoordinates) ||
      route.orderedCoordinates.length < 2
    ) {
      return {
        geometry: [],
        distanceMeters: 0,
        failure: candidate.failure || route.failure || "no-path",
        snappedEndpoints,
        routingValidation: null,
      };
    }
    return {
      geometry: route.orderedCoordinates.map((c) => ({ lat: c.lat, lng: c.lng })),
      distanceMeters: route.distance || 0,
      failure: null,
      snappedEndpoints,
      edgeIds: route.traversals.map((traversal) => traversal.edge.id),
      edgeCosts: route.traversals.map((traversal) =>
        this._baseTraversalDiagnostics(traversal),
      ),
      routingValidation: this._baseRouteAttestation(
        route,
        snapped,
        connectorProfile ? "connector-directed-search" : "preview-directed-search",
      ),
    };
  }

  /**
   * Snap a point to the CycleWays network.
   * @param {Object} point - {lat, lng}
   * @param {number} thresholdMeters - Maximum allowed snap distance
   * @returns {Object|null} Snapped point with segmentName and distanceMeters
   */
  snapToNetwork(point, thresholdMeters = null, options = {}) {
    if (this.baseRoutingNetwork) {
      return this._snapToBaseRoutingNetwork(point, thresholdMeters, options);
    }
    return this._snapToNearestSegment(point, thresholdMeters);
  }

  /**
   * Find closest segment to a point
   * @param {Object} point - {lat, lng}
   * @returns {string|null} Closest segment name
   */
  findClosestSegment(point) {
    const snapped = this.snapToNetwork(point);
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
    if (this.baseRoutingNetwork) {
      const routeInfo =
        this.baseRouteInfo ||
        this._calculateBaseRoute(this.routePoints);
      return {
        points: [...this.routePoints],
        segments: [...routeInfo.segments],
        distance: routeInfo.distance,
        cost: routeInfo.cost,
        distanceCost: routeInfo.distanceCost,
        uphillCost: routeInfo.uphillCost,
        cyclewaysDistance: routeInfo.cyclewaysDistance,
        nonCyclewaysDistance: routeInfo.nonCyclewaysDistance,
        uphillMeters: routeInfo.uphillMeters,
        downhillMeters: routeInfo.downhillMeters,
        uphillCostMetersPerMeter: this.baseRoutingUphillCostMetersPerMeter,
        elevationGain: routeInfo.uphillMeters,
        elevationLoss: routeInfo.downhillMeters,
        orderedCoordinates: routeInfo.orderedCoordinates,
        failure: routeInfo.failure || this.lastRouteFailure,
        segmentSpans: buildSegmentSpans(routeInfo.traversals, this.segmentNamesById),
        routingValidation: this._baseRouteAttestation(
          routeInfo,
          this.routePoints,
          routeInfo.derivation || "directed-search",
        ),
      };
    }
    const totalDistance = this._calculateTotalDistance();
    const elevation = this._calculateElevationChanges();

    return {
      points: [...this.routePoints],
      segments: [...this.selectedSegments],
      distance: totalDistance,
      elevationGain: elevation.gain,
      elevationLoss: elevation.loss,
      orderedCoordinates: this._getOrderedCoordinates(),
      segmentSpans: [],
    };
  }

  getRouteInfoForBaseCandidate(candidate) {
    if (!candidate?.ok || !candidate.route) return null;
    const routeInfo = candidate.route;
    return {
      points: candidate.routePoints.map((point) => ({ ...point })),
      segments: [...routeInfo.segments],
      distance: routeInfo.distance,
      cost: routeInfo.cost,
      distanceCost: routeInfo.distanceCost,
      uphillCost: routeInfo.uphillCost,
      cyclewaysDistance: routeInfo.cyclewaysDistance,
      nonCyclewaysDistance: routeInfo.nonCyclewaysDistance,
      uphillMeters: routeInfo.uphillMeters,
      downhillMeters: routeInfo.downhillMeters,
      elevationGain: routeInfo.uphillMeters,
      elevationLoss: routeInfo.downhillMeters,
      orderedCoordinates: routeInfo.orderedCoordinates,
      failure: null,
      segmentSpans: buildSegmentSpans(routeInfo.traversals, this.segmentNamesById),
      routingValidation: this._baseRouteAttestation(
        routeInfo,
        candidate.routePoints,
        candidate.derivation || "directed-search",
      ),
    };
  }

  commitBaseRouteCandidate(candidate) {
    if (!candidate?.ok || !candidate.route || !Array.isArray(candidate.routePoints)) {
      return false;
    }
    const validation = validateTraversalSlices(
      candidate.route.traversals,
      this.baseRoutingTraversalPolicy,
    );
    if (!validation.ok) return false;
    candidate.route.derivation = candidate.derivation || "directed-search";
    this.routePoints = candidate.routePoints.map((point) => ({ ...point }));
    this.baseRouteInfo = candidate.route;
    this.selectedSegments = [...candidate.route.segments];
    this.lastRouteFailure = null;
    return true;
  }

  /**
   * Return base-graph route diagnostics for tuning without exposing the
   * internal traversal objects through ordinary route snapshots.
   * @returns {Object|null} Base route diagnostics
   */
  getBaseRouteDiagnostics() {
    if (!this.baseRoutingNetwork) return null;

    const routeInfo =
      this.baseRouteInfo ||
      this._calculateBaseRoute(this.routePoints);

    const routingValidation = this._baseRouteAttestation(
      routeInfo,
      this.routePoints,
      routeInfo.derivation || "directed-search",
    );
    return {
      failure: routeInfo.failure || this.lastRouteFailure,
      distance: routeInfo.distance,
      cost: routeInfo.cost,
      distanceCost: routeInfo.distanceCost,
      uphillCost: routeInfo.uphillCost,
      cyclewaysDistance: routeInfo.cyclewaysDistance,
      nonCyclewaysDistance: routeInfo.nonCyclewaysDistance,
      uphillMeters: routeInfo.uphillMeters,
      downhillMeters: routeInfo.downhillMeters,
      uphillCostMetersPerMeter: this.baseRoutingUphillCostMetersPerMeter,
      graphVersion: this.baseRoutingGraphVersion,
      contentFingerprint: routingValidation?.contentFingerprint || null,
      exactReverseAllowed: routingValidation?.exactReverseAllowed === true,
      segments: [...routeInfo.segments],
      traversals: routeInfo.traversals.map((traversal) =>
        this._baseTraversalDiagnostics(traversal),
      ),
      legs: (routeInfo.legs || []).map((leg, index) => ({
        index,
        distance: leg.distance,
        cost: leg.cost,
        traversals: leg.traversals.map((traversal) =>
          this._baseTraversalDiagnostics(traversal),
        ),
      })),
    };
  }

  _baseRouteAttestation(
    routeInfo,
    routePoints = this.routePoints,
    derivation = "directed-search",
  ) {
    if (
      !routeInfo ||
      routeInfo.failure ||
      !Array.isArray(routeInfo.traversals) ||
      routeInfo.traversals.length === 0
    ) {
      return null;
    }
    const traversalSlices = routeInfo.traversals.map((traversal) => {
      const currentVerdict =
        traversal.policyVerdict ||
        this._baseTraversalVerdict(
          traversal.edge,
          traversal.fromDistance,
          traversal.toDistance,
        );
      const oppositeVerdict = this._baseTraversalVerdict(
        traversal.edge,
        traversal.toDistance,
        traversal.fromDistance,
      );
      return {
        edgeShareId: traversal.edge.shareId,
        fromFraction:
          traversal.edge.lengthMeters > 0
            ? traversal.fromDistance / traversal.edge.lengthMeters
            : 0,
        toFraction:
          traversal.edge.lengthMeters > 0
            ? traversal.toDistance / traversal.edge.lengthMeters
            : 0,
        distanceMeters: Math.abs(
          traversal.toDistance - traversal.fromDistance,
        ),
        policyState: currentVerdict.state,
        policyReason: currentVerdict.reason,
        oppositePolicyState: oppositeVerdict.state,
        oppositePolicyReason: oppositeVerdict.reason,
        cwMembership: traversal.cwMemberships || [],
        oppositeCwMembership: this._cwMembershipsForTraversal(
          traversal.edge,
          traversal.toDistance,
          traversal.fromDistance,
        ),
        shardIds: traversal.edge.shardIds || [],
      };
    });
    let traversalCursor = 0;
    const legBoundaries = (routeInfo.legs || []).map((leg, index) => {
      const startTraversal = traversalCursor;
      traversalCursor += Array.isArray(leg.traversals) ? leg.traversals.length : 0;
      return {
        purpose: routePoints[index + 1]?.legPurpose || "ordinary",
        fromOccurrence: index,
        toOccurrence: index + 1,
        startTraversal,
        endTraversal: traversalCursor,
      };
    });
    const contract = this.baseRoutingNetwork?.routingContract || {};
    return buildRouteAttestation({
      validationContext: {
        baseRoutingSchemaVersion: this.baseRoutingNetwork?.schemaVersion,
        graphVersion: this.baseRoutingGraphVersion,
        policyId: this.baseRoutingTraversalPolicy.policyId,
        policyDigest: this.baseRoutingTraversalPolicy.policyDigest,
        routingContextDigest: contract.routingContextDigest || "",
      },
      traversalSlices,
      waypointOccurrences: routePoints,
      legBoundaries,
      geometry: routeInfo.orderedCoordinates,
      reverseConstraint: routeInfo.reverseConstraint || "policy-only",
      derivation,
    });
  }

  _baseTraversalDiagnostics(traversal) {
    const memberships = Array.isArray(traversal.cwMemberships)
      ? traversal.cwMemberships
      : [];
    const segmentIds = [...new Set(memberships.map((value) => Number(value.segmentId)))];
    return {
      edgeId: traversal.edge.id,
      edgeShareId: traversal.edge.shareId,
      shardIds: [...(traversal.edge.shardIds || [])],
      direction: traversal.direction,
      policyVerdict: traversal.policyVerdict
        ? { ...traversal.policyVerdict }
        : this._baseTraversalVerdict(
            traversal.edge,
            traversal.fromDistance,
            traversal.toDistance,
          ),
      source: traversal.edge.source,
      routeClass: traversal.edge.routeClass,
      highway: traversal.edge.highway,
      roadType: traversal.edge.roadType,
      cyclewaysSegmentIds: segmentIds,
      cyclewaysAlignments: memberships.map((value) => ({ ...value })),
      cyclewaysSegmentNames: segmentIds
        .map((segmentId) => this.segmentNamesById.get(Number(segmentId)))
        .filter(Boolean),
      distanceMeters: traversal.distanceMeters,
      costMultiplier: traversal.costMultiplier,
      connectorSnapAnyEndpoint: traversal.connectorSnapAnyEndpoint === true,
      distanceCost: traversal.distanceCost,
      uphillMeters: traversal.uphillMeters,
      downhillMeters: traversal.downhillMeters,
      uphillCost: traversal.uphillCost,
      cost: traversal.cost,
      fromDistance: traversal.fromDistance,
      toDistance: traversal.toDistance,
      fromFraction:
        traversal.edge.lengthMeters > 0
          ? traversal.fromDistance / traversal.edge.lengthMeters
          : 0,
      toFraction:
        traversal.edge.lengthMeters > 0
          ? traversal.toDistance / traversal.edge.lengthMeters
          : 0,
      edgeLengthMeters: traversal.edge.lengthMeters,
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
    const validPoints = points.filter((point) => this._isValidPoint(point));

    if (validPoints.length === 0) {
      this.clearRoute();
      return [];
    }


    if (this.baseRoutingNetwork) {
      return this.recalculateRoute(validPoints);
    }

    const previousSegments = [...this.selectedSegments];
    this.clearRoute();
    this.routePoints = this._snapRoutePoints(validPoints);

    // Recalculate route based on the restored points
    this._recalculateRoute();

    // If recalculation failed and we have no segments, try to restore the previous segments
    if (
      this.routePoints.length >= 2 &&
      this.selectedSegments.length === 0 &&
      previousSegments.length > 0
    ) {
      console.warn(
        "Route recalculation failed, attempting to restore previous segments",
      );
      this.selectedSegments = [...previousSegments];
    }

    return [...this.selectedSegments];
  }

  /**
   * Resolve a list of share-anchor route points (objects carrying
   * `baseEdgeShareId` + `baseEdgeFraction` but no lat/lng) into points with
   * lat/lng using the currently loaded base routing network. Returns null if
   * the network is not loaded or any anchor cannot be resolved.
   */
  resolveShareAnchorPoints(anchors) {
    if (!this.baseRoutingNetwork || !Array.isArray(anchors) || anchors.length === 0) {
      return null;
    }
    const points = anchors.map((anchor, index) =>
      this._baseRoutePointFromShareAnchor(anchor, index),
    );
    return points.every((point) => point !== null) ? points : null;
  }

  restoreBaseRouteFromPayload(payload) {
    const candidate = this.planBaseRouteFromPayload(payload);
    return candidate.ok ? this.commitBaseRouteCandidate(candidate) : false;
  }

  planBaseRouteFromPayload(payload) {
    if (!this.baseRoutingNetwork || !payload || payload.type !== "base_route_v4") {
      return { ok: false, failure: "invalid-base-route-payload" };
    }

    const anchors = Array.isArray(payload.routePoints)
      ? payload.routePoints
      : [];
    const legs = Array.isArray(payload.legs) ? payload.legs : [];
    if (anchors.length === 0 || legs.length !== Math.max(0, anchors.length - 1)) {
      return { ok: false, failure: "invalid-base-route-payload" };
    }

    const routePoints = anchors.map((anchor, index) =>
      this._baseRoutePointFromShareAnchor(anchor, index),
    );
    if (routePoints.some((point) => point === null)) {
      return { ok: false, failure: "unresolved-route-anchor" };
    }

    const route = this._emptyBaseRoute();
    for (let index = 0; index < legs.length; index++) {
      const leg = this._baseLegFromSharePayload(
        legs[index],
        routePoints[index],
        routePoints[index + 1],
      );
      if (!leg) {
        return { ok: false, failure: "invalid-route-traversal" };
      }
      route.legs.push(leg);
      this._appendBaseLegToRoute(route, leg);
    }

    route.segments = this._cyclewaysSegmentsForBaseTraversals(route.traversals);
    return {
      ok: true,
      failure: null,
      routePoints,
      route,
      derivation: "exact-restore",
    };
  }

  /**
   * Update internal state without recalculation (for undo/redo operations)
   * @param {Array} points - Array of route points
   * @param {Array} segments - Array of segment names
   */
  updateInternalState(points, segments) {
    if (this.baseRoutingNetwork) {
      this.recalculateRoute(points);
      return;
    }
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

  _isValidPoint(point) {
    return (
      point &&
      point.lat !== null &&
      point.lat !== undefined &&
      point.lng !== null &&
      point.lng !== undefined &&
      Number.isFinite(Number(point.lat)) &&
      Number.isFinite(Number(point.lng))
    );
  }

  _snapToNearestSegment(point, thresholdMeters = null) {
    if (!this._isValidPoint(point)) {
      return null;
    }

    const normalizedPoint = {
      lat: Number(point.lat),
      lng: Number(point.lng),
    };
    const metersPerPixel = Number(point.metersPerPixel);
    if (!Number.isFinite(thresholdMeters)) {
      thresholdMeters =
        Number.isFinite(metersPerPixel) && metersPerPixel > 0
          ? clampMeters(
              SNAP_THRESHOLD_PIXELS * metersPerPixel,
              SNAP_THRESHOLD_MIN_METERS,
              this.snapThresholdMeters,
            )
          : this.snapThresholdMeters;
    }
    let closestSegment = null;
    let minDistance = Infinity;
    let closestPoint = null;

    for (const [segmentName, segment] of this.segments) {
      const coords = segment.coordinates;

      for (let i = 0; i < coords.length - 1; i++) {
        const segmentStart = coords[i];
        const segmentEnd = coords[i + 1];
        const pointOnSegment = this._getClosestPointOnLineSegment(
          normalizedPoint,
          segmentStart,
          segmentEnd,
        );
        const distance = this._getDistance(normalizedPoint, pointOnSegment);

        if (distance <= thresholdMeters && distance < minDistance) {
          minDistance = distance;
          closestSegment = segmentName;
          closestPoint = pointOnSegment;
        }
      }
    }

    return closestPoint
      ? {
          ...closestPoint,
          segmentName: closestSegment,
          distanceMeters: minDistance,
        }
      : null;
  }

  _loadBaseRoutingNetwork(network) {
    this.baseRoutingNetwork = null;
    this.baseRoutingNodeIds.clear();
    this.baseRoutingEdges.clear();
    this.baseRoutingEdgesByShareId.clear();
    this.baseRoutingAdjacency.clear();
    this.baseRoutingSpatialGrid.clear();
    this.baseRoutingSpatialSegments = [];
    this.baseRoutingMetersPerDegreeLng = this.baseRoutingMetersPerDegreeLat;
    this.baseRoutingGraphVersion = "";
    this.baseRoutingTraversalPolicy = {
      strict: false,
      policyId: null,
      policyDigest: null,
    };
    this.baseRouteInfo = null;
    this.lastRouteFailure = null;

    this._mergeBaseRoutingNetwork(network);
  }

  _mergeBaseRoutingNetwork(network) {
    if (
      !network ||
      !Array.isArray(network.nodes) ||
      !Array.isArray(network.edges) ||
      network.edges.length === 0
    ) {
      return { nodes: 0, edges: 0 };
    }

    const targetNetwork = this.baseRoutingNetwork || {
      schemaVersion: network.schemaVersion ?? null,
      graphVersion: network.graphVersion || network.generatedAt || "",
      nodes: [],
      edges: [],
      routingContract: network.routingContract || null,
    };
    if (
      targetNetwork.graphVersion === "" &&
      (network.graphVersion || network.generatedAt)
    ) {
      targetNetwork.graphVersion = network.graphVersion || network.generatedAt;
    }
    if (!this.baseRoutingNetwork) {
      this._setBaseRoutingProjection(network.nodes);
      const contract = network.routingContract || {};
      this.baseRoutingTraversalPolicy = {
        strict:
          contract.strictTraversalPolicy === true ||
          Number(network.schemaVersion) >= 3,
        policyId: contract.policyId || network.policyId || null,
        policyDigest: contract.policyDigest || network.policyDigest || null,
      };
    }

    let addedNodes = 0;
    for (const node of network.nodes) {
      if (typeof node?.id !== "string" || this.baseRoutingNodeIds.has(node.id)) {
        continue;
      }
      this.baseRoutingNodeIds.add(node.id);
      targetNetwork.nodes.push(node);
      addedNodes++;
    }

    let addedEdges = 0;
    for (const edgeData of network.edges) {
      if (typeof edgeData?.id !== "string" || this.baseRoutingEdges.has(edgeData.id)) {
        continue;
      }
      const edge = this._normalizeBaseRoutingEdge(edgeData);
      if (!edge) continue;
      this.baseRoutingEdges.set(edge.id, edge);
      if (Number.isSafeInteger(edge.shareId) && edge.shareId > 0) {
        this.baseRoutingEdgesByShareId.set(edge.shareId, edge);
      }
      if (this._baseTraversalVerdict(edge, 0, edge.lengthMeters).allowed) {
        this._addBaseRoutingAdjacency(edge.from, edge.to, edge, "forward");
      }
      if (this._baseTraversalVerdict(edge, edge.lengthMeters, 0).allowed) {
        this._addBaseRoutingAdjacency(edge.to, edge.from, edge, "reverse");
      }
      this._indexBaseRoutingEdge(edge);
      targetNetwork.edges.push(edgeData);
      addedEdges++;
    }

    if (this.baseRoutingEdges.size > 0) {
      this.baseRoutingNetwork = targetNetwork;
      this.baseRoutingGraphVersion = targetNetwork.graphVersion || "";
      this.baseRouteInfo = null;
      this.lastRouteFailure = null;
    }

    return { nodes: addedNodes, edges: addedEdges };
  }

  _setBaseRoutingProjection(nodes) {
    const latitudes = nodes
      .map((node) => Number(node?.coord?.[1]))
      .filter((latitude) => Number.isFinite(latitude));
    const averageLatitude =
      latitudes.length > 0
        ? latitudes.reduce((total, latitude) => total + latitude, 0) /
          latitudes.length
        : 0;
    this.baseRoutingMetersPerDegreeLng =
      this.baseRoutingMetersPerDegreeLat *
      Math.cos((averageLatitude * Math.PI) / 180);
  }

  _normalizeBaseRoutingEdge(edgeData) {
    if (
      !edgeData ||
      typeof edgeData.id !== "string" ||
      typeof edgeData.from !== "string" ||
      typeof edgeData.to !== "string" ||
      !Array.isArray(edgeData.coordinates)
    ) {
      return null;
    }

    const coordinates = edgeData.coordinates
      .map((coord) =>
        Array.isArray(coord) &&
        Number.isFinite(Number(coord[0])) &&
        Number.isFinite(Number(coord[1]))
          ? { lng: Number(coord[0]), lat: Number(coord[1]) }
          : null,
      )
      .filter((coord) => coord !== null);
    if (coordinates.length < 2) return null;

    const cumulativeLengths = [0];
    for (let index = 1; index < coordinates.length; index++) {
      cumulativeLengths[index] =
        cumulativeLengths[index - 1] +
        this._getDistance(coordinates[index - 1], coordinates[index]);
    }
    const measuredLength = cumulativeLengths[cumulativeLengths.length - 1];
    const distanceMeters = Number(edgeData.distanceMeters);

    return {
      id: edgeData.id,
      from: edgeData.from,
      to: edgeData.to,
      coordinates,
      cumulativeLengths,
      lengthMeters:
        Number.isFinite(distanceMeters) && distanceMeters > 0
          ? distanceMeters
          : measuredLength,
      measuredLength,
      shareId:
        Number.isSafeInteger(Number(edgeData.shareId)) && Number(edgeData.shareId) > 0
          ? Number(edgeData.shareId)
          : null,
      source: edgeData.source || "osm",
      routeClass: edgeData.routeClass || "other",
      highway: edgeData.highway || null,
      accessStatus: edgeData.accessStatus || null,
      roadType: edgeData.roadType || null,
      bicycleTraversal:
        edgeData.bicycleTraversal && typeof edgeData.bicycleTraversal === "object"
          ? { ...edgeData.bicycleTraversal }
          : null,
      cwSegmentIds: Array.isArray(edgeData.cwSegmentIds)
        ? edgeData.cwSegmentIds
            .map((segmentId) => Number(segmentId))
            .filter((segmentId) => Number.isFinite(segmentId))
        : [],
      cwAlignments:
        edgeData.cwAlignments && typeof edgeData.cwAlignments === "object"
          ? {
              forward: Array.isArray(edgeData.cwAlignments.forward)
                ? edgeData.cwAlignments.forward.map((value) => ({ ...value }))
                : [],
              reverse: Array.isArray(edgeData.cwAlignments.reverse)
                ? edgeData.cwAlignments.reverse.map((value) => ({ ...value }))
                : [],
            }
          : null,
      cwJunctions:
        edgeData.cwJunctions && typeof edgeData.cwJunctions === "object"
          ? {
              forward: Array.isArray(edgeData.cwJunctions.forward)
                ? edgeData.cwJunctions.forward.map((value) => ({ ...value }))
                : [],
              reverse: Array.isArray(edgeData.cwJunctions.reverse)
                ? edgeData.cwJunctions.reverse.map((value) => ({ ...value }))
                : [],
            }
          : null,
      shardIds: Array.isArray(edgeData.shardIds)
        ? [...new Set(edgeData.shardIds.map(String).filter(Boolean))].sort()
        : [],
      elevation: this._normalizeBaseRoutingElevation(edgeData.elevation),
    };
  }

  _normalizeBaseRoutingElevation(elevationData) {
    const fromMeters = Number(elevationData?.fromMeters);
    const toMeters = Number(elevationData?.toMeters);
    const explicitNetMeters = Number(elevationData?.netMeters);
    if (!Number.isFinite(fromMeters) || !Number.isFinite(toMeters)) {
      return null;
    }
    return {
      fromMeters,
      toMeters,
      netMeters: Number.isFinite(explicitNetMeters)
        ? explicitNetMeters
        : toMeters - fromMeters,
    };
  }

  _addBaseRoutingAdjacency(fromNodeId, toNodeId, edge, direction) {
    if (!this.baseRoutingAdjacency.has(fromNodeId)) {
      this.baseRoutingAdjacency.set(fromNodeId, []);
    }
    const fromDistance = direction === "reverse" ? edge.lengthMeters : 0;
    const toDistance = direction === "reverse" ? 0 : edge.lengthMeters;
    // Bake BOTH the default (cycling-preference) and connector (road-preference)
    // costs so the connector profile actually influences the graph search. The
    // search picks the field by the active profile; without this, the baked
    // cycling cost would win regardless of profile.
    this.baseRoutingAdjacency.get(fromNodeId).push({
      to: toNodeId,
      edgeId: edge.id,
      direction,
      distanceMeters: edge.lengthMeters,
      cost: this._baseRoutingTraversalCost(edge, fromDistance, toDistance, false),
      connectorCost: this._baseRoutingTraversalCost(
        edge,
        fromDistance,
        toDistance,
        true,
      ),
    });
  }

  _baseTraversalVerdict(edge, fromDistance, toDistance) {
    return bicycleTraversalVerdict(
      edge,
      fromDistance,
      toDistance,
      this.baseRoutingTraversalPolicy,
    );
  }

  _cwMembershipsForDirection(edge, direction) {
    if (edge?.cwAlignments) {
      return Array.isArray(edge.cwAlignments[direction])
        ? edge.cwAlignments[direction]
        : [];
    }
    return (edge?.cwSegmentIds || []).map((segmentId) => ({
      segmentId,
      alignmentKey: null,
      legacy: true,
    }));
  }

  _cwMembershipsForTraversal(edge, fromDistance, toDistance) {
    const direction = Number(toDistance) < Number(fromDistance) ? "reverse" : "forward";
    return this._cwMembershipsForDirection(edge, direction);
  }

  _junctionMembershipsForTraversal(edge, fromDistance, toDistance) {
    const direction = Number(toDistance) < Number(fromDistance) ? "reverse" : "forward";
    return Array.isArray(edge?.cwJunctions?.[direction]) ? edge.cwJunctions[direction] : [];
  }

  _activeConnectorStrategy() {
    return this._connectorStrategy || DEFAULT_CONNECTOR_STRATEGY;
  }

  _connectorEdgeAllowedFor(edge, strategy) {
    return evaluateConnectorEdge(edge, strategy || DEFAULT_CONNECTOR_STRATEGY).allowed;
  }

  _connectorEvaluationEdge(edge, fromDistance, toDistance) {
    if (!edge?.cwAlignments && !edge?.cwJunctions) return edge;
    const junctionMemberships = this._junctionMembershipsForTraversal(edge, fromDistance, toDistance);
    return {
      ...edge,
      // Connector classification is traversal-direction scoped in V3.  Strip
      // the aggregate alignment object so the shared model only sees the CW
      // memberships that apply to this particular traversal.
      cwAlignments: null,
      cwSegmentIds: this._cwMembershipsForTraversal(
        edge,
        fromDistance,
        toDistance,
      ).map((value) => value.segmentId),
      cwJunctions: junctionMemberships.length
        ? { forward: junctionMemberships, reverse: [] }
        : null,
    };
  }

  _connectorCostMultiplierFor(edge, fromDistance, toDistance) {
    return evaluateConnectorEdge(
      this._connectorEvaluationEdge(edge, fromDistance, toDistance),
      this._activeConnectorStrategy(),
    ).multiplier;
  }

  _connectorEdgeAllowed(edge) {
    return evaluateConnectorEdge(edge, this._activeConnectorStrategy()).allowed;
  }

  _connectorStepCost(adjEntry) {
    const edge = this.baseRoutingEdges.get(adjEntry.edgeId);
    if (!edge) return Infinity;
    const fromDistance = adjEntry.direction === "reverse" ? edge.lengthMeters : 0;
    const toDistance = adjEntry.direction === "reverse" ? 0 : edge.lengthMeters;
    return this._baseRoutingTraversalCost(edge, fromDistance, toDistance, true);
  }

  _connectorSnapAnyEndpointCostParts(edge, fromDistance, toDistance) {
    const verdict = evaluateConnectorEdge(
      this._connectorEvaluationEdge(edge, fromDistance, toDistance),
      this._activeConnectorStrategy(),
    );
    if (verdict.allowed) return null;
    const distanceMeters = Math.abs(toDistance - fromDistance);
    const costMultiplier = this._baseRoutingCostMultiplier(
      edge,
      false,
      fromDistance,
      toDistance,
    );
    const distanceCost = distanceMeters * costMultiplier;
    const uphillMeters = this._baseRoutingUphillMeters(
      edge,
      fromDistance,
      toDistance,
    );
    const uphillCost = uphillMeters * this._activeConnectorStrategy().uphillWeight;
    return {
      distanceMeters,
      costMultiplier,
      distanceCost,
      uphillMeters,
      uphillCost,
      cost: distanceCost + uphillCost,
      connectorSnapAnyEndpoint: true,
    };
  }

  _baseRoutingCostMultiplier(
    edge,
    connector = this._connectorCostProfile,
    fromDistance = 0,
    toDistance = edge?.lengthMeters || 0,
  ) {
    if (connector) {
      return this._connectorCostMultiplierFor(edge, fromDistance, toDistance);
    }
    if (
      this._cwMembershipsForTraversal(edge, fromDistance, toDistance).length > 0 ||
      this._junctionMembershipsForTraversal(edge, fromDistance, toDistance).length > 0
    ) return 1;
    if (edge.routeClass === "cycle") return 1.35;
    if (edge.routeClass === "path_track" || edge.routeClass === "manual") {
      return 1.6;
    }
    if (edge.routeClass === "local_road") return 2.2;
    if (edge.routeClass === "road" || edge.roadType === "road") return 4;
    return 2.5;
  }

  _baseRoutingDirectionalNetMeters(edge, fromDistance, toDistance) {
    if (!edge.elevation || edge.lengthMeters <= 0) return 0;
    const traversedFraction = Math.min(
      1,
      Math.abs(toDistance - fromDistance) / edge.lengthMeters,
    );
    const forwardNetMeters = edge.elevation.netMeters * traversedFraction;
    return toDistance < fromDistance ? -forwardNetMeters : forwardNetMeters;
  }

  _baseRoutingUphillMeters(edge, fromDistance, toDistance) {
    return Math.max(
      0,
      this._baseRoutingDirectionalNetMeters(edge, fromDistance, toDistance),
    );
  }

  _baseRoutingDownhillMeters(edge, fromDistance, toDistance) {
    return Math.max(
      0,
      -this._baseRoutingDirectionalNetMeters(edge, fromDistance, toDistance),
    );
  }

  _baseRoutingTraversalCostParts(
    edge,
    fromDistance,
    toDistance,
    connector = this._connectorCostProfile,
    options = {},
  ) {
    const policyVerdict = this._baseTraversalVerdict(
      edge,
      fromDistance,
      toDistance,
    );
    if (!policyVerdict.allowed) {
      return {
        distanceMeters: Math.abs(toDistance - fromDistance),
        costMultiplier: Infinity,
        distanceCost: Infinity,
        uphillMeters: 0,
        uphillCost: 0,
        cost: Infinity,
        policyVerdict,
      };
    }
    if (connector && options.snapAnyEndpoint) {
      const endpointParts = this._connectorSnapAnyEndpointCostParts(
        edge,
        fromDistance,
        toDistance,
      );
      if (endpointParts) return endpointParts;
    }
    const distanceMeters = Math.abs(toDistance - fromDistance);
    const costMultiplier = this._baseRoutingCostMultiplier(
      edge,
      connector,
      fromDistance,
      toDistance,
    );
    const distanceCost = distanceMeters * costMultiplier;
    const uphillMeters = this._baseRoutingUphillMeters(
      edge,
      fromDistance,
      toDistance,
    );
    const uphillWeight = connector
      ? this._activeConnectorStrategy().uphillWeight
      : this.baseRoutingUphillCostMetersPerMeter;
    const uphillCost = uphillMeters * uphillWeight;

    return {
      distanceMeters,
      costMultiplier,
      distanceCost,
      uphillMeters,
      uphillCost,
      cost: distanceCost + uphillCost,
    };
  }

  _baseRoutingTraversalCost(
    edge,
    fromDistance,
    toDistance,
    connector = this._connectorCostProfile,
    options = {},
  ) {
    return this._baseRoutingTraversalCostParts(
      edge,
      fromDistance,
      toDistance,
      connector,
      options,
    ).cost;
  }

  _baseProjection(point) {
    return {
      x: Number(point.lng) * this.baseRoutingMetersPerDegreeLng,
      y: Number(point.lat) * this.baseRoutingMetersPerDegreeLat,
    };
  }

  _baseRoutingCell(point) {
    const projected = this._baseProjection(point);
    return {
      x: Math.floor(projected.x / this.baseRoutingGridCellMeters),
      y: Math.floor(projected.y / this.baseRoutingGridCellMeters),
    };
  }

  _baseRoutingCellKey(cellX, cellY) {
    return `${cellX}:${cellY}`;
  }

  _indexBaseRoutingEdge(edge) {
    for (let coordIndex = 0; coordIndex < edge.coordinates.length - 1; coordIndex++) {
      const start = edge.coordinates[coordIndex];
      const end = edge.coordinates[coordIndex + 1];
      const startProjected = this._baseProjection(start);
      const endProjected = this._baseProjection(end);
      const minCellX = Math.floor(
        (Math.min(startProjected.x, endProjected.x) - this.snapThresholdMeters) /
          this.baseRoutingGridCellMeters,
      );
      const maxCellX = Math.floor(
        (Math.max(startProjected.x, endProjected.x) + this.snapThresholdMeters) /
          this.baseRoutingGridCellMeters,
      );
      const minCellY = Math.floor(
        (Math.min(startProjected.y, endProjected.y) - this.snapThresholdMeters) /
          this.baseRoutingGridCellMeters,
      );
      const maxCellY = Math.floor(
        (Math.max(startProjected.y, endProjected.y) + this.snapThresholdMeters) /
          this.baseRoutingGridCellMeters,
      );
      const segment = {
        edgeId: edge.id,
        coordIndex,
        start,
        end,
      };
      this.baseRoutingSpatialSegments.push(segment);

      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
          const key = this._baseRoutingCellKey(cellX, cellY);
          if (!this.baseRoutingSpatialGrid.has(key)) {
            this.baseRoutingSpatialGrid.set(key, []);
          }
          this.baseRoutingSpatialGrid.get(key).push(segment);
        }
      }
    }
  }

  _baseRoutingCandidates(point) {
    const cell = this._baseRoutingCell(point);
    const candidates = [];
    const seen = new Set();
    for (let cellX = cell.x - 1; cellX <= cell.x + 1; cellX++) {
      for (let cellY = cell.y - 1; cellY <= cell.y + 1; cellY++) {
        for (const segment of this.baseRoutingSpatialGrid.get(
          this._baseRoutingCellKey(cellX, cellY),
        ) || []) {
          const key = `${segment.edgeId}:${segment.coordIndex}`;
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push(segment);
        }
      }
    }
    return candidates;
  }

  _baseRoutingSnapCandidates(point, thresholdMeters = null, options = {}) {
    if (!this._isValidPoint(point)) return [];
    const normalizedPoint = { lat: Number(point.lat), lng: Number(point.lng) };
    const metersPerPixel = Number(point.metersPerPixel);
    const hasPixelScale = Number.isFinite(metersPerPixel) && metersPerPixel > 0;
    const effectiveThresholdMeters = Number.isFinite(thresholdMeters)
      ? thresholdMeters
      : hasPixelScale
        ? clampMeters(
            SNAP_THRESHOLD_PIXELS * metersPerPixel,
            SNAP_THRESHOLD_MIN_METERS,
            this.snapThresholdMeters,
          )
        : this.snapThresholdMeters;
    const edgeFilter =
      typeof options.edgeFilter === "function" ? options.edgeFilter : null;
    const preferredCwSegmentId = Number(point.preferredCwSegmentId);
    const hasPreferredCwSegment = Number.isSafeInteger(preferredCwSegmentId);
    const bestByEdge = new Map();

    for (const candidate of this._baseRoutingCandidates(normalizedPoint)) {
      const edge = this.baseRoutingEdges.get(candidate.edgeId);
      if (!edge || (edgeFilter && !edgeFilter(edge))) continue;
      const allowedDirections = ["forward", "reverse"].filter((direction) =>
        this._baseTraversalVerdict(
          edge,
          direction === "reverse" ? edge.lengthMeters : 0,
          direction === "reverse" ? 0 : edge.lengthMeters,
        ).allowed,
      );
      if (allowedDirections.length === 0) continue;
      const snapped = this._getClosestPointOnLineSegment(
        normalizedPoint,
        candidate.start,
        candidate.end,
      );
      const distanceMeters = this._getDistance(normalizedPoint, snapped);
      if (distanceMeters > effectiveThresholdMeters) continue;

      const baseSnap = this._buildBaseRoutingSnap(
        edge,
        candidate,
        snapped,
        distanceMeters,
      );
      const record = {
        ...baseSnap,
        requestedCoordinate: normalizedPoint,
        selectedAnchor: {
          edgeId: edge.id,
          edgeShareId: edge.shareId,
          edgeFraction: baseSnap.baseEdgeFraction,
        },
        snapProvenance: {
          source: "base-routing-candidate",
          displacementMeters: distanceMeters,
          allowedDirections,
        },
        isCyclewaysEdge:
          this._cwMembershipsForDirection(edge, "forward").length > 0 ||
          this._cwMembershipsForDirection(edge, "reverse").length > 0,
      };
      const existing = bestByEdge.get(edge.id);
      if (
        !existing ||
        distanceMeters < existing.distanceMeters ||
        (distanceMeters === existing.distanceMeters &&
          record.baseEdgeDistanceMeters < existing.baseEdgeDistanceMeters)
      ) {
        bestByEdge.set(edge.id, record);
      }
    }

    const limit = Math.min(
      MAX_BASE_SNAP_CANDIDATES,
      Math.max(1, Number(options.maxCandidates) || DEFAULT_BASE_SNAP_CANDIDATES),
    );
    const sortedCandidates = [...bestByEdge.values()].sort(
      (first, second) =>
        first.distanceMeters - second.distanceMeters ||
        String(first.baseEdgeId).localeCompare(String(second.baseEdgeId)) ||
        first.baseEdgeDistanceMeters - second.baseEdgeDistanceMeters,
    );
    if (hasPreferredCwSegment) {
      const preferredCandidates = sortedCandidates.filter((candidate) => {
        const edge = this.baseRoutingEdges.get(candidate.baseEdgeId);
        return (candidate.snapProvenance?.allowedDirections || []).some((direction) =>
          this._cwMembershipsForDirection(edge, direction).some(
            (membership) => Number(membership.segmentId) === preferredCwSegmentId,
          ),
        );
      });
      // A click on a visible CW line is an explicit choice of that logical
      // segment. Keep all ordinary fallback behavior when its current mapping
      // has no nearby routable edge, but do not silently migrate a valid click
      // to a parallel CW segment or roundabout approach.
      if (preferredCandidates.length > 0) {
        return preferredCandidates.slice(0, limit);
      }
    }
    return sortedCandidates.slice(0, limit);
  }

  _snapToBaseRoutingNetwork(point, thresholdMeters = null, options = {}) {
    if (!this._isValidPoint(point)) return null;
    const normalizedPoint = {
      lat: Number(point.lat),
      lng: Number(point.lng),
      ...(Number.isSafeInteger(Number(point.preferredCwSegmentId))
        ? { preferredCwSegmentId: Number(point.preferredCwSegmentId) }
        : {}),
    };
    const metersPerPixel = Number(point.metersPerPixel);
    const hasPixelScale = Number.isFinite(metersPerPixel) && metersPerPixel > 0;
    const effectiveThresholdMeters = Number.isFinite(thresholdMeters)
      ? thresholdMeters
      : hasPixelScale
        ? clampMeters(
            SNAP_THRESHOLD_PIXELS * metersPerPixel,
            SNAP_THRESHOLD_MIN_METERS,
            this.snapThresholdMeters,
          )
        : this.snapThresholdMeters;
    const cwMarginMeters = hasPixelScale
      ? clampMeters(
          CW_SNAP_PREFERENCE_PIXELS * metersPerPixel,
          CW_SNAP_PREFERENCE_MIN_METERS,
          CW_SNAP_PREFERENCE_MARGIN_METERS,
        )
      : CW_SNAP_PREFERENCE_MARGIN_METERS;
    const candidates = this._baseRoutingSnapCandidates(
      normalizedPoint,
      effectiveThresholdMeters,
      { ...options, maxCandidates: MAX_BASE_SNAP_CANDIDATES },
    );
    const best = candidates[0] || null;
    const bestCw = candidates.find((candidate) => candidate.isCyclewaysEdge) || null;

    if (!best) return null;
    // Prefer the closest CycleWays edge when it is within the preference margin
    // of the closest edge overall, so endpoints favour the CW network where a CW
    // path runs near a road. The ratio guard keeps clicks (and re-snaps) that
    // land decisively closer to a non-CW edge on that edge.
    if (
      bestCw &&
      bestCw.distanceMeters <= best.distanceMeters + cwMarginMeters &&
      bestCw.distanceMeters <=
        Math.max(
          CW_SNAP_PREFERENCE_MAX_RATIO * best.distanceMeters,
          CW_SNAP_PREFERENCE_RATIO_FLOOR_METERS,
        )
    ) {
      return bestCw;
    }
    return best;
  }

  _buildBaseRoutingSnap(edge, candidate, snapped, distanceMeters) {
    const measuredAlongMeters =
      edge.cumulativeLengths[candidate.coordIndex] +
      this._getDistance(candidate.start, snapped);
    const measuredFraction =
      edge.measuredLength > 0 ? measuredAlongMeters / edge.measuredLength : 0;
    const edgeDistanceMeters = Math.max(
      0,
      Math.min(edge.lengthMeters, measuredFraction * edge.lengthMeters),
    );
    return {
      lat: snapped.lat,
      lng: snapped.lng,
      distanceMeters,
      baseEdgeId: edge.id,
      baseEdgeShareId: edge.shareId,
      baseEdgeDistanceMeters: edgeDistanceMeters,
      baseEdgeFraction:
        edge.lengthMeters > 0 ? edgeDistanceMeters / edge.lengthMeters : 0,
      segmentName: this._primaryCyclewaysSegmentName(edge),
    };
  }

  _primaryCyclewaysSegmentName(edge) {
    const memberships = [
      ...this._cwMembershipsForDirection(edge, "forward"),
      ...this._cwMembershipsForDirection(edge, "reverse"),
    ];
    for (const segmentId of new Set(memberships.map((value) => value.segmentId))) {
      const name = this.segmentNamesById.get(Number(segmentId));
      if (name) return name;
    }
    return null;
  }

  _recalculateRoute() {
    // Filter out any undefined or invalid points from routePoints
    this.routePoints = this.routePoints.filter(
      (point) => point && point.lat !== undefined && point.lng !== undefined,
    );

    if (this.routePoints.length === 0) {
      this.selectedSegments = [];
      this.baseRouteInfo = null;
      this.lastRouteFailure = null;
      return;
    }

    if (this.routePoints.length === 1) {
      this.selectedSegments = [];
      this.baseRouteInfo = null;
      this.lastRouteFailure = null;
      return;
    }

    if (this.baseRoutingNetwork) {
      const candidate = this.planBaseRouteCandidate(this.routePoints);
      if (!candidate.ok) {
        this.baseRouteInfo = this._emptyBaseRoute(candidate.failure);
        this.selectedSegments = [];
        this.lastRouteFailure = candidate.failure;
        return;
      }
      this.routePoints = candidate.routePoints;
      this.baseRouteInfo = candidate.route;
      this.selectedSegments = [...candidate.route.segments];
      this.lastRouteFailure = null;
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

  _emptyBaseRoute(failure = null) {
    return {
      segments: [],
      orderedCoordinates: [],
      traversals: [],
      legs: [],
      distance: 0,
      cost: 0,
      distanceCost: 0,
      uphillCost: 0,
      cyclewaysDistance: 0,
      nonCyclewaysDistance: 0,
      uphillMeters: 0,
      downhillMeters: 0,
      failure,
    };
  }

  _calculateBaseRoute(routePoints) {
    if (!Array.isArray(routePoints) || routePoints.length < 2) {
      return this._emptyBaseRoute();
    }

    const route = this._emptyBaseRoute();
    for (let index = 0; index < routePoints.length - 1; index++) {
      const leg = this._routeBaseGraphLeg(routePoints[index], routePoints[index + 1]);
      if (!leg) {
        return this._emptyBaseRoute("No connected base graph route was found for the selected points.");
      }
      route.legs.push(leg);
      this._appendBaseLegToRoute(route, leg);
    }

    route.segments = this._cyclewaysSegmentsForBaseTraversals(route.traversals);
    return route;
  }

  /**
   * Plan a route without mutating the currently committed route.  Candidate
   * selection is joint across waypoint occurrences, so one interior anchor is
   * used for both adjacent legs while repeated coordinates remain independent.
   */
  planBaseRouteCandidate(points, options = {}) {
    const requestedPoints = (Array.isArray(points) ? points : []).filter((point) =>
      this._isValidPoint(point),
    );
    if (!this.baseRoutingNetwork || requestedPoints.length === 0) {
      return { ok: false, failure: "no-base-network", routePoints: [], route: null };
    }

    const thresholdMeters = Number.isFinite(Number(options.thresholdMeters))
      ? Math.max(0, Number(options.thresholdMeters))
      : null;
    const candidateLayers = requestedPoints.map((point, index) =>
      this._baseRoutingSnapCandidates(point, thresholdMeters, options).map(
        (candidate) => ({
          ...candidate,
          id: point.id || `route-point-${index}`,
          occurrenceId: point.occurrenceId || point.id || `occurrence-${index}`,
          legPurpose: point.legPurpose || "ordinary",
          requestedCoordinate: {
            lat: Number(point.lat),
            lng: Number(point.lng),
            ...(Number.isSafeInteger(Number(point.preferredCwSegmentId))
              ? { preferredCwSegmentId: Number(point.preferredCwSegmentId) }
              : {}),
          },
        }),
      ),
    );
    if (candidateLayers.some((layer) => layer.length === 0)) {
      return {
        ok: false,
        failure: "snap-failed",
        routePoints: candidateLayers.map((layer, index) =>
          layer[0] || {
            ...requestedPoints[index],
            unsnapped: true,
            occurrenceId:
              requestedPoints[index].occurrenceId ||
              requestedPoints[index].id ||
              `occurrence-${index}`,
          },
        ),
        route: null,
      };
    }
    if (candidateLayers.length === 1) {
      return {
        ok: true,
        failure: null,
        routePoints: [candidateLayers[0][0]],
        route: this._emptyBaseRoute(),
      };
    }

    let states = candidateLayers[0].map((candidate, candidateIndex) => ({
      candidate,
      candidateIndex,
      score:
        Number(candidate.distanceMeters || 0) * SNAP_DISPLACEMENT_COST_PER_METER,
      legs: [],
      routePoints: [candidate],
      tieKey: `${candidate.baseEdgeId}:${candidate.baseEdgeDistanceMeters}`,
    }));

    for (let layerIndex = 1; layerIndex < candidateLayers.length; layerIndex++) {
      const nextStates = [];
      for (const [candidateIndex, candidate] of candidateLayers[layerIndex].entries()) {
        // The next boundary score depends on the directed traversal used to
        // arrive here. Retain the best state per arrival signature instead of
        // collapsing all paths to one state per snap candidate.
        const bestStatesByArrival = new Map();
        for (const previousState of states) {
          const leg = this._routeBaseGraphLeg(previousState.candidate, candidate);
          if (!leg || !Number.isFinite(leg.cost)) continue;
          const boundaryPenalty = this._shortViaReversalPenalty(
            previousState.legs.at(-1),
            leg,
          );
          const score =
            previousState.score +
            leg.cost +
            Number(candidate.distanceMeters || 0) * SNAP_DISPLACEMENT_COST_PER_METER +
            boundaryPenalty;
          const tieKey = `${previousState.tieKey}|${candidate.baseEdgeId}:${candidate.baseEdgeDistanceMeters}`;
          const arrivalKey = this._baseLegArrivalSignature(leg);
          const bestState = bestStatesByArrival.get(arrivalKey);
          if (
            !bestState ||
            score < bestState.score ||
            (score === bestState.score && tieKey < bestState.tieKey)
          ) {
            bestStatesByArrival.set(arrivalKey, {
              candidate,
              candidateIndex,
              score,
              legs: [...previousState.legs, leg],
              routePoints: [...previousState.routePoints, candidate],
              tieKey,
            });
          }
        }
        nextStates.push(...bestStatesByArrival.values());
      }
      states = nextStates;
      if (states.length === 0) {
        return {
          ok: false,
          failure: "no-permitted-path",
          routePoints: candidateLayers.map((layer) => layer[0]),
          route: null,
        };
      }
    }

    states.sort(
      (first, second) => first.score - second.score || first.tieKey.localeCompare(second.tieKey),
    );
    const selected = states[0];
    const route = this._emptyBaseRoute();
    for (const leg of selected.legs) {
      route.legs.push(leg);
      this._appendBaseLegToRoute(route, leg);
    }
    route.segments = this._cyclewaysSegmentsForBaseTraversals(route.traversals);
    return {
      ok: true,
      failure: null,
      routePoints: selected.routePoints,
      route,
      snapCandidateCounts: candidateLayers.map((layer) => layer.length),
      score: selected.score,
    };
  }

  _baseLegArrivalSignature(leg) {
    const traversal = leg?.traversals?.at(-1);
    if (!traversal?.edge?.id) return "none";
    const fromDistance = Number(traversal.fromDistance) || 0;
    const toDistance = Number(traversal.toDistance) || 0;
    return `${traversal.edge.id}:${traversal.direction}:${fromDistance.toFixed(3)}:${toDistance.toFixed(3)}`;
  }

  _shortViaReversalPenalty(incomingLeg, outgoingLeg) {
    const incoming = incomingLeg?.traversals?.at(-1);
    const outgoing = outgoingLeg?.traversals?.[0];
    if (
      !incoming?.edge?.id ||
      incoming.edge.id !== outgoing?.edge?.id ||
      incoming.direction === outgoing.direction
    ) {
      return 0;
    }

    const incomingStart = Math.min(incoming.fromDistance, incoming.toDistance);
    const incomingEnd = Math.max(incoming.fromDistance, incoming.toDistance);
    const outgoingStart = Math.min(outgoing.fromDistance, outgoing.toDistance);
    const outgoingEnd = Math.max(outgoing.fromDistance, outgoing.toDistance);
    const overlapMeters = Math.max(
      0,
      Math.min(incomingEnd, outgoingEnd) -
        Math.max(incomingStart, outgoingStart),
    );
    return overlapMeters > BASE_TRAVERSAL_EPSILON_METERS &&
      overlapMeters <= SHORT_VIA_REVERSAL_MAX_OVERLAP_METERS
      ? SHORT_VIA_REVERSAL_PENALTY_COST
      : 0;
  }

  _appendBaseLegToRoute(route, leg) {
    for (const traversal of leg.traversals) {
      route.traversals.push(traversal);
    }
    for (const coordinate of leg.orderedCoordinates) {
      this._appendCoordinate(route.orderedCoordinates, coordinate);
    }
    route.distance += leg.distance;
    route.cost += leg.cost;
    route.distanceCost += leg.distanceCost;
    route.uphillCost += leg.uphillCost;
    route.cyclewaysDistance += leg.cyclewaysDistance;
    route.nonCyclewaysDistance += leg.nonCyclewaysDistance;
    route.uphillMeters += leg.uphillMeters;
    route.downhillMeters += leg.downhillMeters;
  }

  _cyclewaysSegmentsForBaseTraversals(traversals) {
    const segments = [];
    for (const traversal of traversals) {
      for (const membership of traversal.cwMemberships || []) {
        const segmentId = membership.segmentId;
        const name = this.segmentNamesById.get(Number(segmentId));
        if (
          name &&
          (segments.length === 0 || segments[segments.length - 1] !== name)
        ) {
          segments.push(name);
        }
      }
    }
    return segments;
  }

  _routeBaseGraphLeg(startPoint, endPoint) {
    const startEdge = this.baseRoutingEdges.get(startPoint.baseEdgeId);
    const endEdge = this.baseRoutingEdges.get(endPoint.baseEdgeId);
    if (!startEdge || !endEdge) return null;

    const startDistance = this._baseSnapDistanceOnEdge(startPoint, startEdge);
    const endDistance = this._baseSnapDistanceOnEdge(endPoint, endEdge);
    const search = this._searchBaseGraphEndpoints(
      startEdge,
      startDistance,
      endEdge,
      endDistance,
    );
    const candidates = [];

    if (search) {
      candidates.push(search);
    }
    if (startEdge.id === endEdge.id) {
      candidates.push({
        traversals: [
          this._baseTraversal(startEdge, startDistance, endDistance),
        ],
      });
    }

    let best = null;
    for (const candidate of candidates) {
      const leg = this._baseLegFromTraversals(candidate.traversals);
      if (!leg || !Number.isFinite(leg.cost)) continue;
      if (!best || leg.cost < best.cost) {
        best = leg;
      }
    }
    return best;
  }

  _baseRoutePointFromShareAnchor(anchor, index) {
    const shareId = Number(anchor?.baseEdgeShareId ?? anchor?.edgeShareId);
    if (!Number.isSafeInteger(shareId) || shareId <= 0) {
      return null;
    }
    const edge = this.baseRoutingEdgesByShareId.get(shareId);
    if (!edge) {
      return null;
    }
    const fraction = Math.max(
      0,
      Math.min(1, Number(anchor?.baseEdgeFraction ?? anchor?.edgeFraction) || 0),
    );
    const distanceAlong = edge.lengthMeters * fraction;
    const measuredDistance =
      edge.lengthMeters > 0
        ? (distanceAlong / edge.lengthMeters) * edge.measuredLength
        : 0;
    const point = this._basePointAtMeasuredDistance(edge, measuredDistance);
    return {
      ...point,
      id: anchor?.id || `route-point-${Date.now()}-${index}`,
      baseEdgeId: edge.id,
      baseEdgeShareId: edge.shareId,
      baseEdgeDistanceMeters: distanceAlong,
      baseEdgeFraction: fraction,
      segmentName: this._primaryCyclewaysSegmentName(edge),
    };
  }

  _baseLegFromSharePayload(legPayload, startPoint, endPoint) {
    const edgeShareIds = Array.isArray(legPayload?.edgeShareIds)
      ? legPayload.edgeShareIds
      : Array.isArray(legPayload?.edges)
        ? legPayload.edges
        : [];
    const directions = Array.isArray(legPayload?.directions)
      ? legPayload.directions
      : [];
    if (edgeShareIds.length === 0) return null;

    const directedEdges = edgeShareIds.map((edgeShareId, index) => {
      const shareId = Number(edgeShareId);
      const edge =
        Number.isSafeInteger(shareId) && shareId > 0
          ? this.baseRoutingEdgesByShareId.get(shareId)
          : null;
      const direction =
        directions[index] === "reverse" || directions[index] === 1
          ? "reverse"
          : "forward";
      return edge ? { edge, direction } : null;
    });
    if (directedEdges.some((entry) => entry === null)) return null;

    const firstDirectedEdge = directedEdges[0];
    const lastDirectedEdge = directedEdges[directedEdges.length - 1];
    const startSharesFirstEdge =
      firstDirectedEdge.edge.shareId === startPoint.baseEdgeShareId;
    const endSharesLastEdge =
      lastDirectedEdge.edge.shareId === endPoint.baseEdgeShareId;
    if (
      (!startSharesFirstEdge &&
        this._baseAnchorEndpointNode(startPoint) !==
          this._baseDirectedStartNode(firstDirectedEdge.edge, firstDirectedEdge.direction)) ||
      (!endSharesLastEdge &&
        this._baseAnchorEndpointNode(endPoint) !==
          this._baseDirectedEndNode(lastDirectedEdge.edge, lastDirectedEdge.direction))
    ) {
      return null;
    }

    for (let index = 0; index < directedEdges.length - 1; index++) {
      const currentEnd = this._baseDirectedEndNode(
        directedEdges[index].edge,
        directedEdges[index].direction,
      );
      const nextStart = this._baseDirectedStartNode(
        directedEdges[index + 1].edge,
        directedEdges[index + 1].direction,
      );
      if (!currentEnd || currentEnd !== nextStart) {
        return null;
      }
    }

    const traversals = directedEdges.map(({ edge, direction }, index) => {
      const first = index === 0;
      const last = index === directedEdges.length - 1;
      const startDistance = startSharesFirstEdge
        ? this._baseSnapDistanceOnEdge(startPoint, edge)
        : direction === "reverse"
          ? edge.lengthMeters
          : 0;
      const endDistance = endSharesLastEdge
        ? this._baseSnapDistanceOnEdge(endPoint, edge)
        : direction === "reverse"
          ? 0
          : edge.lengthMeters;
      if (first && last) {
        return this._baseTraversal(
          edge,
          startDistance,
          endDistance,
        );
      }
      if (first) {
        return this._baseTraversal(
          edge,
          startDistance,
          direction === "reverse" ? 0 : edge.lengthMeters,
        );
      }
      if (last) {
        return this._baseTraversal(
          edge,
          direction === "reverse" ? edge.lengthMeters : 0,
          endDistance,
        );
      }
      return this._baseTraversal(
        edge,
        direction === "reverse" ? edge.lengthMeters : 0,
        direction === "reverse" ? 0 : edge.lengthMeters,
      );
    });

    for (let index = 0; index < traversals.length; index++) {
      const traversal = traversals[index];
      if (
        Math.abs(traversal.toDistance - traversal.fromDistance) > 1e-6 &&
        traversal.direction !== directedEdges[index].direction
      ) {
        return null;
      }
    }

    return this._baseLegFromTraversals(traversals);
  }

  _baseDirectedStartNode(edge, direction) {
    return direction === "reverse" ? edge.to : edge.from;
  }

  _baseDirectedEndNode(edge, direction) {
    return direction === "reverse" ? edge.from : edge.to;
  }

  _baseAnchorEndpointNode(point) {
    const edge = this.baseRoutingEdgesByShareId.get(Number(point?.baseEdgeShareId));
    if (!edge) return null;
    const distance = this._baseSnapDistanceOnEdge(point, edge);
    const toleranceMeters = Math.max(0.02, edge.lengthMeters / 1_000_000 + 0.01);
    if (distance <= toleranceMeters) return edge.from;
    if (edge.lengthMeters - distance <= toleranceMeters) return edge.to;
    return null;
  }

  _baseSnapDistanceOnEdge(point, edge) {
    const distance = Number(point.baseEdgeDistanceMeters);
    if (Number.isFinite(distance)) {
      return Math.max(0, Math.min(edge.lengthMeters, distance));
    }
    const fraction = Number(point.baseEdgeFraction);
    if (Number.isFinite(fraction)) {
      return Math.max(0, Math.min(edge.lengthMeters, fraction * edge.lengthMeters));
    }
    const projection = this._projectPointOntoCoordinates(point, edge.coordinates);
    return projection
      ? Math.max(0, Math.min(edge.lengthMeters, projection.distanceAlong))
      : 0;
  }

  _baseEndpointOptions(edge, distanceAlong, kind) {
    const distanceToStart = Math.max(0, distanceAlong);
    const distanceToEnd = Math.max(0, edge.lengthMeters - distanceAlong);
    const traversalOptions = this._connectorSnapAnyEndpoints
      ? { snapAnyEndpoint: true }
      : {};
    if (kind === "start") {
      const startTraversal = this._baseTraversal(edge, distanceAlong, 0, traversalOptions);
      const endTraversal = this._baseTraversal(
        edge,
        distanceAlong,
        edge.lengthMeters,
        traversalOptions,
      );
      return [
        {
          nodeId: edge.from,
          cost: startTraversal.cost,
          traversal: startTraversal,
        },
        {
          nodeId: edge.to,
          cost: endTraversal.cost,
          traversal: endTraversal,
        },
      ];
    }
    const startTraversal = this._baseTraversal(edge, 0, distanceAlong, traversalOptions);
    const endTraversal = this._baseTraversal(
      edge,
      edge.lengthMeters,
      distanceAlong,
      traversalOptions,
    );
    return [
      {
        nodeId: edge.from,
        cost: startTraversal.cost,
        traversal: startTraversal,
      },
      {
        nodeId: edge.to,
        cost: endTraversal.cost,
        traversal: endTraversal,
      },
    ];
  }

  _searchBaseGraphEndpoints(startEdge, startDistance, endEdge, endDistance) {
    const startOptions = this._baseEndpointOptions(startEdge, startDistance, "start");
    const targetOptions = this._baseEndpointOptions(endEdge, endDistance, "target");
    const targetOptionsByNode = new Map();
    for (const targetOption of targetOptions) {
      if (!Number.isFinite(targetOption.cost)) continue;
      if (
        !targetOptionsByNode.has(targetOption.nodeId) ||
        targetOption.cost < targetOptionsByNode.get(targetOption.nodeId).cost
      ) {
        targetOptionsByNode.set(targetOption.nodeId, targetOption);
      }
    }

    const distances = new Map();
    const previous = new Map();
    const chosenStart = new Map();
    const heap = [];
    for (const startOption of startOptions) {
      if (!Number.isFinite(startOption.cost)) continue;
      if (
        !distances.has(startOption.nodeId) ||
        startOption.cost < distances.get(startOption.nodeId)
      ) {
        distances.set(startOption.nodeId, startOption.cost);
        chosenStart.set(startOption.nodeId, startOption);
        this._pushBaseHeap(heap, {
          nodeId: startOption.nodeId,
          cost: startOption.cost,
        });
      }
    }

    let bestTarget = null;
    while (heap.length > 0) {
      const current = this._popBaseHeap(heap);
      if (!current || current.cost !== distances.get(current.nodeId)) continue;
      if (bestTarget && current.cost >= bestTarget.cost) break;

      const targetOption = targetOptionsByNode.get(current.nodeId);
      if (targetOption) {
        const targetCost = current.cost + targetOption.cost;
        if (!bestTarget || targetCost < bestTarget.cost) {
          bestTarget = {
            nodeId: current.nodeId,
            targetOption,
            cost: targetCost,
          };
        }
      }

      for (const edge of this.baseRoutingAdjacency.get(current.nodeId) || []) {
        const stepCost = this._connectorCostProfile
          ? this._connectorStrategy
            ? this._connectorStepCost(edge)
            : edge.connectorCost
          : edge.cost;
        if (!Number.isFinite(stepCost)) continue;
        const nextCost = current.cost + stepCost;
        if (nextCost >= (distances.get(edge.to) ?? Infinity)) continue;
        distances.set(edge.to, nextCost);
        previous.set(edge.to, {
          nodeId: current.nodeId,
          edgeId: edge.edgeId,
          direction: edge.direction,
        });
        chosenStart.set(edge.to, chosenStart.get(current.nodeId));
        this._pushBaseHeap(heap, { nodeId: edge.to, cost: nextCost });
      }
    }

    if (!bestTarget) return null;
    const startOption = chosenStart.get(bestTarget.nodeId);
    if (!startOption) return null;

    const graphTraversals = [];
    let nodeId = bestTarget.nodeId;
    while (previous.has(nodeId)) {
      const previousStep = previous.get(nodeId);
      const edge = this.baseRoutingEdges.get(previousStep.edgeId);
      if (!edge) return null;
      graphTraversals.unshift(
        previousStep.direction === "reverse"
          ? this._baseTraversal(edge, edge.lengthMeters, 0)
          : this._baseTraversal(edge, 0, edge.lengthMeters),
      );
      nodeId = previousStep.nodeId;
    }

    return {
      traversals: [
        startOption.traversal,
        ...graphTraversals,
        bestTarget.targetOption.traversal,
      ].filter((traversal) => traversal.distanceMeters > 0.01),
    };
  }

  _pushBaseHeap(heap, item) {
    heap.push(item);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (heap[parent].cost <= heap[index].cost) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
  }

  _popBaseHeap(heap) {
    if (heap.length === 0) return null;
    const first = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let next = index;
        if (left < heap.length && heap[left].cost < heap[next].cost) {
          next = left;
        }
        if (right < heap.length && heap[right].cost < heap[next].cost) {
          next = right;
        }
        if (next === index) break;
        [heap[index], heap[next]] = [heap[next], heap[index]];
        index = next;
      }
    }
    return first;
  }

  _baseTraversal(edge, fromDistance, toDistance, options = {}) {
    const policyVerdict = this._baseTraversalVerdict(
      edge,
      fromDistance,
      toDistance,
    );
    const costParts = this._baseRoutingTraversalCostParts(
      edge,
      fromDistance,
      toDistance,
      this._connectorCostProfile,
      options,
    );
    return {
      edge,
      fromDistance,
      toDistance,
      direction: toDistance < fromDistance ? "reverse" : "forward",
      policyVerdict,
      cwMemberships: this._cwMembershipsForTraversal(
        edge,
        fromDistance,
        toDistance,
      ).map((value) => ({ ...value })),
      junctionMemberships: this._junctionMembershipsForTraversal(
        edge,
        fromDistance,
        toDistance,
      ).map((value) => ({ ...value })),
      ...costParts,
      downhillMeters: this._baseRoutingDownhillMeters(
        edge,
        fromDistance,
        toDistance,
      ),
    };
  }

  _baseLegFromTraversals(traversals) {
    const policyValidation = validateTraversalSlices(
      traversals,
      this.baseRoutingTraversalPolicy,
    );
    if (!policyValidation.ok) return null;
    const leg = {
      traversals: traversals.filter((traversal) => traversal.distanceMeters > 0.01),
      orderedCoordinates: [],
      distance: 0,
      cost: 0,
      distanceCost: 0,
      uphillCost: 0,
      cyclewaysDistance: 0,
      nonCyclewaysDistance: 0,
      uphillMeters: 0,
      downhillMeters: 0,
    };
    for (const traversal of leg.traversals) {
      for (const coordinate of this._sliceBaseEdgeByDistance(
        traversal.edge,
        traversal.fromDistance,
        traversal.toDistance,
      )) {
        this._appendCoordinate(leg.orderedCoordinates, coordinate);
      }
      leg.distance += traversal.distanceMeters;
      leg.cost += traversal.cost;
      leg.distanceCost += traversal.distanceCost;
      leg.uphillCost += traversal.uphillCost;
      leg.uphillMeters += traversal.uphillMeters;
      leg.downhillMeters += traversal.downhillMeters;
      if ((traversal.cwMemberships || []).length > 0) {
        leg.cyclewaysDistance += traversal.distanceMeters;
      } else {
        leg.nonCyclewaysDistance += traversal.distanceMeters;
      }
    }
    return leg;
  }

  _sliceBaseEdgeByDistance(edge, fromDistance, toDistance) {
    if (toDistance < fromDistance) {
      return this._sliceBaseEdgeByDistance(edge, toDistance, fromDistance).reverse();
    }

    const fromMeasured =
      edge.lengthMeters > 0
        ? (Math.max(0, fromDistance) / edge.lengthMeters) * edge.measuredLength
        : 0;
    const toMeasured =
      edge.lengthMeters > 0
        ? (Math.min(edge.lengthMeters, toDistance) / edge.lengthMeters) *
          edge.measuredLength
        : edge.measuredLength;
    const coordinates = [];
    this._appendCoordinate(coordinates, this._basePointAtMeasuredDistance(edge, fromMeasured));
    for (let index = 1; index < edge.coordinates.length - 1; index++) {
      if (
        edge.cumulativeLengths[index] > fromMeasured &&
        edge.cumulativeLengths[index] < toMeasured
      ) {
        this._appendCoordinate(
          coordinates,
          this._basePointAtMeasuredDistance(edge, edge.cumulativeLengths[index]),
        );
      }
    }
    this._appendCoordinate(coordinates, this._basePointAtMeasuredDistance(edge, toMeasured));
    return coordinates;
  }

  _basePointAtMeasuredDistance(edge, distanceMeters) {
    const target = Math.max(0, Math.min(edge.measuredLength, distanceMeters));
    for (let index = 0; index < edge.coordinates.length - 1; index++) {
      const startDistance = edge.cumulativeLengths[index];
      const endDistance = edge.cumulativeLengths[index + 1];
      if (target > endDistance && index < edge.coordinates.length - 2) {
        continue;
      }
      const segmentDistance = Math.max(0.000001, endDistance - startDistance);
      const fraction = Math.max(
        0,
        Math.min(1, (target - startDistance) / segmentDistance),
      );
      const start = edge.coordinates[index];
      const end = edge.coordinates[index + 1];
      const point = {
        lng: start.lng + (end.lng - start.lng) * fraction,
        lat: start.lat + (end.lat - start.lat) * fraction,
      };
      const elevation = this._baseElevationAtMeasuredDistance(edge, target);
      if (elevation !== null) {
        point.elevation = elevation;
      }
      return point;
    }
    const point = {
      ...edge.coordinates[edge.coordinates.length - 1],
    };
    const elevation = this._baseElevationAtMeasuredDistance(edge, target);
    if (elevation !== null) {
      point.elevation = elevation;
    }
    return point;
  }

  _baseElevationAtMeasuredDistance(edge, distanceMeters) {
    if (!edge.elevation || edge.measuredLength <= 0) return null;
    const fraction = Math.max(
      0,
      Math.min(1, distanceMeters / edge.measuredLength),
    );
    return (
      edge.elevation.fromMeters +
      (edge.elevation.toMeters - edge.elevation.fromMeters) * fraction
    );
  }

  _findOptimalRouteThroughPoints(points) {
    if (points.length === 0) return [];

    // Filter out any undefined or invalid points
    const validPoints = points.filter(
      (point) => point && point.lat !== undefined && point.lng !== undefined,
    );

    if (validPoints.length === 0) return [];
    if (validPoints.length === 1) {
      return [];
    }

    let allSegments = [];

    for (let i = 0; i < validPoints.length - 1; i++) {
      const legPlan = this._buildLegPlan(validPoints[i], validPoints[i + 1]);
      if (!legPlan) continue;

      for (const segmentName of legPlan.segments) {
        if (
          allSegments.length === 0 ||
          allSegments[allSegments.length - 1] !== segmentName
        ) {
          allSegments.push(segmentName);
        }
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
    return this._getRouteCoordinatesThroughPoints();
  }

  _getRouteCoordinatesThroughPoints(routePoints = this.routePoints) {
    if (routePoints.length < 2) return [];

    const routeCoords = [];

    for (let i = 0; i < routePoints.length - 1; i++) {
      const legCoords = this._getLegCoordinates(
        routePoints[i],
        routePoints[i + 1],
      );

      for (const coord of legCoords) {
        this._appendCoordinate(routeCoords, coord);
      }
    }

    return routeCoords;
  }

  _snapRoutePoints(points, options = {}) {
    if (!Array.isArray(points)) return [];

    return points
      .map((point) => {
        if (!this._isValidPoint(point)) {
          return null;
        }

        const {
          baseEdgeDistanceMeters,
          baseEdgeId,
          distanceMeters,
          segmentName,
          unsnapped,
          ...routePoint
        } = point;
        const lat = Number(point.lat);
        const lng = Number(point.lng);
        const snappedPoint = this.snapToNetwork({
          lat,
          lng,
        }, null, options);

        if (snappedPoint) {
          return {
            ...routePoint,
            ...snappedPoint,
            lat: snappedPoint.lat,
            lng: snappedPoint.lng,
            segmentName: snappedPoint.segmentName,
            unsnapped: false,
          };
        }

        return {
          ...routePoint,
          lat,
          lng,
          unsnapped: true,
        };
      })
      .filter((point) => point !== null);
  }

  _buildLegPlan(startPoint, endPoint) {
    const startSegmentName = this._findSegmentForPoint(startPoint);
    const endSegmentName = this._findSegmentForPoint(endPoint);
    if (!startSegmentName || !endSegmentName) return null;

    if (startSegmentName === endSegmentName) {
      return {
        segments: [startSegmentName],
        middleSegments: [],
        startSegmentName,
        endSegmentName,
        sameSegment: true,
      };
    }

    let bestPlan = null;
    const endpointKeys = ["S", "E"];

    for (const startExitKey of endpointKeys) {
      for (const endEntryKey of endpointKeys) {
        const startNode = `${startSegmentName}|${startExitKey}`;
        const endNode = `${endSegmentName}|${endEntryKey}`;
        const nodePath = this._dijkstraPath(startNode, endNode);
        if (!nodePath || nodePath.length === 0) continue;

        const graphWeight = this._pathWeight(nodePath);
        if (!Number.isFinite(graphWeight)) continue;

        const startPartialDistance = this._distanceFromPointToEndpoint(
          startPoint,
          startSegmentName,
          startExitKey,
        );
        const endPartialDistance = this._distanceFromEndpointToPoint(
          endPoint,
          endSegmentName,
          endEntryKey,
        );
        const totalWeight =
          startPartialDistance + graphWeight + endPartialDistance;

        const middleSegments = this
          ._nodesPathToSegments(nodePath)
          .filter(
            (segmentName) =>
              segmentName !== startSegmentName &&
              segmentName !== endSegmentName,
          );
        const segments = this._dedupeConsecutiveSegments([
          startSegmentName,
          ...middleSegments,
          endSegmentName,
        ]);

        if (!bestPlan || totalWeight < bestPlan.totalWeight) {
          bestPlan = {
            segments,
            middleSegments,
            startSegmentName,
            endSegmentName,
            startExitKey,
            endEntryKey,
            totalWeight,
            sameSegment: false,
          };
        }
      }
    }

    if (bestPlan) return bestPlan;

    const fallbackSegments = this._findPathBetweenPoints(startPoint, endPoint);
    if (fallbackSegments.length === 0) return null;

    return {
      segments: fallbackSegments,
      middleSegments: fallbackSegments.slice(1, -1),
      startSegmentName,
      endSegmentName,
      startExitKey: this._nearestEndpointKeyToPoint(startSegmentName, startPoint),
      endEntryKey: this._nearestEndpointKeyToPoint(endSegmentName, endPoint),
      sameSegment: false,
    };
  }

  _getLegCoordinates(startPoint, endPoint) {
    const plan = this._buildLegPlan(startPoint, endPoint);
    if (!plan) return [];

    if (plan.sameSegment) {
      return this._sliceSegmentBetweenPoints(
        plan.startSegmentName,
        startPoint,
        endPoint,
      );
    }

    const legCoords = [];
    const startExitPoint = this._getEndpointCoords(
      plan.startSegmentName,
      plan.startExitKey,
    );
    const startCoords = this._sliceSegmentBetweenPoints(
      plan.startSegmentName,
      startPoint,
      startExitPoint,
    );
    for (const coord of startCoords) {
      this._appendCoordinate(legCoords, coord);
    }

    for (const segmentName of plan.middleSegments) {
      const segment = this.segments.get(segmentName);
      if (!segment) continue;

      let coords = [...segment.coordinates];
      if (legCoords.length > 0) {
        const lastPoint = legCoords[legCoords.length - 1];
        coords = this._orientSegmentForConnection(
          coords,
          null,
          false,
          lastPoint,
        );
      }

      for (const coord of coords) {
        this._appendCoordinate(legCoords, coord);
      }
    }

    const endEntryPoint = this._getEndpointCoords(
      plan.endSegmentName,
      plan.endEntryKey,
    );
    const endCoords = this._sliceSegmentBetweenPoints(
      plan.endSegmentName,
      endEntryPoint,
      endPoint,
    );
    for (const coord of endCoords) {
      this._appendCoordinate(legCoords, coord);
    }

    return legCoords;
  }

  _sliceSegmentBetweenPoints(segmentName, fromPoint, toPoint) {
    const segment = this.segments.get(segmentName);
    if (!segment) return [];

    return this._sliceCoordinatesBetweenPoints(
      segment.coordinates,
      fromPoint,
      toPoint,
    );
  }

  _sliceCoordinatesBetweenPoints(coords, fromPoint, toPoint) {
    if (!Array.isArray(coords) || coords.length < 2) return [];

    const fromProjection = this._projectPointOntoCoordinates(fromPoint, coords);
    const toProjection = this._projectPointOntoCoordinates(toPoint, coords);
    if (!fromProjection || !toProjection) return [];

    if (fromProjection.distanceAlong > toProjection.distanceAlong) {
      return this
        ._sliceCoordinatesBetweenPoints(coords, toPoint, fromPoint)
        .reverse();
    }

    const result = [];
    this._appendCoordinate(result, fromProjection.point);

    for (
      let coordIndex = fromProjection.segmentIndex + 1;
      coordIndex <= toProjection.segmentIndex;
      coordIndex++
    ) {
      this._appendCoordinate(result, coords[coordIndex]);
    }

    this._appendCoordinate(result, toProjection.point);
    return result;
  }

  _projectPointOntoCoordinates(point, coords) {
    let bestProjection = null;
    let accumulatedDistance = 0;

    for (let i = 0; i < coords.length - 1; i++) {
      const segmentStart = coords[i];
      const segmentEnd = coords[i + 1];
      const projectedPoint = this._getClosestPointOnLineSegment(
        point,
        segmentStart,
        segmentEnd,
      );
      const distanceToPoint = this._getDistance(point, projectedPoint);
      const distanceOnSegment = this._getDistance(segmentStart, projectedPoint);
      const distanceAlong = accumulatedDistance + distanceOnSegment;

      if (!bestProjection || distanceToPoint < bestProjection.distanceToPoint) {
        bestProjection = {
          point: projectedPoint,
          segmentIndex: i,
          distanceAlong,
          distanceToPoint,
        };
      }

      accumulatedDistance += this._getDistance(segmentStart, segmentEnd);
    }

    return bestProjection;
  }

  _distanceFromPointToEndpoint(point, segmentName, endpointKey) {
    const segment = this.segments.get(segmentName);
    if (!segment) return Infinity;

    const projection = this._projectPointOntoCoordinates(
      point,
      segment.coordinates,
    );
    if (!projection) return Infinity;

    const segmentLength = this._getSegmentLength(segmentName);
    return endpointKey === "S"
      ? projection.distanceAlong
      : Math.max(0, segmentLength - projection.distanceAlong);
  }

  _distanceFromEndpointToPoint(point, segmentName, endpointKey) {
    return this._distanceFromPointToEndpoint(point, segmentName, endpointKey);
  }

  _getSegmentLength(segmentName) {
    const metrics = this.segmentMetrics.get(segmentName);
    if (metrics) return metrics.distance;

    const segment = this.segments.get(segmentName);
    if (!segment) return 0;

    let distance = 0;
    for (let i = 0; i < segment.coordinates.length - 1; i++) {
      distance += this._getDistance(
        segment.coordinates[i],
        segment.coordinates[i + 1],
      );
    }
    return distance;
  }

  _dedupeConsecutiveSegments(segments) {
    const deduped = [];
    for (const segmentName of segments) {
      if (
        segmentName &&
        (deduped.length === 0 || deduped[deduped.length - 1] !== segmentName)
      ) {
        deduped.push(segmentName);
      }
    }
    return deduped;
  }

  _appendCoordinate(coords, coord) {
    if (!coord || coord.lat === undefined || coord.lng === undefined) return;

    const normalizedCoord = {
      lat: Number(coord.lat),
      lng: Number(coord.lng),
    };
    if (coord.elevation !== undefined) {
      normalizedCoord.elevation = Number(coord.elevation);
    }

    const previous = coords[coords.length - 1];
    if (previous && this._getDistance(previous, normalizedCoord) < 0.01) {
      if (
        previous.elevation === undefined &&
        Number.isFinite(normalizedCoord.elevation)
      ) {
        previous.elevation = normalizedCoord.elevation;
      }
      return;
    }

    coords.push(normalizedCoord);
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
    const routeCoords = this._getRouteCoordinatesThroughPoints();
    if (routeCoords.length >= 2) {
      let routeDistance = 0;
      for (let i = 0; i < routeCoords.length - 1; i++) {
        routeDistance += this._getDistance(routeCoords[i], routeCoords[i + 1]);
      }
      return routeDistance;
    }

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
    const routeCoords = this._getRouteCoordinatesThroughPoints();
    if (routeCoords.length >= 2) {
      let routeGain = 0;
      let routeLoss = 0;
      for (let i = 0; i < routeCoords.length - 1; i++) {
        const fromElevation = Number(routeCoords[i].elevation);
        const toElevation = Number(routeCoords[i + 1].elevation);
        if (!Number.isFinite(fromElevation) || !Number.isFinite(toElevation)) {
          continue;
        }

        const diff = toElevation - fromElevation;
        if (diff > 0) {
          routeGain += diff;
        } else {
          routeLoss += Math.abs(diff);
        }
      }

      return {
        gain: Math.round(routeGain),
        loss: Math.round(routeLoss),
      };
    }

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

    const closestPoint = { lat: yy, lng: xx };
    const clampedParam = Math.max(0, Math.min(1, param));
    if (
      lineStart.elevation !== undefined &&
      lineEnd.elevation !== undefined
    ) {
      closestPoint.elevation =
        lineStart.elevation +
        (lineEnd.elevation - lineStart.elevation) * clampedParam;
    }

    return closestPoint;
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

/**
 * Build an ordered list of segment spans from a base-routing traversal list.
 * Adjacent traversals sharing the same (name, onNetwork) tuple are merged into
 * a single span. Off-network traversals (no direction-scoped CW membership, or
 * an id not in segmentNamesById) produce a null-name, off-network span.
 *
 * @param {Array} traversals - ordered traversal objects from a computed route
 * @param {Map} segmentNamesById - map from numeric segment id → display name
 * @returns {Array<{startMeters,endMeters,name,cwSegmentId,onNetwork,routeClass}>}
 */
function buildSegmentSpans(traversals, segmentNamesById) {
  const spans = [];
  let cursor = 0;
  for (const traversal of Array.isArray(traversals) ? traversals : []) {
    const length = Math.abs(
      (traversal.distanceMeters ??
        (traversal.toDistance - traversal.fromDistance)) || 0,
    );
    if (length <= 0) continue;
    const ids = Array.isArray(traversal.cwMemberships)
      ? traversal.cwMemberships.map((value) => value.segmentId)
      : traversal.edge?.cwSegmentIds ?? [];
    const cwSegmentId = ids.length > 0 ? Number(ids[0]) : null;
    const name = cwSegmentId != null ? segmentNamesById.get(cwSegmentId) ?? null : null;
    const junctionMemberships = Array.isArray(traversal.junctionMemberships)
      ? traversal.junctionMemberships
      : [];
    const junctionId = junctionMemberships[0]?.junctionId ?? null;
    const junctionName = junctionMemberships[0]?.junctionName ?? null;
    const networkRole = name != null
      ? "segment"
      : junctionMemberships.length > 0
        ? "junction"
        : null;
    const onNetwork = networkRole != null;
    const routeClass =
      traversal.edge?.routeClass ?? traversal.edge?.highway ?? null;
    const start = cursor;
    cursor += length;
    const prev = spans[spans.length - 1];
    if (
      prev && prev.name === name && prev.onNetwork === onNetwork && prev.networkRole === networkRole
      && prev.junctionId === junctionId && prev.junctionName === junctionName
    ) {
      prev.endMeters = cursor;
      continue;
    }
    spans.push({
      startMeters: start,
      endMeters: cursor,
      name,
      cwSegmentId,
      onNetwork,
      networkRole,
      junctionId,
      junctionName,
      routeClass,
    });
  }
  return spans;
}

// CommonJS module: Node consumers (test suite, editor server, CLI scripts) load
// this via require(). The web/RN bundlers import it as a default export — Vite
// rewrites this line to `export default RouteManager` via routeManagerEsmPlugin;
// Metro consumes CommonJS natively. No browser global (it is no longer loaded
// via a <script> tag).
module.exports = RouteManager;
module.exports.buildSegmentSpans = buildSegmentSpans;
