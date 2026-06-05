import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  validateKeyframesDraft,
} from "../editor/server.mjs";

const validDraft = {
  version: 1,
  youtubeId: "dQw4w9WgXcQ",
  videoDuration: 10,
  keyframes: [
    { t: 0, lat: 33.0, lon: 35.0 },
    { t: 10, lat: 33.0, lon: 35.002 },
  ],
};

const routePolyline = [
  { lat: 33.0, lng: 35.0 },
  { lat: 33.0, lng: 35.002 },
];

// Happy path
assert.doesNotThrow(() =>
  validateKeyframesDraft(validDraft, routePolyline),
);

assert.doesNotThrow(() =>
  validateKeyframesDraft(
    { ...validDraft, playbackBehavior: "none" },
    routePolyline,
  ),
);

assert.throws(
  () =>
    validateKeyframesDraft(
      { ...validDraft, playbackBehavior: "fast" },
      routePolyline,
    ),
  /playbackBehavior/,
);

// Wrong videoDuration
assert.throws(
  () =>
    validateKeyframesDraft(
      { ...validDraft, videoDuration: 9 },
      routePolyline,
    ),
  /videoDuration/,
);

// Unsorted keyframes
assert.throws(
  () =>
    validateKeyframesDraft(
      {
        ...validDraft,
        keyframes: [
          { t: 10, lat: 33.0, lon: 35.002 },
          { t: 0, lat: 33.0, lon: 35.0 },
        ],
      },
      routePolyline,
    ),
  /sorted/i,
);

// Keyframe coordinate too far from route
assert.throws(
  () =>
    validateKeyframesDraft(
      {
        ...validDraft,
        keyframes: [
          { t: 0, lat: 34.0, lon: 36.0 },  // very far
          { t: 10, lat: 33.0, lon: 35.002 },
        ],
      },
      routePolyline,
    ),
  /too far from route/i,
);

// promoteKeyframesDraft writes the canonical files and removes the draft
import { promoteKeyframesDraft } from "../editor/server.mjs";

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rv-promote-"));
const draftsDir = path.join(tmpRoot, "drafts");
const publicDir = path.join(tmpRoot, "public");
await fs.mkdir(draftsDir, { recursive: true });
await fs.mkdir(publicDir, { recursive: true });

await fs.writeFile(
  path.join(draftsDir, "test-slug.json"),
  JSON.stringify({ ...validDraft, playbackBehavior: "none" }),
);

const result = await promoteKeyframesDraft({
  slug: "test-slug",
  draftsDir,
  publicDir,
  routePolyline,
});

assert.ok(result.ok);
const promoted = JSON.parse(
  await fs.readFile(path.join(publicDir, "test-slug.json"), "utf8"),
);
assert.equal(promoted.playbackBehavior, "none");
const index = JSON.parse(
  await fs.readFile(path.join(publicDir, "index.json"), "utf8"),
);
assert.equal(index.routes["test-slug"], "test-slug.json");
// Draft removed
await assert.rejects(fs.stat(path.join(draftsDir, "test-slug.json")));

await assert.rejects(
  promoteKeyframesDraft({
    slug: "missing-draft",
    draftsDir,
    publicDir,
    routePolyline,
  }),
  /Save draft before promoting/i,
);

console.log("video keyframes promote tests passed");
