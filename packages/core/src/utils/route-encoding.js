/**
 * Route encoding and decoding utilities
 */

const ROUTE_VERSION = 2;
export const COMPACT_ROUTE_VERSION = 3;
export const BASE_ROUTE_VERSION = 4;
export const HYBRID_ROUTE_VERSION = 5;
export const HYBRID_ROUTE_V6_VERSION = 6;
export const ROUTE_COORDINATE_PRECISION = 1e6;
export const ROUTE_EDGE_FRACTION_PRECISION = 65535;
const HYBRID_SPAN_BASE = 0;
const HYBRID_SPAN_CYCLEWAYS = 1;
const HYBRID_SPAN_CYCLEWAYS_CHAIN = 2;

// Base58 alphabet (Bitcoin-style)
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Base58 encoding function
 * @param {Uint8Array} bytes - Bytes to encode
 * @returns {string} Base58 encoded string
 */
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

/**
 * Base58 decoding function
 * @param {string} str - Base58 encoded string
 * @returns {Uint8Array} Decoded bytes
 */
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

function decodeRouteBytes(routeString) {
  const isBase58 =
    /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(
      routeString,
    );

  if (isBase58) {
    return base58Decode(routeString);
  }

  const binaryString = atob(routeString);
  const binaryData = new ArrayBuffer(binaryString.length);
  const uint8Array = new Uint8Array(binaryData);

  for (let i = 0; i < binaryString.length; i++) {
    uint8Array[i] = binaryString.charCodeAt(i);
  }

  return uint8Array;
}

function writeUnsignedVarint(bytes, value) {
  let remaining = Number(value);
  if (!Number.isSafeInteger(remaining) || remaining < 0) {
    throw new Error(`Invalid varint value: ${value}`);
  }

  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
}

function writeString(bytes, value) {
  const text = typeof value === "string" ? value : "";
  const encoded = new TextEncoder().encode(text);
  writeUnsignedVarint(bytes, encoded.length);
  bytes.push(...encoded);
}

function readString(bytes, cursor) {
  const length = readUnsignedVarint(bytes, cursor);
  if (length === 0) return "";
  if (cursor.index + length > bytes.length) {
    throw new Error("Invalid string: unexpected end of payload");
  }
  const value = new TextDecoder().decode(bytes.subarray(cursor.index, cursor.index + length));
  cursor.index += length;
  return value;
}

function readUnsignedVarint(bytes, cursor) {
  let result = 0;
  let shift = 0;

  while (cursor.index < bytes.length) {
    const byte = bytes[cursor.index++];
    result += (byte & 0x7f) * 2 ** shift;

    if ((byte & 0x80) === 0) {
      return result;
    }

    shift += 7;
    if (shift > 49) {
      throw new Error("Invalid varint: too many bytes");
    }
  }

  throw new Error("Invalid varint: unexpected end of payload");
}

function zigZagEncode(value) {
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

function zigZagDecode(value) {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

function quantizeCoordinate(value) {
  const quantized = Math.round(Number(value) * ROUTE_COORDINATE_PRECISION);
  if (!Number.isSafeInteger(quantized)) {
    throw new Error(`Invalid coordinate value: ${value}`);
  }
  return quantized;
}

function dequantizeCoordinate(value) {
  return value / ROUTE_COORDINATE_PRECISION;
}

function quantizeFraction(value) {
  const fraction = Math.max(0, Math.min(1, Number(value)));
  if (!Number.isFinite(fraction)) return 0;
  return Math.round(fraction * ROUTE_EDGE_FRACTION_PRECISION);
}

function dequantizeFraction(value) {
  return Math.max(0, Math.min(1, Number(value) / ROUTE_EDGE_FRACTION_PRECISION));
}

function isValidLngLat(lng, lat) {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

function writeSignedVarint(bytes, value) {
  writeUnsignedVarint(bytes, zigZagEncode(value));
}

function readSignedVarint(bytes, cursor) {
  return zigZagDecode(readUnsignedVarint(bytes, cursor));
}

function decodeLegacySegmentIds(uint8Array) {
  if (uint8Array.byteLength === 0) {
    console.warn("Empty route data");
    return [];
  }

  const version = uint8Array[0];

  if (version !== 1 && version !== ROUTE_VERSION) {
    console.warn(
      `Unsupported route version: ${version}. Expected version 1 or ${ROUTE_VERSION}.`,
    );
    return [];
  }

  const segmentDataOffset = 2;
  const segmentDataLength = uint8Array.byteLength - segmentDataOffset;

  if (segmentDataLength % 2 !== 0) {
    console.warn("Invalid route data: segment data length is not even");
    return [];
  }

  const view = new Uint16Array(uint8Array.buffer, segmentDataOffset);
  return Array.from(view);
}

export function encodeCompactRoute(routePoints, segmentIds = []) {
  const anchors = Array.isArray(routePoints)
    ? routePoints
        .map((point) => ({
          lng: Number(point?.lng),
          lat: Number(point?.lat),
        }))
        .filter((point) => isValidLngLat(point.lng, point.lat))
    : [];

  if (anchors.length === 0) return "";

  const hints = Array.isArray(segmentIds)
    ? segmentIds
        .map((id) => Number(id))
        .filter((id) => Number.isSafeInteger(id) && id >= 0)
    : [];

  const bytes = [COMPACT_ROUTE_VERSION];
  writeUnsignedVarint(bytes, anchors.length);

  let previousLng = 0;
  let previousLat = 0;
  anchors.forEach((point, index) => {
    const lng = quantizeCoordinate(point.lng);
    const lat = quantizeCoordinate(point.lat);
    writeSignedVarint(bytes, index === 0 ? lng : lng - previousLng);
    writeSignedVarint(bytes, index === 0 ? lat : lat - previousLat);
    previousLng = lng;
    previousLat = lat;
  });

  writeUnsignedVarint(bytes, hints.length);
  hints.forEach((id) => writeUnsignedVarint(bytes, id));

  return base58Encode(new Uint8Array(bytes));
}

export function encodeBaseRoute(routePayload) {
  const points = normalizeBaseRoutePoints(routePayload?.points);
  const shards = normalizeRouteShardCells(routePayload?.shards);
  const legs = normalizeRouteLegs(routePayload?.legs);
  if (points.length === 0) return "";
  if (points.length > 1 && legs.length !== points.length - 1) return "";
  if (legs.length > 0 && shards.length === 0) return "";

  const bytes = [BASE_ROUTE_VERSION];
  writeString(bytes, routePayload?.graphVersion || "");

  writeUnsignedVarint(bytes, points.length);
  let previousLng = 0;
  let previousLat = 0;
  points.forEach((point, index) => {
    const lng = quantizeCoordinate(point.lng);
    const lat = quantizeCoordinate(point.lat);
    writeSignedVarint(bytes, index === 0 ? lng : lng - previousLng);
    writeSignedVarint(bytes, index === 0 ? lat : lat - previousLat);
    previousLng = lng;
    previousLat = lat;
    writeUnsignedVarint(bytes, point.edgeShareId);
    writeUnsignedVarint(bytes, quantizeFraction(point.edgeFraction));
  });

  writeUnsignedVarint(bytes, shards.length);
  let previousX = 0;
  let previousY = 0;
  shards.forEach((shard, index) => {
    writeSignedVarint(bytes, index === 0 ? shard.x : shard.x - previousX);
    writeSignedVarint(bytes, index === 0 ? shard.y : shard.y - previousY);
    previousX = shard.x;
    previousY = shard.y;
  });

  writeUnsignedVarint(bytes, legs.length);
  legs.forEach((leg, legIndex) => {
    writeUnsignedVarint(bytes, leg.fromPoint ?? legIndex);
    writeUnsignedVarint(bytes, leg.toPoint ?? legIndex + 1);
    writeUnsignedVarint(bytes, leg.edgeShareIds.length);
    leg.edgeShareIds.forEach((edgeShareId) => writeUnsignedVarint(bytes, edgeShareId));
    writeDirectionBits(bytes, leg.directions);
  });

  return base58Encode(new Uint8Array(bytes));
}

export function encodeHybridRoute(routePayload) {
  const points = normalizeBaseRoutePoints(
    routePayload?.points || routePayload?.routePoints,
  );
  const shards = normalizeRouteShardCells(routePayload?.shards);
  const spans = normalizeHybridRouteSpans(routePayload?.spans);
  if (points.length < 2) return "";
  if (spans.length !== points.length - 1) return "";
  if (spans.length > 0 && shards.length === 0) return "";

  const bytes = [HYBRID_ROUTE_VERSION];
  writeString(bytes, routePayload?.graphVersion || "");

  writeUnsignedVarint(bytes, points.length);
  let previousLng = 0;
  let previousLat = 0;
  points.forEach((point, index) => {
    const lng = quantizeCoordinate(point.lng);
    const lat = quantizeCoordinate(point.lat);
    writeSignedVarint(bytes, index === 0 ? lng : lng - previousLng);
    writeSignedVarint(bytes, index === 0 ? lat : lat - previousLat);
    previousLng = lng;
    previousLat = lat;
    writeUnsignedVarint(bytes, point.edgeShareId);
    writeUnsignedVarint(bytes, quantizeFraction(point.edgeFraction));
  });

  writeUnsignedVarint(bytes, shards.length);
  let previousX = 0;
  let previousY = 0;
  shards.forEach((shard, index) => {
    writeSignedVarint(bytes, index === 0 ? shard.x : shard.x - previousX);
    writeSignedVarint(bytes, index === 0 ? shard.y : shard.y - previousY);
    previousX = shard.x;
    previousY = shard.y;
  });

  writeUnsignedVarint(bytes, spans.length);
  spans.forEach((span) => {
    if (span.type === "cw") {
      writeUnsignedVarint(bytes, HYBRID_SPAN_CYCLEWAYS);
      writeUnsignedVarint(bytes, span.segmentId);
      writeUnsignedVarint(bytes, span.reversed ? 1 : 0);
      return;
    }

    writeUnsignedVarint(bytes, HYBRID_SPAN_BASE);
    writeUnsignedVarint(bytes, span.edgeShareIds.length);
    span.edgeShareIds.forEach((edgeShareId) => writeUnsignedVarint(bytes, edgeShareId));
    writeDirectionBits(bytes, span.directions);
  });

  return base58Encode(new Uint8Array(bytes));
}

export function encodeHybridRouteV6(routePayload) {
  const points = normalizeBaseRouteAnchors(
    routePayload?.points || routePayload?.routePoints,
    { requireCoordinates: false, requireEdgeShareId: true },
  );
  const shards = normalizeRouteShardCells(routePayload?.shards);
  const spans = normalizeHybridRouteSpans(routePayload?.spans);
  if (points.length < 2) return "";
  if (spans.length !== points.length - 1) return "";
  if (spans.length > 0 && shards.length === 0) return "";

  const bytes = [HYBRID_ROUTE_V6_VERSION];
  writeUnsignedVarint(bytes, graphVersionHash(routePayload));

  writeUnsignedVarint(bytes, points.length);
  let previousEdgeShareId = 0;
  points.forEach((point, index) => {
    if (index === 0) {
      writeUnsignedVarint(bytes, point.edgeShareId);
    } else {
      writeSignedVarint(bytes, point.edgeShareId - previousEdgeShareId);
    }
    previousEdgeShareId = point.edgeShareId;
    writeUnsignedVarint(bytes, quantizeFraction(point.edgeFraction));
  });

  writeUnsignedVarint(bytes, shards.length);
  let previousX = 0;
  let previousY = 0;
  shards.forEach((shard, index) => {
    writeSignedVarint(bytes, index === 0 ? shard.x : shard.x - previousX);
    writeSignedVarint(bytes, index === 0 ? shard.y : shard.y - previousY);
    previousX = shard.x;
    previousY = shard.y;
  });

  writeUnsignedVarint(bytes, spans.length);
  spans.forEach((span) => {
    if (span.type === "cw") {
      writeUnsignedVarint(bytes, HYBRID_SPAN_CYCLEWAYS);
      writeUnsignedVarint(bytes, span.segmentId);
      writeUnsignedVarint(bytes, span.reversed ? 1 : 0);
      return;
    }

    if (span.type === "cwChain") {
      writeUnsignedVarint(bytes, HYBRID_SPAN_CYCLEWAYS_CHAIN);
      writeUnsignedVarint(bytes, span.runs.length);
      span.runs.forEach((run) => {
        writeUnsignedVarint(bytes, run.segmentId);
        writeUnsignedVarint(bytes, run.reversed ? 1 : 0);
        writeUnsignedVarint(bytes, run.startIndex);
        writeUnsignedVarint(bytes, run.edgeCount);
      });
      return;
    }

    writeUnsignedVarint(bytes, HYBRID_SPAN_BASE);
    writeUnsignedVarint(bytes, span.edgeShareIds.length);
    writeEdgeShareIdDeltas(bytes, span.edgeShareIds);
    writeDirectionBits(bytes, span.directions);
  });

  return base58Encode(new Uint8Array(bytes));
}

function normalizeBaseRoutePoints(points) {
  return normalizeBaseRouteAnchors(points, {
    requireCoordinates: true,
    requireEdgeShareId: false,
  });
}

function normalizeBaseRouteAnchors(
  points,
  { requireCoordinates = true, requireEdgeShareId = false } = {},
) {
  return Array.isArray(points)
    ? points
        .map((point) => {
          const lng = Number(point?.lng);
          const lat = Number(point?.lat);
          const edgeShareId = Number(point?.edgeShareId ?? point?.baseEdgeShareId);
          const edgeFraction = Number(point?.edgeFraction ?? point?.baseEdgeFraction);
          return {
            lng,
            lat,
            edgeShareId:
              Number.isSafeInteger(edgeShareId) && edgeShareId > 0
                ? edgeShareId
                : 0,
            edgeFraction: Number.isFinite(edgeFraction) ? edgeFraction : 0,
          };
        })
        .filter((point) => {
          if (requireCoordinates && !isValidLngLat(point.lng, point.lat)) {
            return false;
          }
          if (requireEdgeShareId && point.edgeShareId <= 0) {
            return false;
          }
          return true;
        })
    : [];
}

function graphVersionHash(routePayload) {
  const direct = Number(routePayload?.graphVersionHash);
  if (Number.isSafeInteger(direct) && direct >= 0) {
    return direct;
  }

  const text = String(routePayload?.graphVersion || "");
  if (!text) return 0;

  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function normalizeRouteShardCells(shards) {
  const cells = [];
  for (const shard of Array.isArray(shards) ? shards : []) {
    const cell =
      typeof shard === "string"
        ? parseRouteShardId(shard)
        : {
            x: Number(shard?.x),
            y: Number(shard?.y),
          };
    if (
      Number.isSafeInteger(cell.x) &&
      Number.isSafeInteger(cell.y)
    ) {
      cells.push(cell);
    }
  }
  const unique = new Map(cells.map((cell) => [`${cell.x}:${cell.y}`, cell]));
  return [...unique.values()].sort((first, second) =>
    first.x === second.x ? first.y - second.y : first.x - second.x,
  );
}

function parseRouteShardId(shardId) {
  const match = /^g(-?\d+)_(-?\d+)$/.exec(String(shardId || ""));
  return match
    ? { x: Number(match[1]), y: Number(match[2]) }
    : { x: NaN, y: NaN };
}

function routeShardId(x, y) {
  return `g${x}_${y}`;
}

function normalizeRouteLegs(legs) {
  return Array.isArray(legs)
    ? legs.map((leg, index) => {
        const edgeShareIds = (Array.isArray(leg?.edgeShareIds)
          ? leg.edgeShareIds
          : Array.isArray(leg?.edges)
            ? leg.edges
            : [])
          .map((edgeShareId) => Number(edgeShareId))
          .filter((edgeShareId) => Number.isSafeInteger(edgeShareId) && edgeShareId > 0);
        const directions = (Array.isArray(leg?.directions) ? leg.directions : [])
          .slice(0, edgeShareIds.length)
          .map((direction) =>
            direction === "reverse" || direction === 1 ? "reverse" : "forward",
          );
        while (directions.length < edgeShareIds.length) {
          directions.push("forward");
        }
        return {
          fromPoint:
            Number.isSafeInteger(Number(leg?.fromPoint)) && Number(leg.fromPoint) >= 0
              ? Number(leg.fromPoint)
              : index,
          toPoint:
            Number.isSafeInteger(Number(leg?.toPoint)) && Number(leg.toPoint) >= 0
              ? Number(leg.toPoint)
              : index + 1,
          edgeShareIds,
          directions,
        };
      })
    : [];
}

function normalizeHybridRouteSpans(spans) {
  return Array.isArray(spans)
    ? spans
        .map((span) => {
          if (span?.type === "cw" || span?.type === "cycleways") {
            const segmentId = Number(span.segmentId);
            if (!Number.isSafeInteger(segmentId) || segmentId <= 0) {
              return null;
            }
            return {
              type: "cw",
              segmentId,
              reversed: Boolean(span.reversed),
            };
          }

          if (span?.type === "cwChain" || span?.type === "cw_chain") {
            const runs = (Array.isArray(span.runs) ? span.runs : [])
              .map((run) => ({
                segmentId: Number(run?.segmentId),
                reversed: Boolean(run?.reversed),
                startIndex: Number(run?.startIndex),
                edgeCount: Number(run?.edgeCount),
              }))
              .filter(
                (run) =>
                  Number.isSafeInteger(run.segmentId) &&
                  run.segmentId > 0 &&
                  Number.isSafeInteger(run.startIndex) &&
                  run.startIndex >= 0 &&
                  Number.isSafeInteger(run.edgeCount) &&
                  run.edgeCount > 0,
              );
            return runs.length > 0
              ? {
                  type: "cwChain",
                  runs,
                }
              : null;
          }

          const edgeShareIds = (Array.isArray(span?.edgeShareIds)
            ? span.edgeShareIds
            : Array.isArray(span?.edges)
              ? span.edges
              : [])
            .map((edgeShareId) => Number(edgeShareId))
            .filter(
              (edgeShareId) =>
                Number.isSafeInteger(edgeShareId) && edgeShareId > 0,
            );
          const directions = (Array.isArray(span?.directions)
            ? span.directions
            : [])
            .slice(0, edgeShareIds.length)
            .map((direction) =>
              direction === "reverse" || direction === 1
                ? "reverse"
                : "forward",
            );
          while (directions.length < edgeShareIds.length) {
            directions.push("forward");
          }
          return edgeShareIds.length > 0
            ? {
                type: "base",
                edgeShareIds,
                directions,
              }
            : null;
        })
        .filter(Boolean)
    : [];
}

function writeDirectionBits(bytes, directions) {
  for (let index = 0; index < directions.length; index += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8 && index + bit < directions.length; bit++) {
      if (directions[index + bit] === "reverse") {
        byte |= 1 << bit;
      }
    }
    bytes.push(byte);
  }
}

function readDirectionBits(bytes, cursor, count) {
  const directions = [];
  for (let index = 0; index < count; index += 8) {
    if (cursor.index >= bytes.length) {
      throw new Error("Invalid direction bits: unexpected end of payload");
    }
    const byte = bytes[cursor.index++];
    for (let bit = 0; bit < 8 && directions.length < count; bit++) {
      directions.push((byte & (1 << bit)) !== 0 ? "reverse" : "forward");
    }
  }
  return directions;
}

function writeEdgeShareIdDeltas(bytes, edgeShareIds) {
  let previousEdgeShareId = 0;
  edgeShareIds.forEach((edgeShareId, index) => {
    if (index === 0) {
      writeUnsignedVarint(bytes, edgeShareId);
    } else {
      writeSignedVarint(bytes, edgeShareId - previousEdgeShareId);
    }
    previousEdgeShareId = edgeShareId;
  });
}

function readEdgeShareIdDeltas(bytes, cursor, count) {
  const edgeShareIds = [];
  let previousEdgeShareId = 0;
  for (let edgeIndex = 0; edgeIndex < count; edgeIndex++) {
    const edgeShareId =
      edgeIndex === 0
        ? readUnsignedVarint(bytes, cursor)
        : previousEdgeShareId + readSignedVarint(bytes, cursor);
    previousEdgeShareId = edgeShareId;
    edgeShareIds.push(edgeShareId);
  }
  return edgeShareIds;
}

function decodeCompactRouteBytes(uint8Array) {
  const cursor = { index: 1 };
  const anchorCount = readUnsignedVarint(uint8Array, cursor);
  const routePoints = [];

  let previousLng = 0;
  let previousLat = 0;
  for (let i = 0; i < anchorCount; i++) {
    const lngDelta = readSignedVarint(uint8Array, cursor);
    const latDelta = readSignedVarint(uint8Array, cursor);
    const lng = i === 0 ? lngDelta : previousLng + lngDelta;
    const lat = i === 0 ? latDelta : previousLat + latDelta;

    previousLng = lng;
    previousLat = lat;
    routePoints.push({
      lng: dequantizeCoordinate(lng),
      lat: dequantizeCoordinate(lat),
      id: Date.now() + i + Math.random(),
    });
  }

  const hintCount =
    cursor.index < uint8Array.length ? readUnsignedVarint(uint8Array, cursor) : 0;
  const segmentIds = [];
  for (let i = 0; i < hintCount; i++) {
    segmentIds.push(readUnsignedVarint(uint8Array, cursor));
  }

  return {
    version: COMPACT_ROUTE_VERSION,
    type: "compact_route",
    routePoints,
    segmentIds,
  };
}

function decodeBaseRouteBytes(uint8Array) {
  const cursor = { index: 1 };
  const graphVersion = readString(uint8Array, cursor);
  const pointCount = readUnsignedVarint(uint8Array, cursor);
  const routePoints = [];

  let previousLng = 0;
  let previousLat = 0;
  for (let index = 0; index < pointCount; index++) {
    const lngDelta = readSignedVarint(uint8Array, cursor);
    const latDelta = readSignedVarint(uint8Array, cursor);
    const lng = index === 0 ? lngDelta : previousLng + lngDelta;
    const lat = index === 0 ? latDelta : previousLat + latDelta;
    previousLng = lng;
    previousLat = lat;

    const edgeShareId = readUnsignedVarint(uint8Array, cursor);
    const edgeFraction = dequantizeFraction(readUnsignedVarint(uint8Array, cursor));
    routePoints.push({
      lng: dequantizeCoordinate(lng),
      lat: dequantizeCoordinate(lat),
      id: Date.now() + index + Math.random(),
      baseEdgeShareId: edgeShareId > 0 ? edgeShareId : null,
      baseEdgeFraction: edgeFraction,
    });
  }

  const shardCount = readUnsignedVarint(uint8Array, cursor);
  const shards = [];
  let previousX = 0;
  let previousY = 0;
  for (let index = 0; index < shardCount; index++) {
    const xDelta = readSignedVarint(uint8Array, cursor);
    const yDelta = readSignedVarint(uint8Array, cursor);
    const x = index === 0 ? xDelta : previousX + xDelta;
    const y = index === 0 ? yDelta : previousY + yDelta;
    previousX = x;
    previousY = y;
    shards.push({ id: routeShardId(x, y), x, y });
  }

  const legCount = readUnsignedVarint(uint8Array, cursor);
  const legs = [];
  for (let index = 0; index < legCount; index++) {
    const fromPoint = readUnsignedVarint(uint8Array, cursor);
    const toPoint = readUnsignedVarint(uint8Array, cursor);
    const edgeCount = readUnsignedVarint(uint8Array, cursor);
    const edgeShareIds = [];
    for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex++) {
      edgeShareIds.push(readUnsignedVarint(uint8Array, cursor));
    }
    const directions = readDirectionBits(uint8Array, cursor, edgeCount);
    legs.push({
      fromPoint,
      toPoint,
      edgeShareIds,
      edges: edgeShareIds,
      directions,
    });
  }

  if (cursor.index !== uint8Array.length) {
    throw new Error("Invalid V4 route payload: trailing bytes");
  }

  return {
    version: BASE_ROUTE_VERSION,
    type: "base_route_v4",
    graphVersion,
    routePoints,
    shards,
    legs,
    segmentIds: [],
  };
}

function decodeHybridRouteBytes(uint8Array) {
  const cursor = { index: 1 };
  const graphVersion = readString(uint8Array, cursor);
  const pointCount = readUnsignedVarint(uint8Array, cursor);
  const routePoints = [];

  let previousLng = 0;
  let previousLat = 0;
  for (let index = 0; index < pointCount; index++) {
    const lngDelta = readSignedVarint(uint8Array, cursor);
    const latDelta = readSignedVarint(uint8Array, cursor);
    const lng = index === 0 ? lngDelta : previousLng + lngDelta;
    const lat = index === 0 ? latDelta : previousLat + latDelta;
    previousLng = lng;
    previousLat = lat;

    const edgeShareId = readUnsignedVarint(uint8Array, cursor);
    const edgeFraction = dequantizeFraction(readUnsignedVarint(uint8Array, cursor));
    routePoints.push({
      lng: dequantizeCoordinate(lng),
      lat: dequantizeCoordinate(lat),
      id: Date.now() + index + Math.random(),
      baseEdgeShareId: edgeShareId > 0 ? edgeShareId : null,
      baseEdgeFraction: edgeFraction,
    });
  }

  const shardCount = readUnsignedVarint(uint8Array, cursor);
  const shards = [];
  let previousX = 0;
  let previousY = 0;
  for (let index = 0; index < shardCount; index++) {
    const xDelta = readSignedVarint(uint8Array, cursor);
    const yDelta = readSignedVarint(uint8Array, cursor);
    const x = index === 0 ? xDelta : previousX + xDelta;
    const y = index === 0 ? yDelta : previousY + yDelta;
    previousX = x;
    previousY = y;
    shards.push({ id: routeShardId(x, y), x, y });
  }

  const spanCount = readUnsignedVarint(uint8Array, cursor);
  const spans = [];
  for (let index = 0; index < spanCount; index++) {
    const kind = readUnsignedVarint(uint8Array, cursor);
    if (kind === HYBRID_SPAN_CYCLEWAYS) {
      const segmentId = readUnsignedVarint(uint8Array, cursor);
      const reversed = readUnsignedVarint(uint8Array, cursor) === 1;
      spans.push({
        type: "cw",
        segmentId,
        reversed,
        fromPoint: index,
        toPoint: index + 1,
      });
      continue;
    }

    if (kind !== HYBRID_SPAN_BASE) {
      throw new Error(`Invalid V5 route span kind: ${kind}`);
    }
    const edgeCount = readUnsignedVarint(uint8Array, cursor);
    const edgeShareIds = [];
    for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex++) {
      edgeShareIds.push(readUnsignedVarint(uint8Array, cursor));
    }
    const directions = readDirectionBits(uint8Array, cursor, edgeCount);
    spans.push({
      type: "base",
      fromPoint: index,
      toPoint: index + 1,
      edgeShareIds,
      edges: edgeShareIds,
      directions,
    });
  }

  if (cursor.index !== uint8Array.length) {
    throw new Error("Invalid V5 route payload: trailing bytes");
  }

  return {
    version: HYBRID_ROUTE_VERSION,
    type: "hybrid_route_v5",
    graphVersion,
    routePoints,
    shards,
    spans,
    segmentIds: [
      ...new Set(
        spans
          .filter((span) => span.type === "cw")
          .map((span) => span.segmentId),
      ),
    ],
  };
}

function decodeHybridRouteV6Bytes(uint8Array) {
  const cursor = { index: 1 };
  const graphVersionHash = readUnsignedVarint(uint8Array, cursor);
  const pointCount = readUnsignedVarint(uint8Array, cursor);
  const routePoints = [];

  let previousEdgeShareId = 0;
  for (let index = 0; index < pointCount; index++) {
    const edgeShareId =
      index === 0
        ? readUnsignedVarint(uint8Array, cursor)
        : previousEdgeShareId + readSignedVarint(uint8Array, cursor);
    previousEdgeShareId = edgeShareId;
    const edgeFraction = dequantizeFraction(readUnsignedVarint(uint8Array, cursor));
    routePoints.push({
      id: Date.now() + index + Math.random(),
      baseEdgeShareId: edgeShareId > 0 ? edgeShareId : null,
      baseEdgeFraction: edgeFraction,
    });
  }

  const shardCount = readUnsignedVarint(uint8Array, cursor);
  const shards = [];
  let previousX = 0;
  let previousY = 0;
  for (let index = 0; index < shardCount; index++) {
    const xDelta = readSignedVarint(uint8Array, cursor);
    const yDelta = readSignedVarint(uint8Array, cursor);
    const x = index === 0 ? xDelta : previousX + xDelta;
    const y = index === 0 ? yDelta : previousY + yDelta;
    previousX = x;
    previousY = y;
    shards.push({ id: routeShardId(x, y), x, y });
  }

  const spanCount = readUnsignedVarint(uint8Array, cursor);
  const spans = [];
  for (let index = 0; index < spanCount; index++) {
    const kind = readUnsignedVarint(uint8Array, cursor);
    if (kind === HYBRID_SPAN_CYCLEWAYS) {
      const segmentId = readUnsignedVarint(uint8Array, cursor);
      const reversed = readUnsignedVarint(uint8Array, cursor) === 1;
      spans.push({
        type: "cw",
        segmentId,
        reversed,
        fromPoint: index,
        toPoint: index + 1,
      });
      continue;
    }

    if (kind === HYBRID_SPAN_CYCLEWAYS_CHAIN) {
      const runCount = readUnsignedVarint(uint8Array, cursor);
      const runs = [];
      for (let runIndex = 0; runIndex < runCount; runIndex++) {
        runs.push({
          segmentId: readUnsignedVarint(uint8Array, cursor),
          reversed: readUnsignedVarint(uint8Array, cursor) === 1,
          startIndex: readUnsignedVarint(uint8Array, cursor),
          edgeCount: readUnsignedVarint(uint8Array, cursor),
        });
      }
      spans.push({
        type: "cwChain",
        fromPoint: index,
        toPoint: index + 1,
        runs,
      });
      continue;
    }

    if (kind !== HYBRID_SPAN_BASE) {
      throw new Error(`Invalid V6 route span kind: ${kind}`);
    }
    const edgeCount = readUnsignedVarint(uint8Array, cursor);
    const edgeShareIds = readEdgeShareIdDeltas(uint8Array, cursor, edgeCount);
    const directions = readDirectionBits(uint8Array, cursor, edgeCount);
    spans.push({
      type: "base",
      fromPoint: index,
      toPoint: index + 1,
      edgeShareIds,
      edges: edgeShareIds,
      directions,
    });
  }

  if (cursor.index !== uint8Array.length) {
    throw new Error("Invalid V6 route payload: trailing bytes");
  }

  return {
    version: HYBRID_ROUTE_V6_VERSION,
    type: "hybrid_route_v6",
    graphVersion: graphVersionHash > 0 ? `h${graphVersionHash.toString(16)}` : "",
    graphVersionHash,
    routePoints,
    shards,
    spans,
    segmentIds: [
      ...new Set(
        spans.flatMap((span) => {
          if (span.type === "cw") return [span.segmentId];
          if (span.type === "cwChain") {
            return span.runs.map((run) => run.segmentId);
          }
          return [];
        }),
      ),
    ],
  };
}

export function decodeRoutePayload(routeString) {
  if (!routeString) {
    return {
      version: null,
      type: "empty",
      routePoints: [],
      segmentIds: [],
    };
  }

  try {
    const uint8Array = decodeRouteBytes(routeString);
    if (uint8Array.byteLength === 0) {
      return {
        version: null,
        type: "empty",
        routePoints: [],
        segmentIds: [],
      };
    }

    const version = uint8Array[0];
    if (version === HYBRID_ROUTE_V6_VERSION) {
      return decodeHybridRouteV6Bytes(uint8Array);
    }
    if (version === HYBRID_ROUTE_VERSION) {
      return decodeHybridRouteBytes(uint8Array);
    }
    if (version === BASE_ROUTE_VERSION) {
      return decodeBaseRouteBytes(uint8Array);
    }
    if (version === COMPACT_ROUTE_VERSION) {
      return decodeCompactRouteBytes(uint8Array);
    }

    return {
      version,
      type: "legacy_segments",
      routePoints: [],
      segmentIds: decodeLegacySegmentIds(uint8Array),
    };
  } catch (error) {
    console.error("Error decoding route payload:", error);
    return {
      version: null,
      type: "invalid",
      routePoints: [],
      segmentIds: [],
    };
  }
}

/**
 * Encode route segments to a compact string
 * @param {Array} segmentIds - Array of segment ids
 * @returns {string} Encoded route string
 */
export function encodeRoute(segmentIds) {
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

/**
 * Decode route string back to segment IDs
 * @param {string} routeString - Encoded route string
 * @param {Object} segmentsData - Segments metadata object
 * @returns {Array} Array of segment IDs
 */
export function decodeRoute(routeString, segmentsData) {
  if (!routeString) return [];

  try {
    const payload = decodeRoutePayload(routeString);
    return payload.type === "legacy_segments" ? payload.segmentIds : [];
  } catch (error) {
    console.error("Error decoding route:", error);
    return [];
  }
}

function routeAnchorToPoint(anchor) {
  if (Array.isArray(anchor) && anchor.length >= 2) {
    const lng = Number(anchor[0]);
    const lat = Number(anchor[1]);
    const elevation = anchor.length >= 3 ? Number(anchor[2]) : 0.0;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        lat,
        lng,
        elevation: Number.isFinite(elevation) ? elevation : 0.0,
      };
    }
  }

  if (anchor && typeof anchor === "object") {
    const lat = Number(anchor.latitude ?? anchor.lat);
    const lng = Number(anchor.longitude ?? anchor.lng);
    const elevation = Number(anchor.elevation ?? 0.0);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        lat,
        lng,
        elevation: Number.isFinite(elevation) ? elevation : 0.0,
      };
    }
  }

  return null;
}

function extractRouteAnchorPoints(segmentInfo) {
  if (!Array.isArray(segmentInfo?.routeAnchors)) return [];
  return segmentInfo.routeAnchors.map(routeAnchorToPoint).filter(Boolean);
}

/**
 * Extract middle points from segment IDs
 * @param {Array} segmentIds - Array of segment IDs
 * @param {Object} segmentsData - Segments metadata object
 * @returns {Array} Array of middle points with lat, lng, and optional elevation
 */
export function extractMiddlePoints(segmentIds, segmentsData) {
  const middlePoints = [];

  for (const segmentId of segmentIds) {
    let foundSegment = null;

    // Find segment by ID
    for (const segmentName in segmentsData) {
      const segmentInfo = segmentsData[segmentName];
      if (segmentInfo && segmentInfo.id === segmentId) {
        foundSegment = { name: segmentName, info: segmentInfo };
        break;
      }
    }

    if (!foundSegment) {
      continue;
    }

    const routeAnchorPoints = extractRouteAnchorPoints(foundSegment.info);
    if (routeAnchorPoints.length > 0) {
      for (const point of routeAnchorPoints) {
        middlePoints.push({
          ...point,
          sourceSegmentName: foundSegment.name,
          sourceSegmentId: segmentId,
          id: Date.now() + Math.random(),
        });
      }
      continue;
    }

    // Skip if segment doesn't have a middle point
    if (!foundSegment.info.middle || !foundSegment.info.middle.longitude || !foundSegment.info.middle.latitude) {
      continue;
    }

    // Add middle point to the array
    const isDeprecated =
      foundSegment.info.deprecated ||
      ["deprecated", "legacy", "draft"].includes(foundSegment.info.status);
    const middlePoint = {
      lat: foundSegment.info.middle.latitude,
      lng: foundSegment.info.middle.longitude,
      elevation: foundSegment.info.middle.elevation || 0.0,
      sourceSegmentName: foundSegment.name,
      sourceSegmentId: segmentId,
      id: Date.now() + Math.random() // Generate a unique ID for the point
    };
    if (!isDeprecated) {
      middlePoint.segmentName = foundSegment.name;
    }
    middlePoints.push(middlePoint);
  }

  return middlePoints;
}
