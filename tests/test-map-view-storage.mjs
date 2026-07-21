import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MAP_VIEW_MAX_AGE_MS,
  parseStoredMapView,
  serializeMapView,
} from "../editor/lib/map-view-storage.mjs";

const now = Date.UTC(2026, 6, 21, 12);

const editorSource = await readFile(
  new URL("../editor/editor.js", import.meta.url),
  "utf8",
);

test("restores a valid map view saved less than a day ago", () => {
  const stored = JSON.stringify({
    center: [35.5, 33.2],
    zoom: 16.25,
    updatedAt: now - MAP_VIEW_MAX_AGE_MS + 1,
  });

  assert.deepEqual(parseStoredMapView(stored, { now }), {
    center: [35.5, 33.2],
    zoom: 16.25,
  });
});

test("ignores a map view saved more than a day ago", () => {
  const stored = JSON.stringify({
    center: [35.5, 33.2],
    zoom: 16.25,
    updatedAt: now - MAP_VIEW_MAX_AGE_MS - 1,
  });

  assert.equal(parseStoredMapView(stored, { now }), null);
});

test("ignores malformed and invalid map views", () => {
  assert.equal(parseStoredMapView("not json", { now }), null);
  assert.equal(
    parseStoredMapView(
      JSON.stringify({ center: [200, 33.2], zoom: 16, updatedAt: now }),
      { now },
    ),
    null,
  );
  assert.equal(
    parseStoredMapView(
      JSON.stringify({ center: [35.5, 33.2], zoom: 25, updatedAt: now }),
      { now },
    ),
    null,
  );
});

test("serializes Mapbox center objects", () => {
  const stored = serializeMapView({
    center: { lng: 35.6, lat: 33.1 },
    zoom: 14.5,
    updatedAt: now,
  });

  assert.deepEqual(JSON.parse(stored), {
    center: [35.6, 33.1],
    zoom: 14.5,
    updatedAt: now,
  });
});

test("editor restores the saved view and persists completed map movements", () => {
  assert.match(editorSource, /const initialMapView = storedMapView\(\) \|\| DEFAULT_MAP_VIEW/);
  assert.match(editorSource, /center: initialMapView\.center/);
  assert.match(editorSource, /zoom: initialMapView\.zoom/);
  assert.match(editorSource, /map\.on\("moveend", \(\) => persistMapView\(map\)\)/);
});
