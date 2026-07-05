import assert from "node:assert/strict";
import {
  fullImageSrc,
  remoteAssetBase,
} from "../src/components/routes/fullImageSrc.js";

const item = {
  photo: "public-data/poi-images/poi-aaa.webp",
  thumbnail: "public-data/poi-images/poi-aaa-thumb.webp",
};

// No window at all (node) → local thumbnail resolution.
assert.equal(remoteAssetBase(), "");
assert.equal(fullImageSrc(item), "/public-data/poi-images/poi-aaa-thumb.webp");

// Window without the global (public website / flag off) → still local thumb.
globalThis.window = {};
assert.equal(fullImageSrc(item), "/public-data/poi-images/poi-aaa-thumb.webp");

// Global set (app webroot with remote images enabled) → remote full photo.
globalThis.window = {
  CYCLEWAYS_REMOTE_ASSET_BASE: "https://www.cycleways.app/",
};
assert.equal(remoteAssetBase(), "https://www.cycleways.app");
assert.equal(
  fullImageSrc(item),
  "https://www.cycleways.app/public-data/poi-images/poi-aaa.webp",
);

// Absolute photo URLs pass through untouched even with a remote base, even when
// a thumbnail exists.
assert.equal(
  fullImageSrc({
    photo: "https://example.com/x.jpg",
    thumbnail: "public-data/poi-images/poi-aaa-thumb.webp",
  }),
  "https://example.com/x.jpg",
);

// No thumbnail, no remote base → local full photo (website lightbox case).
globalThis.window = {};
assert.equal(
  fullImageSrc({ photo: "public-data/poi-images/poi-aaa.webp", thumbnail: "" }),
  "/public-data/poi-images/poi-aaa.webp",
);

// Empty item → empty string.
assert.equal(fullImageSrc({}), "");
assert.equal(fullImageSrc(null), "");

delete globalThis.window;
console.log("test-full-image-src: OK");

