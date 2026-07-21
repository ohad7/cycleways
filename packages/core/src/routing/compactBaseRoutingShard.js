const textDecoder = new TextDecoder();
const MAGIC = "CWBS1";
const SUPPORTED_VERSIONS = new Set([1, 2, 3, 4, 5]);
const COORDINATE_SCALE = 1_000_000;
const DISTANCE_SCALE = 10;

export function decodeCompactBaseRoutingShard(input) {
  const bytes =
    input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  const decoder = new CompactBaseRoutingShardDecoder(bytes);
  return decoder.decode();
}

class CompactBaseRoutingShardDecoder {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }

  decode() {
    this.readMagic();
    this.version = this.readVarUint();
    if (!SUPPORTED_VERSIONS.has(this.version)) {
      throw new Error(`Unsupported compact base routing shard version: ${this.version}`);
    }

    const strings = this.readStringTable();
    const schemaVersion = this.readVarUint();
    const sourceRoutingSchemaVersion = this.readNullableVersion();
    const id = strings[this.readVarUint()];
    const bounds = [
      this.readScaledSigned(COORDINATE_SCALE, 6),
      this.readScaledSigned(COORDINATE_SCALE, 6),
      this.readScaledSigned(COORDINATE_SCALE, 6),
      this.readScaledSigned(COORDINATE_SCALE, 6),
    ];
    const nodes = this.readNodes(strings);
    const edges = this.readEdges(strings, nodes);
    if (this.offset !== this.bytes.length) {
      throw new Error("Compact base routing shard has trailing bytes");
    }

    return {
      schemaVersion,
      sourceRoutingSchemaVersion,
      id,
      bounds,
      nodes,
      edges,
      summary: {
        nodes: nodes.length,
        edges: edges.length,
      },
    };
  }

  readMagic() {
    const magic = this.readAscii(MAGIC.length);
    if (magic !== MAGIC) {
      throw new Error("Invalid compact base routing shard magic");
    }
  }

  readStringTable() {
    const count = this.readVarUint();
    const strings = [];
    for (let index = 0; index < count; index++) {
      const length = this.readVarUint();
      strings.push(this.readString(length));
    }
    return strings;
  }

  readNodes(strings) {
    const count = this.readVarUint();
    const nodes = [];
    for (let index = 0; index < count; index++) {
      const id = strings[this.readVarUint()];
      nodes.push({
        id,
        coord: [
          this.readScaledSigned(COORDINATE_SCALE, 6),
          this.readScaledSigned(COORDINATE_SCALE, 6),
        ],
      });
    }
    return nodes;
  }

  readEdges(strings, nodes) {
    const count = this.readVarUint();
    const edges = [];
    for (let index = 0; index < count; index++) {
      const id = strings[this.readVarUint()];
      const shareId = this.version >= 2 ? this.readVarUint() : 0;
      const fromNodeIndex = this.readVarUint();
      const toNodeIndex = this.readVarUint();
      const distanceMeters = this.readScaledSigned(DISTANCE_SCALE, 1);
      const coordinates = this.readCoordinates();
      const edge = {
        id,
        from: nodes[fromNodeIndex]?.id,
        to: nodes[toNodeIndex]?.id,
        distanceMeters,
        coordinates,
        source: this.readNullableString(strings),
        routeClass: this.readNullableString(strings),
        highway: this.readNullableString(strings),
        accessStatus: this.readNullableString(strings),
        roadType: this.readNullableString(strings),
        cwSegmentIds: this.readSegmentIds(),
      };
      if (this.version >= 2) {
        edge.shareId = shareId > 0 ? shareId : null;
      }
      const elevation = this.readElevation();
      if (elevation) {
        edge.elevation = elevation;
      }
      if (this.version >= 3) {
        edge.bicycleTraversal = this.readBicycleTraversal(strings);
        edge.cwAlignments = {
          forward: this.readAlignmentMemberships(strings),
          reverse: this.readAlignmentMemberships(strings),
        };
      }
      if (this.version >= 4) {
        edge.cwJunctions = {
          forward: this.readJunctionMemberships(strings),
          reverse: this.readJunctionMemberships(strings),
        };
      }
      edges.push(edge);
    }
    return edges;
  }

  readCoordinates() {
    const count = this.readVarUint();
    const coordinates = [];
    let lng = 0;
    let lat = 0;
    for (let index = 0; index < count; index++) {
      if (index === 0) {
        lng = this.readVarInt();
        lat = this.readVarInt();
      } else {
        lng += this.readVarInt();
        lat += this.readVarInt();
      }
      coordinates.push([
        scaledToNumber(lng, COORDINATE_SCALE, 6),
        scaledToNumber(lat, COORDINATE_SCALE, 6),
      ]);
    }
    return coordinates;
  }

  readSegmentIds() {
    const count = this.readVarUint();
    const segmentIds = [];
    for (let index = 0; index < count; index++) {
      segmentIds.push(this.readVarUint());
    }
    return segmentIds;
  }

  readElevation() {
    const hasElevation = this.readVarUint() === 1;
    if (!hasElevation) return null;
    return {
      fromMeters: this.readScaledSigned(DISTANCE_SCALE, 1),
      toMeters: this.readScaledSigned(DISTANCE_SCALE, 1),
      netMeters: this.readScaledSigned(DISTANCE_SCALE, 1),
    };
  }

  readBicycleTraversal(strings) {
    const states = [null, "allowed", "prohibited", "conditional", "unknown"];
    const forward = states[this.readVarUint()] || "unknown";
    const reverse = states[this.readVarUint()] || "unknown";
    return {
      policyId: this.readNullableString(strings),
      policyDigest: this.readNullableString(strings),
      forward,
      reverse,
      forwardReason: this.readNullableString(strings),
      reverseReason: this.readNullableString(strings),
    };
  }

  readAlignmentMemberships(strings) {
    const count = this.readVarUint();
    const memberships = [];
    for (let index = 0; index < count; index++) {
      memberships.push({
        segmentId: this.readVarUint(),
        alignmentKey: this.readNullableString(strings),
        mappingDigest: this.readNullableString(strings),
      });
    }
    return memberships;
  }

  readJunctionMemberships(strings) {
    const count = this.readVarUint();
    const memberships = [];
    for (let index = 0; index < count; index++) {
      memberships.push({
        junctionId: this.readNullableString(strings),
        fingerprint: this.readNullableString(strings),
        ...(this.version >= 5 ? { junctionName: this.readNullableString(strings) } : {}),
      });
    }
    return memberships;
  }

  readNullableVersion() {
    const value = this.readVarUint();
    return value === 0 ? null : value;
  }

  readNullableString(strings) {
    const value = this.readVarUint();
    return value === 0 ? null : strings[value - 1];
  }

  readScaledSigned(scale, decimals) {
    return scaledToNumber(this.readVarInt(), scale, decimals);
  }

  readVarUint() {
    let result = 0;
    let shift = 0;
    while (shift <= 35) {
      const byte = this.readByte();
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) {
        return result;
      }
      shift += 7;
    }
    throw new Error("Compact base routing shard varint is too large");
  }

  readVarInt() {
    const value = this.readVarUint();
    return value % 2 === 0 ? value / 2 : -((value + 1) / 2);
  }

  readByte() {
    if (this.offset >= this.bytes.length) {
      throw new Error("Unexpected end of compact base routing shard");
    }
    return this.bytes[this.offset++];
  }

  readAscii(length) {
    this.assertAvailable(length);
    let value = "";
    for (let index = 0; index < length; index++) {
      value += String.fromCharCode(this.bytes[this.offset + index]);
    }
    this.offset += length;
    return value;
  }

  readString(length) {
    this.assertAvailable(length);
    const start = this.offset;
    this.offset += length;
    return textDecoder.decode(this.bytes.subarray(start, start + length));
  }

  assertAvailable(length) {
    if (this.offset + length > this.bytes.length) {
      throw new Error("Unexpected end of compact base routing shard");
    }
  }
}

function scaledToNumber(value, scale, decimals) {
  return Number((value / scale).toFixed(decimals));
}
