import {
  baseRoutingShardEntriesForBounds,
  baseRoutingShardEntriesForPoints,
  mergeBaseRoutingShards,
} from "./baseRoutingShards.js";
import { decodeRoutePayload } from "../../utils/route-encoding.js";
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
    this.manager = null;
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
    return mergeBaseRoutingShards([...this.loadedShards.values()]);
  }

  async extendManager(shards) {
    const network = mergeBaseRoutingShards(shards);
    network.graphVersion = this.shardManifest?.generatedAt || "";
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
    network.graphVersion = this.shardManifest?.generatedAt || "";
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
    const covered = await this.ensureCoverage([...this.routePoints(), point]);
    if (!covered || !this.indexedNetwork()) {
      return snapshotRouteManager(this.manager, this.segmentsData);
    }
    return addPoint(this.manager, point, this.segmentsData);
  }

  async dragPoint(points, index, point) {
    const nextPoints = (points || []).map((existingPoint, pointIndex) =>
      pointIndex === index ? { ...existingPoint, ...point } : existingPoint,
    );
    await this.ensureCoverage(nextPoints);
    return dragPoint(this.manager, points, index, point, this.segmentsData);
  }

  async recalculatePoints(points) {
    await this.ensureCoverage(points);
    return recalculatePoints(this.manager, points, this.segmentsData);
  }

  async restorePoints(points) {
    const covered = await this.ensureCoverage(points);
    if (!covered || !this.indexedNetwork()) {
      return null;
    }
    return restoreRoute(this.manager, points, this.segmentsData);
  }

  async restoreRouteParam(routeParam) {
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
    if (
      typeof this.manager?.restoreBaseRouteFromPayload === "function" &&
      this.manager.restoreBaseRouteFromPayload(payload)
    ) {
      return snapshotRouteManager(this.manager, this.segmentsData);
    }

    console.warn(
      "[routing-shards] V4 exact route replay failed; recalculating from waypoint anchors",
    );
    return this.recoverShareAnchorPoints(payload.routePoints);
  }

  async restoreHybridRoutePayload(payload) {
    await this.loadShardIds(
      (payload.shards || []).map((shard) => shard.id).filter(Boolean),
      "loading",
    );
    const expandedPayload = expandHybridRoutePayload(payload, this.cwBaseIndex);
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
    return this.recoverShareAnchorPoints(payload.routePoints);
  }

  async recoverShareAnchorPoints(anchors) {
    if (!Array.isArray(anchors) || anchors.length === 0) return null;
    const resolved =
      typeof this.manager?.resolveShareAnchorPoints === "function"
        ? this.manager.resolveShareAnchorPoints(anchors)
        : null;
    if (!resolved) {
      // Anchors carry only baseEdgeShareId+baseEdgeFraction (no lat/lng), so
      // without a current-graph resolution they cannot be re-routed.
      return null;
    }
    return this.restorePoints(resolved);
  }
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
