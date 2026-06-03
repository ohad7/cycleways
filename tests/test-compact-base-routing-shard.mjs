import assert from "node:assert/strict";
import { createBaseRoutingShardFetchLoader } from "@cycleways/core/routing/baseRoutingShards.js";
import { decodeCompactBaseRoutingShard } from "@cycleways/core/routing/compactBaseRoutingShard.js";

const shardPayload = encodeCompactShard({
  formatVersion: 2,
  schemaVersion: 1,
  sourceRoutingSchemaVersion: 2,
  id: "g1_1",
  bounds: [35, 33, 35.05, 33.05],
  nodes: [
    { id: "n1", coord: [35, 33] },
    { id: "n2", coord: [35.001, 33.002] },
  ],
  edges: [
    {
      id: "edge-1",
      shareId: 42,
      from: "n1",
      to: "n2",
      distanceMeters: 123.4,
      coordinates: [[35, 33], [35.0005, 33.0005], [35.001, 33.002]],
      source: "osm",
      routeClass: "path_track",
      highway: "track",
      accessStatus: "open",
      roadType: null,
      cwSegmentIds: [7, 8],
      elevation: { fromMeters: 10, toMeters: 12.5, netMeters: 2.5 },
    },
  ],
});

assert.deepEqual(decodeCompactBaseRoutingShard(shardPayload), {
  schemaVersion: 1,
  sourceRoutingSchemaVersion: 2,
  id: "g1_1",
  bounds: [35, 33, 35.05, 33.05],
  nodes: [
    { id: "n1", coord: [35, 33] },
    { id: "n2", coord: [35.001, 33.002] },
  ],
  edges: [
    {
      id: "edge-1",
      shareId: 42,
      from: "n1",
      to: "n2",
      distanceMeters: 123.4,
      coordinates: [[35, 33], [35.0005, 33.0005], [35.001, 33.002]],
      source: "osm",
      routeClass: "path_track",
      highway: "track",
      accessStatus: "open",
      roadType: null,
      cwSegmentIds: [7, 8],
      elevation: { fromMeters: 10, toMeters: 12.5, netMeters: 2.5 },
    },
  ],
  summary: {
    nodes: 2,
    edges: 1,
  },
});

let requestedUrl = "";
const previousFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  requestedUrl = String(url);
  return {
    ok: true,
    arrayBuffer: async () =>
      shardPayload.buffer.slice(
        shardPayload.byteOffset,
        shardPayload.byteOffset + shardPayload.byteLength,
      ),
  };
};
try {
  const loadShard = createBaseRoutingShardFetchLoader(
    "base-routing-shards.test/manifest.json",
    {},
    new URL("http://127.0.0.1/app/"),
    { format: "default" },
  );
  const shard = await loadShard({
    id: "g1_1",
    path: "shards/g1_1.cwb",
    format: "compact",
    formats: {
      compact: { path: "shards/g1_1.cwb", sha256: "abc123" },
    },
  });
  assert.equal(
    requestedUrl,
    "http://127.0.0.1/app/base-routing-shards.test/shards/g1_1.cwb?h=abc123",
  );
  assert.equal(shard.id, "g1_1");
  assert.equal(shard.edges[0].id, "edge-1");
} finally {
  globalThis.fetch = previousFetch;
}

console.log("Compact base routing shard tests passed");

function encodeCompactShard(shard) {
  const strings = [
    ...new Set([
      shard.id,
      ...shard.nodes.map((node) => node.id),
      ...shard.edges.flatMap((edge) => [
        edge.id,
        edge.from,
        edge.to,
        edge.source,
        edge.routeClass,
        edge.highway,
        edge.accessStatus,
        edge.roadType,
      ]),
    ]),
  ]
    .filter((value) => typeof value === "string" && value !== "")
    .sort();
  const stringIndex = new Map(strings.map((value, index) => [value, index]));
  const nodeIndex = new Map(shard.nodes.map((node, index) => [node.id, index]));
  const bytes = [];
  writeAscii(bytes, "CWBS1");
  writeVarUint(bytes, shard.formatVersion || 1);
  writeVarUint(bytes, strings.length);
  for (const value of strings) {
    const encoded = new TextEncoder().encode(value);
    writeVarUint(bytes, encoded.length);
    bytes.push(...encoded);
  }
  writeVarUint(bytes, shard.schemaVersion);
  writeVarUint(bytes, shard.sourceRoutingSchemaVersion);
  writeVarUint(bytes, stringIndex.get(shard.id));
  shard.bounds.forEach((value) => writeVarInt(bytes, Math.round(value * 1_000_000)));
  writeVarUint(bytes, shard.nodes.length);
  for (const node of shard.nodes) {
    writeVarUint(bytes, stringIndex.get(node.id));
    writeVarInt(bytes, Math.round(node.coord[0] * 1_000_000));
    writeVarInt(bytes, Math.round(node.coord[1] * 1_000_000));
  }
  writeVarUint(bytes, shard.edges.length);
  for (const edge of shard.edges) {
    writeVarUint(bytes, stringIndex.get(edge.id));
    if ((shard.formatVersion || 1) >= 2) {
      writeVarUint(bytes, edge.shareId || 0);
    }
    writeVarUint(bytes, nodeIndex.get(edge.from));
    writeVarUint(bytes, nodeIndex.get(edge.to));
    writeVarInt(bytes, Math.round(edge.distanceMeters * 10));
    writeVarUint(bytes, edge.coordinates.length);
    let previousLng = 0;
    let previousLat = 0;
    edge.coordinates.forEach((coord, index) => {
      const lng = Math.round(coord[0] * 1_000_000);
      const lat = Math.round(coord[1] * 1_000_000);
      writeVarInt(bytes, index === 0 ? lng : lng - previousLng);
      writeVarInt(bytes, index === 0 ? lat : lat - previousLat);
      previousLng = lng;
      previousLat = lat;
    });
    writeNullableStringIndex(bytes, stringIndex, edge.source);
    writeNullableStringIndex(bytes, stringIndex, edge.routeClass);
    writeNullableStringIndex(bytes, stringIndex, edge.highway);
    writeNullableStringIndex(bytes, stringIndex, edge.accessStatus);
    writeNullableStringIndex(bytes, stringIndex, edge.roadType);
    writeVarUint(bytes, edge.cwSegmentIds.length);
    edge.cwSegmentIds.forEach((segmentId) => writeVarUint(bytes, segmentId));
    writeVarUint(bytes, 1);
    writeVarInt(bytes, Math.round(edge.elevation.fromMeters * 10));
    writeVarInt(bytes, Math.round(edge.elevation.toMeters * 10));
    writeVarInt(bytes, Math.round(edge.elevation.netMeters * 10));
  }
  return new Uint8Array(bytes);
}

function writeNullableStringIndex(bytes, stringIndex, value) {
  writeVarUint(bytes, value ? stringIndex.get(value) + 1 : 0);
}

function writeAscii(bytes, value) {
  for (let index = 0; index < value.length; index++) {
    bytes.push(value.charCodeAt(index));
  }
}

function writeVarUint(bytes, value) {
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  bytes.push(value);
}

function writeVarInt(bytes, value) {
  writeVarUint(bytes, value >= 0 ? value * 2 : (-value * 2) - 1);
}
