import {
  baseRoutingShardEntriesForBounds,
  baseRoutingShardEntriesForPoints,
  mergeBaseRoutingShards,
} from "./baseRoutingShards.js";
import { decodeRoutePayload } from "../utils/route-encoding.js";
import { junctionsNearRoute } from "./junctionsNearRoute.js";
import {
  addPoint,
  createRouteManager,
  dragPoint,
  expandHybridRoutePayload,
  recalculatePoints,
  restoreRoute,
  routePointsFromParam,
  snapshotRouteManager,
} from "./routeActions.js";

export async function createShardedRouteSession(
  RouteManagerClass,
  geoJsonData,
  segmentsData,
  shardManifest,
  loadShard,
  options = {},
) {
  const session = new ShardedRouteSession(
    RouteManagerClass,
    geoJsonData,
    segmentsData,
    shardManifest,
    loadShard,
    options,
  );
  await session.initialize();
  return session;
}

class ShardedRouteSession {
  constructor(
    RouteManagerClass,
    geoJsonData,
    segmentsData,
    shardManifest,
    loadShard,
    options,
  ) {
    if (typeof loadShard !== "function") {
      throw new Error("ShardedRouteSession requires a routing shard loader");
    }
    this.RouteManagerClass = RouteManagerClass;
    this.geoJsonData = geoJsonData;
    this.segmentsData = segmentsData;
    this.shardManifest = shardManifest;
    this.loadShard = loadShard;
    this.onStatus = options.onStatus;
    this.paddingShards = Number.isFinite(Number(options.paddingShards))
      ? Math.max(0, Number(options.paddingShards))
      : 1;
    this.prefetchPaddingShards = Number.isFinite(
      Number(options.prefetchPaddingShards),
    )
      ? Math.max(0, Number(options.prefetchPaddingShards))
      : 0;
    this.loadedShards = new Map();
    this.loadedEntries = new Map();
    this.loadingShards = new Map();
    this.cwBaseIndex = options.cwBaseIndex || null;
    this.legacyRoutingCompatibility =
      options.legacyRoutingCompatibility || null;
    this.manager = null;
    this.routeRequestGeneration = 0;
    this.pendingRouteProposal = null;
  }

  async initialize() {
    this.manager = await createRouteManager(
      this.RouteManagerClass,
      this.geoJsonData,
      this.segmentsData,
      null,
    );
    this.notifyStatus("ready");
    return this;
  }

  routePoints() {
    return this.manager?.getRouteInfo()?.points || [];
  }

  diagnostics() {
    const network = this.indexedNetwork();
    return {
      loadedShards: [...this.loadedShards.keys()].sort(),
      loadedCompactBytes: [...this.loadedEntries.values()].reduce(
        (total, entry) => total + (Number(entry.compactBytes) || 0),
        0,
      ),
      loadedNodes: network?.nodes?.length || 0,
      loadedEdges: network?.edges?.length || 0,
    };
  }

  notifyStatus(phase, entries = []) {
    const status = {
      phase,
      batchShardIds: entries.map((entry) => entry.id),
      ...this.diagnostics(),
    };
    if (
      typeof window !== "undefined" &&
      (phase === "loading" || phase === "prefetching" || phase === "loaded")
    ) {
      console.info(`[routing-shards] ${phase}`, status);
    }
    this.onStatus?.(status);
  }

  async ensureCoverage(points) {
    const entries = baseRoutingShardEntriesForPoints(
      this.shardManifest,
      points,
      { paddingShards: this.paddingShards },
    );
    if (entries.length === 0) {
      return false;
    }

    const missingEntries = entries.filter(
      (entry) => !this.loadedShards.has(entry.id),
    );
    if (missingEntries.length === 0) {
      return true;
    }

    await this.loadEntries(missingEntries, "loading");
    return true;
  }

  async prefetchBounds(bounds, options = {}) {
    const entries = baseRoutingShardEntriesForBounds(
      this.shardManifest,
      expandBoundsByShardPadding(
        bounds,
        options.paddingShards ?? this.prefetchPaddingShards,
        this.shardManifest,
      ),
    );
    const maxShards = Number(options.maxShards);
    if (Number.isFinite(maxShards) && entries.length > maxShards) {
      return false;
    }
    const missingEntries = entries.filter(
      (entry) => !this.loadedShards.has(entry.id),
    );
    if (missingEntries.length === 0) {
      return false;
    }

    await this.loadEntries(missingEntries, "prefetching");
    return true;
  }

  async loadEntries(entries, phase = "loading") {
    const missingEntries = (entries || []).filter(
      (entry) => entry?.id && !this.loadedShards.has(entry.id),
    );
    if (missingEntries.length === 0) {
      return [];
    }

    this.notifyStatus(phase, missingEntries);
    const loadedEntries = await Promise.all(
      missingEntries.map(async (entry) => ({
        entry,
        shard: await this.loadEntry(entry),
      })),
    );
    const newlyLoadedShards = [];
    for (const { entry, shard } of loadedEntries) {
      if (this.loadedShards.has(entry.id)) continue;
      this.loadedShards.set(entry.id, shard);
      this.loadedEntries.set(entry.id, entry);
      newlyLoadedShards.push(shard);
    }

    if (newlyLoadedShards.length > 0) {
      await this.extendManager(newlyLoadedShards);
    }
    this.notifyStatus("loaded", missingEntries);
    return newlyLoadedShards;
  }

  async loadShardIds(shardIds, phase = "loading") {
    const entriesById = new Map(
      (this.shardManifest?.shards || []).map((entry) => [String(entry.id), entry]),
    );
    const entries = [...new Set((shardIds || []).map(String))]
      .map((shardId) => entriesById.get(shardId))
      .filter(Boolean);
    if (entries.length === 0) {
      return [];
    }
    return this.loadEntries(entries, phase);
  }

  async loadEntry(entry) {
    if (!this.loadingShards.has(entry.id)) {
      const loadPromise = Promise.resolve()
        .then(() => this.loadShard(entry))
        .finally(() => {
          this.loadingShards.delete(entry.id);
        });
      this.loadingShards.set(entry.id, loadPromise);
    }
    return this.loadingShards.get(entry.id);
  }

  indexedNetwork() {
    return this.manager?.baseRoutingNetwork || null;
  }

  mergedNetwork() {
    return mergeBaseRoutingShards(
      [...this.loadedShards.values()],
      this.shardManifest,
    );
  }

  async extendManager(shards) {
    const network = mergeBaseRoutingShards(shards, this.shardManifest);
    if (network.edges.length === 0) {
      return;
    }
    if (typeof this.manager?.mergeBaseRoutingNetwork === "function") {
      this.manager.mergeBaseRoutingNetwork(network);
      return;
    }
    await this.rebuildManager(this.routePoints());
  }

  async rebuildManager(points) {
    const network = this.mergedNetwork();
    this.manager = await createRouteManager(
      this.RouteManagerClass,
      this.geoJsonData,
      this.segmentsData,
      network.edges.length > 0 ? network : null,
    );
    if (Array.isArray(points) && points.length > 0 && network.edges.length > 0) {
      restoreRoute(this.manager, points, this.segmentsData);
    }
  }

  async addPoint(point) {
    this.invalidateRouteProposals();
    const covered = await this.ensureCoverage([...this.routePoints(), point]);
    if (!covered || !this.indexedNetwork()) {
      return snapshotRouteManager(this.manager, this.segmentsData);
    }
    return addPoint(this.manager, point, this.segmentsData);
  }

  removePoint(index) {
    this.invalidateRouteProposals();
    this.manager?.removePoint?.(index);
    return snapshotRouteManager(this.manager, this.segmentsData);
  }

  async dragPoint(points, index, point) {
    this.invalidateRouteProposals();
    const nextPoints = (points || []).map((existingPoint, pointIndex) =>
      pointIndex === index ? { ...existingPoint, ...point } : existingPoint,
    );
    await this.ensureCoverage(nextPoints);
    return dragPoint(this.manager, points, index, point, this.segmentsData);
  }

  async recalculatePoints(points) {
    this.invalidateRouteProposals();
    await this.ensureCoverage(points);
    return recalculatePoints(this.manager, points, this.segmentsData);
  }

  async computeConnector(from, to) {
    const empty = (failure) => ({
      geometry: [],
      distanceMeters: 0,
      failure,
      snappedEndpoints: [],
      routingValidation: null,
    });
    if (!this.manager || typeof this.manager.previewBaseRoute !== "function") {
      return empty("no-router");
    }

    const savedRouteInfo = this.manager.baseRouteInfo;
    const savedFailure = this.manager.lastRouteFailure;
    let covered = false;
    try {
      covered = await this.ensureCoverage([from, to]);
    } catch {
      return empty("transient");
    } finally {
      // Extending the graph invalidates this cache by default. Navigation uses
      // the immutable route snapshot, and connector previews must not change
      // the planner's active route behind it.
      this.manager.baseRouteInfo = savedRouteInfo;
      this.manager.lastRouteFailure = savedFailure;
    }
    if (!covered || !this.indexedNetwork()) return empty("no-coverage");
    return this.manager.previewBaseRoute([from, to], { costProfile: "connector" });
  }

  // Junction data is authoritative only when every shard needed for the
  // geometry loaded successfully. Returning null preserves legacy cue behavior
  // after a coverage failure; [] specifically means complete coverage with no
  // nearby junctions.
  async junctionsNearRoute(geometry, options = {}) {
    const points = Array.isArray(geometry) ? geometry : [];
    if (points.length === 0) return null;
    let covered = false;
    try {
      covered = await this.ensureCoverage(points);
    } catch {
      return null;
    }
    if (covered !== true) return null;
    const network = this.indexedNetwork();
    if (!network) return null;
    return junctionsNearRoute(network, points, options);
  }

  async restorePoints(points) {
    this.invalidateRouteProposals();
    const covered = await this.ensureCoverage(points);
    if (!covered || !this.indexedNetwork()) {
      return null;
    }
    return restoreRoute(this.manager, points, this.segmentsData);
  }

  async restoreRouteParam(routeParam) {
    this.invalidateRouteProposals();
    const payload = decodeRoutePayload(routeParam);
    if (payload.type === "hybrid_route_v5" || payload.type === "hybrid_route_v6") {
      return this.restoreHybridRoutePayload(payload);
    }
    if (payload.type === "base_route_v4") {
      return this.restoreBaseRoutePayload(payload);
    }
    const points = routePointsFromParam(routeParam, this.segmentsData);
    return points ? this.restorePoints(points) : null;
  }

  async restoreBaseRoutePayload(payload) {
    await this.loadShardIds(
      (payload.shards || []).map((shard) => shard.id).filter(Boolean),
      "loading",
    );
    const identityProven = this.currentOrLegacyPayloadIdentityProven(payload);
    if (
      identityProven &&
      typeof this.manager?.restoreBaseRouteFromPayload === "function" &&
      this.manager.restoreBaseRouteFromPayload(payload)
    ) {
      return snapshotRouteManager(this.manager, this.segmentsData);
    }

    console.warn(
      "[routing-shards] V4 exact route replay failed; recalculating from waypoint anchors",
    );
    return this.recoverShareAnchorPoints(payload.routePoints, {
      identityProven,
      requiresReview: true,
    });
  }

  async restoreHybridRoutePayload(payload) {
    await this.loadShardIds(
      (payload.shards || []).map((shard) => shard.id).filter(Boolean),
      "loading",
    );
    const identityProven = this.legacyPayloadIdentityProven(payload);
    const legacyIndex = identityProven
      ? this.legacyRoutingCompatibility?.cwBaseIndex
      : null;
    const expandedPayload = expandHybridRoutePayload(payload, legacyIndex);
    if (
      expandedPayload &&
      typeof this.manager?.restoreBaseRouteFromPayload === "function" &&
      this.manager.restoreBaseRouteFromPayload(expandedPayload)
    ) {
      return snapshotRouteManager(this.manager, this.segmentsData);
    }

    console.warn(
      "[routing-shards] hybrid route replay failed; recalculating from waypoint anchors",
    );
    return this.recoverShareAnchorPoints(payload.routePoints, {
      identityProven,
      requiresReview: true,
    });
  }

  async recoverShareAnchorPoints(
    anchors,
    { identityProven = false, requiresReview = false } = {},
  ) {
    if (!Array.isArray(anchors) || anchors.length === 0) return null;
    const resolved = anchors.every(hasLngLat)
      ? anchors.map((anchor) => ({
          ...anchor,
          lat: Number(anchor.lat),
          lng: Number(anchor.lng),
        }))
      : identityProven &&
          typeof this.manager?.resolveShareAnchorPoints === "function"
        ? this.manager.resolveShareAnchorPoints(anchors)
        : null;
    if (!resolved) {
      // Anchors carry only baseEdgeShareId+baseEdgeFraction (no lat/lng), so
      // without a current-graph resolution they cannot be re-routed.
      return null;
    }
    const snapshot = await this.restorePoints(resolved);
    return snapshot && requiresReview
      ? {
          ...snapshot,
          requiresReview: true,
          restoreDisposition: "replanned-current-policy",
        }
      : snapshot;
  }

  currentOrLegacyPayloadIdentityProven(payload) {
    const currentGraphVersion = String(this.shardManifest?.graphVersion || "");
    if (
      currentGraphVersion &&
      String(payload?.graphVersion || "") === currentGraphVersion
    ) {
      return true;
    }
    return this.legacyPayloadIdentityProven(payload);
  }

  legacyPayloadIdentityProven(payload) {
    const compatibility = this.legacyRoutingCompatibility;
    const metadata = compatibility?.metadata;
    const manifest = compatibility?.manifest;
    const contract = this.shardManifest?.routingContract;
    const hash = legacyGraphHash(payload);
    const registryDigest = String(metadata?.baseEdgeShareRegistryDigest || "");
    return Boolean(
      hash &&
      Number(compatibility?.cwBaseIndex?.schemaVersion) === 1 &&
      registryDigest &&
      String(metadata?.legacyGraphVersionHash || "").toLowerCase() === hash &&
      String(manifest?.registryDigest || "") === registryDigest &&
      String(manifest?.graphVersionHashes?.[hash] || "") === registryDigest &&
      String(manifest?.cwBaseIndexSha256 || "") ===
        String(metadata?.sourceSha256 || "") &&
      String(contract?.legacyCompatibilityRegistryDigest || "") ===
        registryDigest &&
      String(contract?.legacyCompatibilityGraphVersionHashes?.[hash] || "") ===
        registryDigest &&
      String(contract?.legacyCwBaseIndexSha256 || "") ===
        String(metadata?.sourceSha256 || ""),
    );
  }

  invalidateRouteProposals() {
    this.routeRequestGeneration += 1;
    this.pendingRouteProposal = null;
    return this.routeRequestGeneration;
  }

  currentRouteFingerprint() {
    return this.manager?.getRouteInfo?.()?.routingValidation?.contentFingerprint || null;
  }

  async appendReturnToStart() {
    const currentPoints = this.manager?.getRouteInfo?.()?.points || [];
    if (currentPoints.length < 2) {
      return { ok: false, failure: "return-target-unavailable" };
    }
    const first = requestedOccurrencePoint(currentPoints[0], 0);
    const last = requestedOccurrencePoint(currentPoints.at(-1), currentPoints.length - 1);
    if (sameRequestedCoordinate(first, last)) {
      return { ok: false, failure: "return-already-complete" };
    }
    const points = currentPoints.map(requestedOccurrencePoint);
    points.push({
      ...first,
      id: `${first.id || first.occurrenceId || "start"}-return`,
      occurrenceId: `${first.occurrenceId || first.id || "start"}-return`,
      legPurpose: "return",
    });
    return this.planRouteProposal(points, "return-to-start");
  }

  async planOppositeDirection() {
    const currentPoints = this.manager?.getRouteInfo?.()?.points || [];
    if (currentPoints.length < 2) {
      return { ok: false, failure: "opposite-direction-unavailable" };
    }
    const points = [...currentPoints]
      .reverse()
      .map((point, index) => ({
        ...requestedOccurrencePoint(point, index),
        id: `opposite-${index}-${point.id || "point"}`,
        occurrenceId: `opposite-${index}-${point.occurrenceId || point.id || "point"}`,
        legPurpose: "opposite-direction",
      }));
    return this.planRouteProposal(points, "opposite-direction");
  }

  async closeLoop() {
    const currentPoints = this.manager?.getRouteInfo?.()?.points || [];
    if (currentPoints.length < 2) {
      return { ok: false, failure: "close-loop-unavailable" };
    }
    const points = currentPoints.map(requestedOccurrencePoint);
    const first = requestedOccurrencePoint(currentPoints[0], 0);
    points.push({
      ...first,
      id: `${first.id || "start"}-loop-close`,
      occurrenceId: `${first.occurrenceId || first.id || "start"}-loop-close`,
      legPurpose: "close-loop",
    });
    return this.planRouteProposal(points, "close-loop");
  }

  async routeFromAcceptedAlignment(segmentId, alignmentKey) {
    const normalizedSegmentId = Number(segmentId);
    const segment = this.cwBaseIndex?.segments?.[String(normalizedSegmentId)];
    const alignment = segment?.alignments?.[alignmentKey];
    if (
      Number(this.cwBaseIndex?.schemaVersion) !== 2 ||
      !Number.isSafeInteger(normalizedSegmentId) ||
      !["aToB", "bToA"].includes(alignmentKey) ||
      alignment?.disposition !== "accepted" ||
      !Array.isArray(alignment.edgeRefs) ||
      alignment.edgeRefs.length === 0
    ) {
      return { ok: false, failure: "alignment-unavailable" };
    }

    const requestGeneration = ++this.routeRequestGeneration;
    this.pendingRouteProposal = null;
    try {
      await this.loadShardIds(alignment.shardIds || [], "loading");
    } catch {
      return { ok: false, failure: "routing-coverage-unavailable" };
    }
    if (requestGeneration !== this.routeRequestGeneration) {
      return { ok: false, failure: "route-proposal-stale" };
    }

    const refs = alignment.edgeRefs.map((value) => ({
      edgeShareId: Number(Array.isArray(value) ? value[0] : value?.shareId),
      direction:
        Number(Array.isArray(value) ? value[1] : value?.direction) === 1 ||
        (!Array.isArray(value) && value?.direction === "reverse")
          ? "reverse"
          : "forward",
    }));
    if (refs.some((value) => !Number.isSafeInteger(value.edgeShareId))) {
      return { ok: false, failure: "alignment-invalid" };
    }
    const first = refs[0];
    const last = refs[refs.length - 1];
    const payload = {
      type: "base_route_v4",
      routePoints: [
        {
          id: `${normalizedSegmentId}-${alignmentKey}-start`,
          occurrenceId: `${normalizedSegmentId}-${alignmentKey}-start`,
          baseEdgeShareId: first.edgeShareId,
          baseEdgeFraction: first.direction === "reverse" ? 1 : 0,
        },
        {
          id: `${normalizedSegmentId}-${alignmentKey}-end`,
          occurrenceId: `${normalizedSegmentId}-${alignmentKey}-end`,
          baseEdgeShareId: last.edgeShareId,
          baseEdgeFraction: last.direction === "reverse" ? 0 : 1,
        },
      ],
      legs: [
        {
          edgeShareIds: refs.map((value) => value.edgeShareId),
          directions: refs.map((value) => value.direction),
        },
      ],
    };
    const candidate = this.manager?.planBaseRouteFromPayload(payload);
    if (!candidate?.ok) {
      return { ok: false, failure: candidate?.failure || "alignment-invalid" };
    }
    const oppositeKey = alignmentKey === "aToB" ? "bToA" : "aToB";
    const oppositeAlignment = segment?.alignments?.[oppositeKey];
    const oppositeRefs = oppositeAlignment?.disposition === "accepted"
      ? normalizeAlignmentEdgeRefs(oppositeAlignment.edgeRefs)
      : [];
    const exactOpposite =
      oppositeRefs.length === refs.length &&
      [...refs].reverse().every((ref, index) =>
        ref.edgeShareId === oppositeRefs[index]?.edgeShareId &&
        oppositeDirection(ref.direction) === oppositeRefs[index]?.direction,
      );
    candidate.route.reverseConstraint = exactOpposite
      ? "curated-opposite-exact"
      : "curated-opposite-distinct-or-unavailable";
    candidate.derivation = "curated-alignment";
    candidate.routePoints = candidate.routePoints.map((point, index) => ({
      ...point,
      id: payload.routePoints[index].id,
      occurrenceId: payload.routePoints[index].occurrenceId,
      alignment: { segmentId: normalizedSegmentId, alignmentKey },
    }));
    if (!this.manager.commitBaseRouteCandidate(candidate)) {
      return { ok: false, failure: "alignment-invalid" };
    }
    return {
      ok: true,
      failure: null,
      snapshot: snapshotRouteManager(this.manager, this.segmentsData),
    };
  }

  async planRouteProposal(points, purpose) {
    const baseCommittedFingerprint = this.currentRouteFingerprint();
    const requestGeneration = ++this.routeRequestGeneration;
    this.pendingRouteProposal = null;
    let covered = false;
    try {
      covered = await this.ensureCoverage(points);
    } catch {
      return { ok: false, failure: "routing-coverage-unavailable" };
    }
    if (!covered || !this.manager?.baseRoutingNetwork) {
      return { ok: false, failure: "routing-coverage-unavailable" };
    }
    const candidate = this.manager.planBaseRouteCandidate(points);
    if (requestGeneration !== this.routeRequestGeneration) {
      return { ok: false, failure: "route-proposal-stale" };
    }
    if (!candidate.ok) {
      return {
        ok: false,
        failure:
          candidate.failure === "no-permitted-path"
            ? `${purpose}-path-unavailable`
            : candidate.failure,
      };
    }
    const routeInfo = this.manager.getRouteInfoForBaseCandidate(candidate);
    const proposal = {
      id: `${purpose}-${requestGeneration}`,
      purpose,
      requestGeneration,
      baseCommittedFingerprint,
      requiresReview: true,
      candidate,
      routeInfo,
    };
    this.pendingRouteProposal = proposal;
    return publicRouteProposal(proposal);
  }

  acceptRouteProposal(proposalId) {
    const proposal = this.pendingRouteProposal;
    if (
      !proposal ||
      proposal.id !== proposalId ||
      proposal.requestGeneration !== this.routeRequestGeneration ||
      proposal.baseCommittedFingerprint !== this.currentRouteFingerprint()
    ) {
      return { ok: false, failure: "route-proposal-stale" };
    }
    if (!this.manager.commitBaseRouteCandidate(proposal.candidate)) {
      return { ok: false, failure: "route-candidate-invalid" };
    }
    this.pendingRouteProposal = null;
    return {
      ok: true,
      failure: null,
      snapshot: snapshotRouteManager(this.manager, this.segmentsData),
    };
  }

  dismissRouteProposal(proposalId) {
    if (!this.pendingRouteProposal || this.pendingRouteProposal.id !== proposalId) {
      return false;
    }
    this.pendingRouteProposal = null;
    return true;
  }
}

function requestedOccurrencePoint(point, index) {
  return {
    id: point?.id || `route-point-${index}`,
    occurrenceId: point?.occurrenceId || point?.id || `occurrence-${index}`,
    lat: Number(point?.requestedCoordinate?.lat ?? point?.lat),
    lng: Number(point?.requestedCoordinate?.lng ?? point?.lng),
    legPurpose: point?.legPurpose || "ordinary",
  };
}

function hasLngLat(point) {
  return Number.isFinite(Number(point?.lng)) && Number.isFinite(Number(point?.lat));
}

function sameRequestedCoordinate(first, second) {
  return (
    Math.abs(Number(first?.lat) - Number(second?.lat)) <= 1e-7 &&
    Math.abs(Number(first?.lng) - Number(second?.lng)) <= 1e-7
  );
}

function legacyGraphHash(payload) {
  const numeric = Number(payload?.graphVersionHash);
  if (Number.isSafeInteger(numeric) && numeric > 0 && numeric <= 0xffffffff) {
    return numeric.toString(16).padStart(8, "0");
  }
  const text = String(payload?.graphVersion || "")
    .toLowerCase()
    .replace(/^h/, "");
  return /^[0-9a-f]{8}$/.test(text) ? text : null;
}

function publicRouteProposal(proposal) {
  return {
    ok: true,
    failure: null,
    id: proposal.id,
    purpose: proposal.purpose,
    requestGeneration: proposal.requestGeneration,
    baseCommittedFingerprint: proposal.baseCommittedFingerprint,
    requiresReview: proposal.requiresReview,
    routeInfo: proposal.routeInfo,
  };
}

function normalizeAlignmentEdgeRefs(values) {
  return (Array.isArray(values) ? values : []).map((value) => ({
    edgeShareId: Number(Array.isArray(value) ? value[0] : value?.shareId),
    direction:
      Number(Array.isArray(value) ? value[1] : value?.direction) === 1 ||
      (!Array.isArray(value) && value?.direction === "reverse")
        ? "reverse"
        : "forward",
  }));
}

function oppositeDirection(direction) {
  return direction === "reverse" ? "forward" : "reverse";
}

function expandBoundsByShardPadding(bounds, paddingShards, manifest) {
  const padding = Number(paddingShards) || 0;
  const shardSize = Number(manifest?.scheme?.shardSizeDegrees);
  if (!Number.isFinite(shardSize) || padding <= 0) {
    return bounds;
  }

  const paddingDegrees = padding * shardSize;
  return {
    west: Number(bounds?.west) - paddingDegrees,
    south: Number(bounds?.south) - paddingDegrees,
    east: Number(bounds?.east) + paddingDegrees,
    north: Number(bounds?.north) + paddingDegrees,
  };
}
