const textDecoder = new TextDecoder();

export function decodeMessagePack(input) {
  const bytes =
    input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  const decoder = new MessagePackDecoder(bytes);
  const value = decoder.decode();
  if (!decoder.done()) {
    throw new Error("MessagePack payload has trailing bytes");
  }
  return value;
}

class MessagePackDecoder {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
  }

  done() {
    return this.offset === this.bytes.length;
  }

  decode() {
    const token = this.readUint8();

    if (token <= 0x7f) return token;
    if (token >= 0xe0) return token - 0x100;
    if ((token & 0xe0) === 0xa0) return this.readString(token & 0x1f);
    if ((token & 0xf0) === 0x90) return this.readArray(token & 0x0f);
    if ((token & 0xf0) === 0x80) return this.readMap(token & 0x0f);

    switch (token) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xca:
        return this.readFloat32();
      case 0xcb:
        return this.readFloat64();
      case 0xcc:
        return this.readUint8();
      case 0xcd:
        return this.readUint16();
      case 0xce:
        return this.readUint32();
      case 0xcf:
        return Number(this.readUint64());
      case 0xd0:
        return this.readInt8();
      case 0xd1:
        return this.readInt16();
      case 0xd2:
        return this.readInt32();
      case 0xd3:
        return Number(this.readInt64());
      case 0xd9:
        return this.readString(this.readUint8());
      case 0xda:
        return this.readString(this.readUint16());
      case 0xdb:
        return this.readString(this.readUint32());
      case 0xdc:
        return this.readArray(this.readUint16());
      case 0xdd:
        return this.readArray(this.readUint32());
      case 0xde:
        return this.readMap(this.readUint16());
      case 0xdf:
        return this.readMap(this.readUint32());
      default:
        throw new Error(`Unsupported MessagePack token 0x${token.toString(16)}`);
    }
  }

  readArray(length) {
    const value = [];
    for (let index = 0; index < length; index++) {
      value.push(this.decode());
    }
    return value;
  }

  readMap(length) {
    const value = {};
    for (let index = 0; index < length; index++) {
      const key = this.decode();
      value[String(key)] = this.decode();
    }
    return value;
  }

  readString(length) {
    const start = this.offset;
    this.offset += length;
    this.assertAvailable(start, length);
    return textDecoder.decode(this.bytes.subarray(start, start + length));
  }

  readUint8() {
    this.assertAvailable(this.offset, 1);
    return this.bytes[this.offset++];
  }

  readInt8() {
    this.assertAvailable(this.offset, 1);
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readUint16() {
    this.assertAvailable(this.offset, 2);
    const value = this.view.getUint16(this.offset);
    this.offset += 2;
    return value;
  }

  readInt16() {
    this.assertAvailable(this.offset, 2);
    const value = this.view.getInt16(this.offset);
    this.offset += 2;
    return value;
  }

  readUint32() {
    this.assertAvailable(this.offset, 4);
    const value = this.view.getUint32(this.offset);
    this.offset += 4;
    return value;
  }

  readInt32() {
    this.assertAvailable(this.offset, 4);
    const value = this.view.getInt32(this.offset);
    this.offset += 4;
    return value;
  }

  readUint64() {
    this.assertAvailable(this.offset, 8);
    const value = this.view.getBigUint64(this.offset);
    this.offset += 8;
    return value;
  }

  readInt64() {
    this.assertAvailable(this.offset, 8);
    const value = this.view.getBigInt64(this.offset);
    this.offset += 8;
    return value;
  }

  readFloat32() {
    this.assertAvailable(this.offset, 4);
    const value = this.view.getFloat32(this.offset);
    this.offset += 4;
    return value;
  }

  readFloat64() {
    this.assertAvailable(this.offset, 8);
    const value = this.view.getFloat64(this.offset);
    this.offset += 8;
    return value;
  }

  assertAvailable(offset, length) {
    if (offset + length > this.bytes.length) {
      throw new Error("Unexpected end of MessagePack payload");
    }
  }
}
