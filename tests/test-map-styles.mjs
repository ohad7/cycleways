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

// All layer/source IDs live in mapStyles — including the featured video cursor
// IDs that are shared by MapSurface and mapLayers.
assert.equal(typeof styles.VIDEO_CURSOR_SOURCE_ID, "string");
assert.equal(typeof styles.VIDEO_CURSOR_TRAIL_SOURCE_ID, "string");
assert.equal(typeof styles.VIDEO_CURSOR_PROGRESS_SOURCE_ID, "string");
assert.equal(typeof styles.VIDEO_CURSOR_LAYER_ID, "string");
assert.equal(typeof styles.VIDEO_CURSOR_SYMBOL_LAYER_ID, "string");
assert.equal(typeof styles.VIDEO_CURSOR_STYLE, "object");
assert.equal(typeof styles.VIDEO_CURSOR_SYMBOL_STYLE, "object");
assert.equal(typeof styles.VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD, "string");
assert.equal(typeof styles.VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD_PULSE, "string");

// At least one extracted style spec is exported as plain, serializable data.
const styleKeys = Object.keys(styles).filter((k) => k.endsWith("_STYLE"));
assert.ok(styleKeys.length > 0, "at least one *_STYLE spec is exported");
const sampleSpec = styles[styleKeys[0]];
assert.ok(sampleSpec && typeof sampleSpec === "object", "style spec is an object");
assert.doesNotThrow(() => JSON.parse(JSON.stringify(sampleSpec)), "style spec is pure data");

// Regression: data markers must NOT use a Mapbox `text-field` to render emoji.
// Mapbox GL JS only supports glyph code points <= 65535; most POI emoji are in
// the astral plane (> U+FFFF) and throw "glyphs > 65535 not supported", which
// aborts the symbol layer and blanks the whole map. Emoji are rendered via
// icon-image (rasterized images) instead.
assert.ok(
  styles.DATA_MARKERS_STYLE && styles.DATA_MARKERS_STYLE.layout,
  "DATA_MARKERS_STYLE has a layout",
);
assert.ok(
  !("text-field" in styles.DATA_MARKERS_STYLE.layout),
  "DATA_MARKERS_STYLE.layout must not use text-field (astral emoji glyphs crash Mapbox)",
);
assert.ok(
  "icon-image" in styles.DATA_MARKERS_STYLE.layout,
  "DATA_MARKERS_STYLE.layout renders markers via icon-image",
);

console.log("test-map-styles OK");
