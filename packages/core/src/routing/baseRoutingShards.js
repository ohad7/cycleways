import { decodeCompactBaseRoutingShard } from "./compactBaseRoutingShard.js";
import { decodeMessagePack } from "./messagePack.js";
import { getBinaryAsset } from "../platform/assets.js";

function validNumber(value) {
  return value !== null && value !== "" && Number.isFinite(Number(value));
}

function normalizePoint(point) {
  if (!point || !validNumber(point.lng) || !validNumber(point.lat)) {
    return null;
  }
  return {
    lng: Number(point.lng),
    lat: Number(point.lat),
  };
}

function normalizeBounds(bounds) {
  if (
    !Array.isArray(bounds) ||
    bounds.length < 4 ||
    !bounds.slice(0, 4).every(validNumber)
  ) {
    return null;
  }
  return {
    west: Number(bounds[0]),
    south: Number(bounds[1]),
    east: Number(bounds[2]),
    north: Number(bounds[3]),
  };
}

function boundsIntersect(first, second) {
  return !(
    first.east < second.west ||
    second.east < first.west ||
    first.north < second.south ||
    second.north < first.south
  );
}

export function baseRoutingBoundsForPoints(points, paddingDegrees = 0) {
  const normalized = (points || []).map(normalizePoint).filter(Boolean);
  if (normalized.length === 0) {
    return null;
  }

  const padding = validNumber(paddingDegrees)
    ? Math.max(0, Number(paddingDegrees))
    : 0;
  return {
    west: Math.min(...normalized.map((point) => point.lng)) - padding,
    south: Math.min(...normalized.map((point) => point.lat)) - padding,
    east: Math.max(...normalized.map((point) => point.lng)) + padding,
    north: Math.max(...normalized.map((point) => point.lat)) + padding,
  };
}

export function baseRoutingShardEntriesForBounds(manifest, bounds) {
  const normalizedBounds = normalizeBounds([
    bounds?.west,
    bounds?.south,
    bounds?.east,
    bounds?.north,
  ]);
  if (!normalizedBounds || !Array.isArray(manifest?.shards)) {
    return [];
  }

  return manifest.shards
    .filter((entry) => {
      const shardBounds = normalizeBounds(entry?.bounds);
      return shardBounds && boundsIntersect(normalizedBounds, shardBounds);
    })
    .sort((first, second) => String(first.id).localeCompare(String(second.id)));
}

export function baseRoutingShardEntriesForPoints(
  manifest,
  points,
  { paddingDegrees, paddingShards = 1 } = {},
) {
  const shardSize = Number(manifest?.scheme?.shardSizeDegrees);
  const derivedPadding =
    validNumber(paddingDegrees)
      ? Number(paddingDegrees)
      : Number.isFinite(shardSize)
        ? Math.max(0, Number(paddingShards) || 0) * shardSize
        : 0;
  const bounds = baseRoutingBoundsForPoints(points, derivedPadding);
  return bounds ? baseRoutingShardEntriesForBounds(manifest, bounds) : [];
}

export function mergeBaseRoutingShards(shards, manifest = null) {
  const nodesById = new Map();
  const edgesById = new Map();
  const shardIds = [];
  let sourceRoutingSchemaVersion = null;

  for (const shard of shards || []) {
    if (!shard || !Array.isArray(shard.nodes) || !Array.isArray(shard.edges)) {
      continue;
    }
    if (typeof shard.id === "string") {
      shardIds.push(shard.id);
    }
    if (sourceRoutingSchemaVersion === null) {
      sourceRoutingSchemaVersion =
        shard.sourceRoutingSchemaVersion ?? shard.schemaVersion ?? null;
    } else if (
      shard.sourceRoutingSchemaVersion != null &&
      Number(shard.sourceRoutingSchemaVersion) !== Number(sourceRoutingSchemaVersion)
    ) {
      throw new Error("Mixed base-routing shard schema versions are not allowed");
    }

    for (const node of shard.nodes) {
      if (node && typeof node.id === "string" && !nodesById.has(node.id)) {
        nodesById.set(node.id, node);
      }
    }
    for (const edge of shard.edges) {
      if (!edge || typeof edge.id !== "string") {
        continue;
      }
      const shardIdsForEdge =
        typeof shard.id === "string" ? [shard.id] : [];
      if (!edgesById.has(edge.id)) {
        edgesById.set(edge.id, {
          ...edge,
          shardIds: [
            ...new Set([...(edge.shardIds || []), ...shardIdsForEdge]),
          ],
        });
      } else {
        const existing = edgesById.get(edge.id);
        edgesById.set(edge.id, {
          ...existing,
          shardIds: [
            ...new Set([...(existing.shardIds || []), ...shardIdsForEdge]),
          ].sort(),
        });
      }
    }
  }

  const nodes = [...nodesById.values()].sort((first, second) =>
    first.id.localeCompare(second.id),
  );
  const edges = [...edgesById.values()].sort((first, second) =>
    first.id.localeCompare(second.id),
  );
  return {
    schemaVersion: sourceRoutingSchemaVersion,
    graphVersion: manifest?.graphVersion || manifest?.generatedAt || "",
    policyId: manifest?.policyId || null,
    policyDigest: manifest?.policyDigest || null,
    routingContract: manifest?.routingContract || null,
    nodes,
    edges,
    summary: {
      loadedShards: [...new Set(shardIds)].sort(),
      nodes: nodes.length,
      edges: edges.length,
    },
  };
}

export async function loadBaseRoutingShardSubset(
  manifest,
  points,
  loadShard,
  options,
) {
  if (typeof loadShard !== "function") {
    throw new Error("loadBaseRoutingShardSubset requires a shard loader");
  }

  const entries = baseRoutingShardEntriesForPoints(manifest, points, options);
  const shards = await Promise.all(entries.map((entry) => loadShard(entry)));
  return {
    entries,
    shards,
    network: mergeBaseRoutingShards(shards, manifest),
  };
}

export function createBaseRoutingShardFetchLoader(
  manifestPath,
  fetchOptions = {},
  location,
  options = {},
) {
  const manifestUrl = new URL(manifestPath, location.href);
  const requestedFormat = options.format || "default";
  return async (entry) => {
    const format = selectShardFormat(entry, requestedFormat);
    if (!format.path) {
      throw new Error("Routing shard entry is missing a path");
    }

    const buffer = await getBinaryAsset(format.path, {
      baseHref: manifestUrl.href,
      sha256: format.sha256,
      ...fetchOptions,
    });
    if (format.name === "msgpack") {
      return decodeMessagePack(buffer);
    }
    if (format.name === "compact") {
      return decodeCompactBaseRoutingShard(buffer);
    }
    return JSON.parse(new TextDecoder().decode(buffer));
  };
}

function selectShardFormat(entry, requestedFormat) {
  if (requestedFormat === "default") {
    const formatName = entry?.format || "json";
    return {
      name: formatName,
      path: entry?.path,
      sha256: entry?.formats?.[formatName]?.sha256,
    };
  }
  if (requestedFormat === "compact" || requestedFormat === "cwb") {
    const compact = entry?.formats?.compact;
    const compactPath =
      compact?.path || (entry?.format === "compact" ? entry?.path : null);
    if (compactPath) {
      return { name: "compact", path: compactPath, sha256: compact?.sha256 };
    }
    console.warn(
      `[routing-shards] compact shard is unavailable for ${entry?.id}; falling back to default`,
    );
    const formatName = entry?.format || "json";
    return {
      name: formatName,
      path: entry?.path,
      sha256: entry?.formats?.[formatName]?.sha256,
    };
  }
  if (requestedFormat === "msgpack") {
    const messagePack = entry?.formats?.msgpack;
    const messagePackPath = messagePack?.path || entry?.messagePackPath;
    if (messagePackPath) {
      return {
        name: "msgpack",
        path: messagePackPath,
        sha256: messagePack?.sha256,
      };
    }
    console.warn(
      `[routing-shards] msgpack shard is unavailable for ${entry?.id}; falling back to default`,
    );
    const formatName = entry?.format || "json";
    return {
      name: formatName,
      path: entry?.path,
      sha256: entry?.formats?.[formatName]?.sha256,
    };
  }
  const json = entry?.formats?.json;
  return {
    name: "json",
    path:
      json?.path ||
      (entry?.format === "json" || !entry?.format ? entry?.path : null),
    sha256: json?.sha256,
  };
}
