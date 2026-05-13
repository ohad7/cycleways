/**
 * Route encoding and decoding utilities
 */

const ROUTE_VERSION = 2;
export const COMPACT_ROUTE_VERSION = 3;
export const ROUTE_COORDINATE_PRECISION = 1e6;

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
