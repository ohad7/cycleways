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

console.log("video keyframes promote tests passed");
