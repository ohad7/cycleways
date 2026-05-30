import assert from "node:assert/strict";
import * as styles from "@cycleways/core/map/mapStyles.js";
import { ROUTE_NETWORK_LINE_LAYER_ID } from "../src/map/mapLayers.js";

// IDs live in mapStyles and are re-exported by mapLayers (back-compat).
assert.equal(typeof styles.ROUTE_NETWORK_LINE_LAYER_ID, "string");
assert.equal(
  styles.ROUTE_NETWORK_LINE_LAYER_ID,
  ROUTE_NETWORK_LINE_LAYER_ID,
  "mapLayers re-exports the same ID value as mapStyles",
);

// All layer/source IDs live in mapStyles — including the video-cursor IDs
// that were previously private to mapLayers.
assert.equal(typeof styles.VIDEO_CURSOR_SOURCE_ID, "string");
assert.equal(typeof styles.VIDEO_CURSOR_LAYER_ID, "string");

// At least one extracted style spec is exported as plain, serializable data.
const styleKeys = Object.keys(styles).filter((k) => k.endsWith("_STYLE"));
assert.ok(styleKeys.length > 0, "at least one *_STYLE spec is exported");
const sampleSpec = styles[styleKeys[0]];
assert.ok(sampleSpec && typeof sampleSpec === "object", "style spec is an object");
assert.doesNotThrow(() => JSON.parse(JSON.stringify(sampleSpec)), "style spec is pure data");

console.log("test-map-styles OK");
