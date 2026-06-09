import assert from "node:assert/strict";
import { segmentPreviewImage } from "../src/components/segmentPreviewImage.js";

// no / empty data points -> ""
assert.equal(segmentPreviewImage(null), "");
assert.equal(segmentPreviewImage({}), "");
assert.equal(segmentPreviewImage({ dataPoints: [] }), "");

// data points but none with images -> ""
assert.equal(
  segmentPreviewImage({ dataPoints: [{ type: "gate" }, { type: "mud" }] }),
  "",
);

// first data point that has an image wins; bare public-data path gets a leading slash
assert.equal(
  segmentPreviewImage({
    dataPoints: [
      { type: "gate" },
      { type: "cafe", images: [{ photo: "public-data/poi-images/a.webp" }] },
      { type: "spring", images: [{ photo: "public-data/poi-images/b.webp" }] },
    ],
  }),
  "/public-data/poi-images/a.webp",
);

// thumbnail is preferred over photo when present
assert.equal(
  segmentPreviewImage({
    dataPoints: [
      { type: "cafe", images: [{ photo: "a.webp", thumbnail: "a-t.webp" }] },
    ],
  }),
  "/a-t.webp",
);

// already-rooted / absolute URLs pass through unchanged (legacy photo field)
assert.equal(
  segmentPreviewImage({ dataPoints: [{ type: "cafe", photo: "/images/x.png" }] }),
  "/images/x.png",
);

console.log("segmentPreviewImage tests passed");
