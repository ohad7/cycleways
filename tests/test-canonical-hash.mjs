import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  canonicalSha256,
  canonicalStringify,
  sha256Hex,
} from "../packages/core/src/utils/canonicalHash.js";

const vectors = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  ["שלום 🚲", null],
];
for (const [input, expected] of vectors) {
  const nodeDigest = createHash("sha256").update(input, "utf8").digest("hex");
  assert.equal(sha256Hex(input), expected || nodeDigest);
}

assert.equal(
  canonicalStringify({ z: 1, a: [3, { y: true, x: null }] }),
  '{"a":[3,{"x":null,"y":true}],"z":1}',
);
assert.equal(canonicalSha256({ b: 2, a: 1 }), canonicalSha256({ a: 1, b: 2 }));

console.log("canonical hash ok");
