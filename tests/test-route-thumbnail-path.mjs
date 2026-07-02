import assert from "node:assert/strict";
import { routeThumbnailPath } from "@cycleways/core/data/catalog.js";

// Prefers an explicit hero thumbnail.
assert.equal(
  routeThumbnailPath({
    heroImage: { thumbnail: "public-data/poi-images/hero-thumb.webp", photo: "x" },
  }),
  "public-data/poi-images/hero-thumb.webp",
);

// Falls back to the start POI image (the סובב בית הלל case: no heroImage but a
// real start photo) — matching the web Discover card's routeDisplayImage chain.
assert.equal(
  routeThumbnailPath({
    name: "סובב בית הלל",
    start: {
      name: "חניון כניסה בית הלל",
      images: [
        {
          photo: "public-data/poi-images/sovev-beit-hillel-start-88a84776.webp",
          thumbnail:
            "public-data/poi-images/sovev-beit-hillel-start-88a84776-thumb.webp",
        },
      ],
    },
  }),
  "public-data/poi-images/sovev-beit-hillel-start-88a84776-thumb.webp",
);

// Nothing to show -> null (icon fallback).
assert.equal(routeThumbnailPath({ name: "no images" }), null);

console.log("route thumbnail path tests passed");
