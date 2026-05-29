import assert from "node:assert/strict";
import { createBaseRoutingShardFetchLoader } from "@cycleways/core/routing/baseRoutingShards.js";
import { decodeMessagePack } from "@cycleways/core/routing/messagePack.js";

const payload = new Uint8Array([
  0x84,
  0xa1,
  0x61,
  0x01,
  0xa1,
  0x62,
  0x93,
  0xc3,
  0xc0,
  0xa1,
  0x78,
  0xa1,
  0x63,
  0xff,
  0xa1,
  0x64,
  0xcb,
  0x3f,
  0xf8,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
]);

assert.deepEqual(decodeMessagePack(payload), {
  a: 1,
  b: [true, null, "x"],
  c: -1,
  d: 1.5,
});

assert.throws(
  () => decodeMessagePack(new Uint8Array([0x01, 0x02])),
  /trailing bytes/,
);

const shardPayload = new Uint8Array([
  0x83,
  0xa2,
  0x69,
  0x64,
  0xa1,
  0x67,
  0xa5,
  0x6e,
  0x6f,
  0x64,
  0x65,
  0x73,
  0x90,
  0xa5,
  0x65,
  0x64,
  0x67,
  0x65,
  0x73,
  0x90,
]);
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
    { format: "msgpack" },
  );
  const shard = await loadShard({
    id: "g",
    path: "shards/g.json",
    formats: {
      msgpack: { path: "shards/g.msgpack" },
    },
  });
  assert.equal(
    requestedUrl,
    "http://127.0.0.1/app/base-routing-shards.test/shards/g.msgpack",
  );
  assert.deepEqual(shard, { id: "g", nodes: [], edges: [] });
} finally {
  globalThis.fetch = previousFetch;
}

console.log("MessagePack decoder tests passed");
