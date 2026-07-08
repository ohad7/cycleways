import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendLabel,
  hashStrategy,
  latestLabels,
  readLabels,
  upsertStrategy,
  validateLabelRecord,
} from "../editor/lib/connectorLabelStore.mjs";

const dir = join(tmpdir(), `connector-label-store-${process.pid}-${Date.now()}`);
const labelsPath = join(dir, "labels.jsonl");
const strategiesPath = join(dir, "strategies.json");
const strategy = {
  snap: "any",
  uphillWeight: 8,
  classMultipliers: { road: 1, local_road: 4 },
};
const strategyHash = hashStrategy(strategy);

const good = {
  routeSlug: "banias",
  routeStart: { lat: 33, lng: 35 },
  origin: { lat: 33.001, lng: 35.001 },
  verdict: "valid",
  strategyHash,
  features: { featureVersion: 1, snapOk: true },
};

assert.equal(validateLabelRecord(good), null);
assert.match(validateLabelRecord({ ...good, verdict: "maybe" }), /verdict/);
assert.match(validateLabelRecord({ ...good, origin: null }), /origin/);
assert.match(validateLabelRecord({ ...good, strategyHash: "sha256:abc" }), /strategyHash/);

const h1 = hashStrategy({ a: 1, b: { c: 2, d: 3 } });
const h2 = hashStrategy({ b: { d: 3, c: 2 }, a: 1 });
assert.equal(h1, h2);
assert.match(h1, /^sha256:[0-9a-f]{64}$/);

const rec1 = await appendLabel(labelsPath, good);
assert.ok(rec1.ts);
const rec2 = await appendLabel(labelsPath, {
  ...good,
  verdict: "unacceptable",
});
const all = await readLabels(labelsPath);
assert.equal(all.length, 2);
assert.equal(all[0].verdict, "valid");
assert.equal(all[1].verdict, "unacceptable");
assert.equal(latestLabels(all).length, 1);
assert.equal(latestLabels(all)[0].verdict, "unacceptable");
assert.equal(rec2.strategyHash, strategyHash);

assert.deepEqual(await readLabels(join(dir, "missing.jsonl")), []);

await assert.rejects(
  () => appendLabel(labelsPath, { ...good, verdict: "bad" }),
  (error) => error?.status === 400,
);

const upserted = await upsertStrategy(strategiesPath, strategy);
assert.equal(upserted, strategyHash);
const sidecar = JSON.parse(await readFile(strategiesPath, "utf8"));
assert.deepEqual(sidecar[strategyHash], strategy);
await upsertStrategy(strategiesPath, { ...strategy });
const sidecarAgain = JSON.parse(await readFile(strategiesPath, "utf8"));
assert.equal(Object.keys(sidecarAgain).length, 1);

await rm(dir, { recursive: true, force: true });

console.log("connector-label-store OK");
