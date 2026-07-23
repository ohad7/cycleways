import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const artifact = JSON.parse(
  await readFile(resolve(root, "data/navigation-way-suggestions.json"), "utf8"),
);

assert.equal(artifact.schemaVersion, 1);
assert.equal(artifact.groups.length, artifact.summary.groupCount);
assert.ok(
  artifact.summary.sourceGroupCount > artifact.summary.groupCount,
  "evidence components should be consolidated into conceptual way proposals",
);

const ids = [];
const namedWayIds = [];
for (const group of artifact.groups) {
  assert.ok(["named-way", "standalone", "unnamed"].includes(group.role));
  assert.ok(Array.isArray(group.segmentIds) && group.segmentIds.length > 0);
  assert.ok(group.segmentIds.every(Number.isSafeInteger));
  assert.ok(group.kind);
  assert.ok(group.confidence);
  if (group.role === "named-way") {
    assert.ok(group.wayId);
    assert.ok(group.name);
    namedWayIds.push(group.wayId);
  } else if (group.role === "standalone") {
    assert.ok(group.name);
  }
  if (group.name) {
    assert.doesNotMatch(
      group.name,
      /[\u0591-\u05BD\u05BF-\u05C7]/u,
      `display name must not contain Hebrew pronunciation marks: ${group.id}`,
    );
  }
  ids.push(...group.segmentIds);
}

assert.equal(ids.length, artifact.summary.segmentCount);
assert.equal(new Set(ids).size, ids.length, "a segment appears in at most one suggestion group");
assert.equal(
  new Set(namedWayIds).size,
  namedWayIds.length,
  "one conceptual way appears in at most one suggestion group",
);

const road90 = artifact.groups.find((group) => group.wayId === "road-90");
assert.deepEqual(road90.segmentIds, [48, 172, 173]);
assert.equal(road90.conceptualWayConsolidation, true);
assert.equal(road90.sourceProposalIds.length, 2);

for (const wayId of [
  "road-918",
  "road-959",
  "road-99",
  "cycleway-9779",
  "cycleway-99",
]) {
  const group = artifact.groups.find((candidate) => candidate.wayId === wayId);
  assert.ok(group?.sourceProposalIds?.length > 1, `${wayId} components are not consolidated`);
}

const actualBoundFiles = {};
const records = [];
for (const [relativePath, expectedDigest] of Object.entries(artifact.boundFiles)) {
  const content = await readFile(resolve(root, relativePath));
  const actualDigest = createHash("sha256").update(content).digest("hex");
  actualBoundFiles[relativePath] = actualDigest;
  records.push(`${relativePath}\0${actualDigest}\n`);
  assert.equal(actualDigest, expectedDigest, `${relativePath} suggestion binding is stale`);
}
const evidenceSetDigest = `sha256:${createHash("sha256")
  .update(records.join(""))
  .digest("hex")}`;
assert.equal(evidenceSetDigest, artifact.evidenceSetDigest);

console.log(
  `navigation-way suggestions: ${artifact.summary.groupCount} groups, `
  + `${artifact.summary.segmentCount} unique segments, binding current`,
);
