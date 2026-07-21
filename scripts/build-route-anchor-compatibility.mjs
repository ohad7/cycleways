#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeCompactBaseRoutingShard } from "../packages/core/src/routing/compactBaseRoutingShard.js";
import { decodeRoutePayload } from "../packages/core/src/utils/route-encoding.js";
import { expandHybridRoutePayload } from "../packages/core/src/routing/routeActions.js";
import { historicalRouteIntentKey } from "../packages/core/src/routing/routeAnchorCompatibility.js";
import {
  buildCumulativeDistances,
  pointAtFraction,
} from "../packages/core/src/domain/routeGeometryMath.js";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const currentManifestPath = path.join(repoRoot, "build/public-data/map-manifest.json");
const outputPath = path.join(
  repoRoot,
  "data/routing-compat/route-anchor-compatibility.json",
);
const registryHistoryDir = path.join(repoRoot, "data/routing-registry-history");

// These commits are the releases that introduced durable public route tokens.
// Read the token from that immutable Git snapshot, so regenerating the archive
// still works after the live catalog has migrated to a newer graph.
const RELEASED_ROUTE_SOURCES = Object.freeze({
  "banias-gan-hatsafon": "f98e70d4dd7f90e659e7850dbfbbfdf18d53d32f",
  "historic-jordan": "69611a22d5e30c6e2cc6e85aefb36db38c5fc4de",
  "sovev-dafna": "3767d2a7",
  "roman-roads": "5ec9b4a483d04cc35b26bd5b78a5bc3ab4d2c81c",
  "sovev-shear-yeshuv": "efa15206",
  "naftali-dishon-yosha": "cc9883c0",
});

function gitShow(commit, relativePath, { binary = false } = {}) {
  return execFileSync("git", ["show", `${commit}:${relativePath}`], {
    cwd: repoRoot,
    encoding: binary ? null : "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function graphHash(payload) {
  const numeric = Number(payload?.graphVersionHash);
  if (Number.isSafeInteger(numeric) && numeric > 0 && numeric <= 0xffffffff) {
    return numeric.toString(16).padStart(8, "0");
  }
  const text = String(payload?.graphVersion || "").toLowerCase().replace(/^h/, "");
  if (/^[0-9a-f]{1,8}$/.test(text)) return text.padStart(8, "0");
  throw new Error(`Route token has no valid V6 graph hash: ${payload?.graphVersion || "unknown"}`);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
      .map((key) => [key, stable(value[key])]),
  );
}

function edgeRecord(edge) {
  const coordinates = (edge?.coordinates || []).map((coordinate) => [
    Number(coordinate?.[0] ?? coordinate?.lng),
    Number(coordinate?.[1] ?? coordinate?.lat),
  ]);
  if (
    !Number.isSafeInteger(Number(edge?.shareId)) ||
    coordinates.length < 2 ||
    coordinates.some(([lng, lat]) => !Number.isFinite(lng) || !Number.isFinite(lat))
  ) {
    throw new Error(`Historical routing edge is invalid: ${edge?.id || edge?.shareId}`);
  }
  return {
    edgeId: String(edge.id),
    coordinates,
  };
}

async function currentShareIds() {
  const manifest = JSON.parse(await readFile(currentManifestPath, "utf8"));
  const shardManifestPath = path.join(repoRoot, "build/public-data", manifest.baseRoutingShards);
  const shardManifest = JSON.parse(await readFile(shardManifestPath, "utf8"));
  const shardDir = path.dirname(shardManifestPath);
  const result = new Set();
  for (const entry of shardManifest.shards || []) {
    const compact = entry.formats?.compact;
    const relative = compact?.path || entry.path;
    const bytes = await readFile(path.join(shardDir, relative));
    const shard = decodeCompactBaseRoutingShard(bytes);
    for (const edge of shard.edges || []) result.add(Number(edge.shareId));
  }
  return result;
}

function historicalEdges(commit) {
  const manifest = JSON.parse(
    gitShow(commit, "public-data/base-routing-shards/manifest.json"),
  );
  const edges = new Map();
  for (const entry of manifest.shards || []) {
    const compact = entry.formats?.compact;
    const relative = compact?.path || entry.path;
    const bytes = gitShow(
      commit,
      `public-data/base-routing-shards/${relative}`,
      { binary: true },
    );
    const shard = decodeCompactBaseRoutingShard(bytes);
    for (const edge of shard.edges || []) {
      const shareId = Number(edge.shareId);
      const record = edgeRecord(edge);
      const previous = edges.get(shareId);
      if (previous && JSON.stringify(edgeRecord(previous)) !== JSON.stringify(record)) {
        throw new Error(`Historical shard disagreement for share ID ${shareId} at ${commit}`);
      }
      edges.set(shareId, edge);
    }
  }
  return edges;
}

function anchorPoint(anchor, edges) {
  const shareId = Number(anchor?.baseEdgeShareId ?? anchor?.edgeShareId);
  const edge = edges.get(shareId);
  if (!edge) throw new Error(`Historical route intent cannot resolve share ID ${shareId}`);
  const polyline = edge.coordinates.map(([lng, lat]) => ({ lng, lat }));
  const fraction = Math.max(
    0,
    Math.min(1, Number(anchor?.baseEdgeFraction ?? anchor?.edgeFraction) || 0),
  );
  return pointAtFraction(polyline, buildCumulativeDistances(polyline), fraction);
}

function routeIntentRecord(payload, cwBaseIndex, edges) {
  const expanded = expandHybridRoutePayload(payload, cwBaseIndex);
  if (!expanded) throw new Error("Historical V6 route cannot be expanded against its released CW index");
  const coordinate = (point) => {
    const coordinate = [Number(point.lng), Number(point.lat)];
    if (!Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) return null;
    return coordinate;
  };
  const traversalPoint = (shareIdValue, fraction = 0.5) => {
    const shareId = Number(shareIdValue);
    if (!edges.has(shareId)) {
      throw new Error(`Historical route leg cannot resolve share ID ${shareId}`);
    }
    return coordinate(
      anchorPoint({ baseEdgeShareId: shareId, baseEdgeFraction: fraction }, edges),
    );
  };
  const appendTraversalProbe = (target, strongTarget, leg, edgeIndex, edgeCount) => {
    const reverse = leg.directions?.[edgeIndex] === "reverse" || leg.directions?.[edgeIndex] === 1;
    target.push(traversalPoint(leg.edgeShareIds[edgeIndex]));
    if (edgeCount === 1) {
      const fractions = reverse ? [0.75, 0.25] : [0.25, 0.75];
      strongTarget.push(...fractions.map((fraction) =>
        traversalPoint(leg.edgeShareIds[edgeIndex], fraction)));
      return;
    }
    strongTarget.push(traversalPoint(leg.edgeShareIds[edgeIndex]));
  };
  const isDeliberateDetour = (leg, startAnchor, endAnchor) => {
    const start = anchorPoint(startAnchor, edges);
    const end = anchorPoint(endAnchor, edges);
    const directMeters = buildCumulativeDistances([start, end]).at(-1) || 0;
    const startShareId = Number(startAnchor.baseEdgeShareId ?? startAnchor.edgeShareId);
    const endShareId = Number(endAnchor.baseEdgeShareId ?? endAnchor.edgeShareId);
    const startFraction = Number(startAnchor.baseEdgeFraction ?? startAnchor.edgeFraction);
    const endFraction = Number(endAnchor.baseEdgeFraction ?? endAnchor.edgeFraction);
    const traversedMeters = leg.edgeShareIds.reduce((total, shareIdValue, edgeIndex) => {
      const edge = edges.get(Number(shareIdValue));
      if (!edge) return total;
      const shareId = Number(shareIdValue);
      const reverse = leg.directions?.[edgeIndex] === "reverse" || leg.directions?.[edgeIndex] === 1;
      const fromFraction = edgeIndex === 0 && shareId === startShareId
        ? startFraction
        : reverse ? 1 : 0;
      const toFraction = edgeIndex === leg.edgeShareIds.length - 1 && shareId === endShareId
        ? endFraction
        : reverse ? 0 : 1;
      const polyline = edge.coordinates.map(([lng, lat]) => ({ lng, lat }));
      const distanceMeters = Number.isFinite(Number(edge.distanceMeters))
        ? Number(edge.distanceMeters)
        : buildCumulativeDistances(polyline).at(-1) || 0;
      return total + Math.abs(toFraction - fromFraction) * distanceMeters;
    }, 0);
    return traversedMeters - directMeters > 75 && traversedMeters > directMeters * 1.5;
  };
  const points = payload.routePoints
    .map((anchor) => coordinate(anchorPoint(anchor, edges)))
    .filter(Boolean);
  const detours = [];
  for (const [legIndex, leg] of expanded.legs.entries()) {
    const span = payload.spans[legIndex];
    const startAnchor = payload.routePoints[legIndex];
    const endAnchor = payload.routePoints[legIndex + 1];

    // Route points alone do not preserve a deliberately non-shortest span.
    // Keep one shaping point per explicit base span and per curated CW run.
    // A point on every edge overconstrains the current graph: adjacent points
    // can snap to opposite directed copies and introduce tiny loops. One point
    // per authored unit preserves the visit while allowing today's router to
    // choose the safe current traversal through it.
    const preserveSpanShape = span?.type === "cw" || span?.type === "cwChain"
      ? true
      : isDeliberateDetour(leg, startAnchor, endAnchor);
    const shapingPoints = [];
    const strongShapingPoints = [];
    if (preserveSpanShape && span?.type === "cwChain") {
      let offset = 0;
      for (const run of span.runs || []) {
        const edgeCount = Math.max(0, Number(run.edgeCount) || 0);
        if (edgeCount > 0) {
          const middleIndex = offset + Math.floor((edgeCount - 1) / 2);
          appendTraversalProbe(
            shapingPoints,
            strongShapingPoints,
            leg,
            middleIndex,
            edgeCount,
          );
        }
        offset += edgeCount;
      }
    } else if (preserveSpanShape && span?.type === "cw" && leg.edgeShareIds.length > 0) {
      const middleIndex = Math.floor((leg.edgeShareIds.length - 1) / 2);
      appendTraversalProbe(
        shapingPoints,
        strongShapingPoints,
        leg,
        middleIndex,
        leg.edgeShareIds.length,
      );
    } else if (preserveSpanShape && span?.type === "base" && leg.edgeShareIds.length > 1) {
      const midpoint = traversalPoint(
        leg.edgeShareIds[Math.floor((leg.edgeShareIds.length - 1) / 2)],
      );
      shapingPoints.push(midpoint);
      strongShapingPoints.push(midpoint);
    }
    if (shapingPoints.length > 0) {
      detours.push({
        afterPointIndex: legIndex,
        segmentIds: span?.type === "cwChain"
          ? [...new Set((span.runs || []).map((run) => Number(run.segmentId)))]
          : span?.type === "cw"
            ? [Number(span.segmentId)]
            : [],
        points: shapingPoints.filter(Boolean),
        strongPoints: strongShapingPoints.filter(Boolean),
      });
    }
  }
  if (points.length < 2) throw new Error("Historical route intent has fewer than two points");
  return {
    routeSlugs: [],
    strategy: "historical-anchors-with-conditional-detours-v1",
    requiredSegmentIds: [...new Set((payload.segmentIds || []).map(Number))],
    points,
    detours,
  };
}

async function main() {
  const currentIds = await currentShareIds();
  const historicalEdgesByCommit = new Map();
  const graphVersions = {};

  await mkdir(registryHistoryDir, { recursive: true });
  for (const [slug, requestedCommit] of Object.entries(RELEASED_ROUTE_SOURCES)) {
    const commit = execFileSync("git", ["rev-parse", requestedCommit], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const releasedCatalog = JSON.parse(gitShow(commit, "public-data/route-catalog.json"));
    const releasedEntry = (releasedCatalog.entries || []).find((entry) => entry.slug === slug);
    if (!releasedEntry?.route) throw new Error(`${slug} is missing at release commit ${commit}`);

    const payload = decodeRoutePayload(releasedEntry.route);
    if (payload.type !== "hybrid_route_v6") {
      throw new Error(`${slug} is not a hybrid_route_v6 token`);
    }
    const hash = graphHash(payload);
    const historicalManifest = JSON.parse(gitShow(commit, "public-data/map-manifest.json"));
    const historicalCwBaseIndex = JSON.parse(
      gitShow(commit, `public-data/${historicalManifest.cwBaseIndex}`),
    );
    const registryBytes = gitShow(commit, "data/base-edge-share-ids.json", { binary: true });
    const registryDigest = sha256(registryBytes);
    await writeFile(
      path.join(registryHistoryDir, `${registryDigest}.json`),
      registryBytes,
    );

    let edges = historicalEdgesByCommit.get(commit);
    if (!edges) {
      edges = historicalEdges(commit);
      historicalEdgesByCommit.set(commit, edges);
    }
    const requiredShareIds = new Set(
      (payload.routePoints || []).map((point) => Number(point.baseEdgeShareId)),
    );
    for (const shareId of edges.keys()) {
      if (!currentIds.has(shareId)) requiredShareIds.add(shareId);
    }
    const archivedEdges = {};
    for (const shareId of [...requiredShareIds].sort((a, b) => a - b)) {
      const edge = edges.get(shareId);
      if (!edge) throw new Error(`${slug} cannot resolve historical share ID ${shareId}`);
      archivedEdges[String(shareId)] = edgeRecord(edge);
    }
    const intentKey = historicalRouteIntentKey(payload);
    if (!intentKey) throw new Error(`${slug} has no stable historical route-intent key`);
    const routeIntent = routeIntentRecord(
      payload,
      historicalCwBaseIndex,
      edges,
    );
    routeIntent.routeSlugs = [slug];

    const existing = graphVersions[hash];
    if (existing) {
      if (existing.registryDigest !== registryDigest) {
        throw new Error(`Graph hash collision for ${hash}: ${slug}`);
      }
      existing.routeSlugs.push(slug);
      for (const [shareId, edge] of Object.entries(archivedEdges)) {
        const previous = existing.archivedEdges[shareId];
        if (previous && JSON.stringify(previous) !== JSON.stringify(edge)) {
          throw new Error(`Archived edge disagreement for graph ${hash}, share ${shareId}`);
        }
        existing.archivedEdges[shareId] = edge;
      }
      const previousIntent = existing.routeIntents?.[intentKey];
      if (previousIntent && JSON.stringify(previousIntent.points) !== JSON.stringify(routeIntent.points)) {
        throw new Error(`Historical route-intent disagreement for ${slug}`);
      }
      existing.routeIntents ||= {};
      existing.routeIntents[intentKey] = previousIntent
        ? { ...previousIntent, routeSlugs: [...new Set([...previousIntent.routeSlugs, slug])] }
        : routeIntent;
      continue;
    }
    graphVersions[hash] = {
      registryDigest,
      sourceCommit: commit,
      routeSlugs: [slug],
      archivedEdges,
      routeIntents: { [intentKey]: routeIntent },
    };
  }

  const output = {
    schemaVersion: 1,
    fractionBasis: "distance-along-historical-edge-v1",
    graphVersions,
  };
  await writeFile(outputPath, `${JSON.stringify(stable(output), null, 2)}\n`);
  console.log(
    JSON.stringify({
      output: path.relative(repoRoot, outputPath),
      graphVersions: Object.keys(graphVersions).length,
      archivedEdges: Object.values(graphVersions).reduce(
        (total, entry) => total + Object.keys(entry.archivedEdges).length,
        0,
      ),
      registrySnapshots: new Set(
        Object.values(graphVersions).map((entry) => entry.registryDigest),
      ).size,
    }),
  );
}

await main();
