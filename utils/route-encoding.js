/**
 * Route encoding and decoding utilities
 */

const ROUTE_VERSION = 2;

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
 * Decode route string back to segment names
 * @param {string} routeString - Encoded route string
 * @param {Object} segmentsData - Segments metadata object
 * @returns {Array} Array of segment names
 */
export function decodeRoute(routeString, segmentsData) {
  if (!routeString) return [];

  try {
    let uint8Array;

    // Try to determine if this is base58 or base64 encoding
    const isBase58 =
      /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(
        routeString,
      );

    if (isBase58) {
      // Decode from base58 (version 2)
      uint8Array = base58Decode(routeString);
    } else {
      // Decode from base64 (legacy version 1)
      const binaryString = atob(routeString);
      const binaryData = new ArrayBuffer(binaryString.length);
      uint8Array = new Uint8Array(binaryData);

      for (let i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i);
      }
    }

    // Check for empty data
    if (uint8Array.byteLength === 0) {
      console.warn("Empty route data");
      return [];
    }

    // Read version from first byte
    const version = uint8Array[0];

    if (version !== 1 && version !== ROUTE_VERSION) {
      console.warn(
        `Unsupported route version: ${version}. Expected version 1 or ${ROUTE_VERSION}.`,
      );
      return [];
    }

    // Parse segment data (skip version and padding bytes)
    const segmentDataOffset = 2;
    const segmentDataLength = uint8Array.byteLength - segmentDataOffset;

    if (segmentDataLength % 2 !== 0) {
      console.warn("Invalid route data: segment data length is not even");
      return [];
    }

    const view = new Uint16Array(uint8Array.buffer, segmentDataOffset);
    const segmentIds = Array.from(view);

    // Convert IDs back to segment names, handling splits
    const segmentNames = [];

    for (let i = 0; i < segmentIds.length; i++) {
      const segmentId = segmentIds[i];
      let foundSegment = null;

      // Find segment by ID
      for (const segmentName in segmentsData) {
        const segmentInfo = segmentsData[segmentName];
        if (segmentInfo && segmentInfo.id === segmentId) {
          foundSegment = { name: segmentName, info: segmentInfo };
          break;
        }
      }

      if (foundSegment) {
        // Check if this segment has split property
        if (foundSegment.info.split && Array.isArray(foundSegment.info.split)) {
          // Replace with split segments
          const splitSegmentIds = foundSegment.info.split;

          // Find the actual segment names for the split IDs
          const splitSegmentNames = [];
          for (const splitId of splitSegmentIds) {
            for (const segmentName in segmentsData) {
              const segmentInfo = segmentsData[segmentName];
              if (segmentInfo && segmentInfo.id === splitId) {
                splitSegmentNames.push(segmentName);
                break;
              }
            }
          }

          // Wait for routePolylines to be available before processing connectivity
          if (splitSegmentNames.length > 0) {
            // For now, just add them in order - connectivity will be handled later by getOrderedCoordinates
            segmentNames.push(...splitSegmentNames);
          }
        } else {
          // Regular segment, add it
          segmentNames.push(foundSegment.name);
        }
      }
    }

    return segmentNames.filter((name) => name); // Remove empty slots
  } catch (error) {
    console.error("Error decoding route:", error);
    return [];
  }
}
