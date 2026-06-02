import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  sanitizePoiImageId,
  processPoiImage,
  findMissingSourceImages,
} from "../editor/server.mjs";

// --- sanitizePoiImageId ---

assert.equal(sanitizePoiImageId("Beit Hillel Cafe"), "beit-hillel-cafe");
assert.equal(sanitizePoiImageId("café/../../etc"), "caf-etc");
assert.equal(sanitizePoiImageId("  trailing--dashes--  "), "trailing-dashes");
assert.throws(() => sanitizePoiImageId(""), /id/i);
assert.throws(() => sanitizePoiImageId("!!!"), /id/i);

console.log("sanitizePoiImageId tests passed");

// --- processPoiImage: resize + webp conversion ---

const workDir = await mkdtemp(join(tmpdir(), "poi-image-test-"));
try {
  // A large source image, similar to a 7MB phone photo.
  const sourceBuffer = await sharp({
    create: {
      width: 3000,
      height: 2000,
      channels: 3,
      background: { r: 120, g: 200, b: 90 },
    },
  })
    .png()
    .toBuffer();

  const result = await processPoiImage(
    { id: "Beit Hillel Viewpoint", buffer: sourceBuffer },
    { outputDir: workDir, publicPath: "public-data/poi-images" },
  );

  // Filenames are <sanitized-id>-<8 hex>.webp (+ -thumb) for collision-free multi-upload.
  const photoRe = /^public-data\/poi-images\/beit-hillel-viewpoint-[0-9a-f]{8}\.webp$/;
  const thumbRe = /^public-data\/poi-images\/beit-hillel-viewpoint-[0-9a-f]{8}-thumb\.webp$/;
  assert.match(result.photo, photoRe);
  assert.match(result.thumbnail, thumbRe);

  // Same bytes + id are idempotent (same hash, same filename).
  const again = await processPoiImage(
    { id: "Beit Hillel Viewpoint", buffer: sourceBuffer },
    { outputDir: workDir, publicPath: "public-data/poi-images" },
  );
  assert.equal(again.photo, result.photo);

  const photoBuffer = await readFile(
    join(workDir, result.photo.split("/").pop()),
  );
  const thumbBuffer = await readFile(
    join(workDir, result.thumbnail.split("/").pop()),
  );

  const photoMeta = await sharp(photoBuffer).metadata();
  const thumbMeta = await sharp(thumbBuffer).metadata();

  // Both derivatives are webp.
  assert.equal(photoMeta.format, "webp");
  assert.equal(thumbMeta.format, "webp");

  // The photo is downscaled (never wider than the cap) and the thumbnail is
  // smaller still, so committed images stay small.
  assert.ok(photoMeta.width <= 1600, `photo width ${photoMeta.width} <= 1600`);
  assert.ok(thumbMeta.width <= 480, `thumb width ${thumbMeta.width} <= 480`);
  assert.ok(thumbMeta.width < photoMeta.width);
  assert.ok(thumbBuffer.length < photoBuffer.length);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

console.log("processPoiImage tests passed");

// --- findMissingSourceImages: pre-promote existence check ---

const repoDir = await mkdtemp(join(tmpdir(), "poi-promote-test-"));
try {
  await mkdir(join(repoDir, "public-data/poi-images"), { recursive: true });
  await writeFile(join(repoDir, "public-data/poi-images/present.webp"), "x");

  const source = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          name: "Seg A",
          data: [
            {
              type: "cafe",
              id: "present",
              photo: "public-data/poi-images/present.webp",
              thumbnail: "/public-data/poi-images/present.webp",
            },
            {
              type: "viewpoint",
              id: "remote",
              photo: "https://cdn.example.com/x.webp",
            },
          ],
        },
        geometry: { type: "LineString", coordinates: [[35, 33], [35.1, 33.1]] },
      },
    ],
  };

  // All local references resolve; remote URLs are skipped.
  assert.deepEqual(await findMissingSourceImages(source, repoDir), []);

  // A missing local reference is reported.
  source.features[0].properties.data.push({
    type: "nature",
    id: "gone",
    photo: "public-data/poi-images/missing.webp",
  });
  const missing = await findMissingSourceImages(source, repoDir);
  assert.equal(missing.length, 1);
  assert.match(missing[0], /missing\.webp/);
} finally {
  await rm(repoDir, { recursive: true, force: true });
}

console.log("findMissingSourceImages tests passed");

console.log("editor POI image tests passed");
