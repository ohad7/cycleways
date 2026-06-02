# POI Editor Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support multiple images per POI, replace hand-typed image paths with a managed (upload-only) editor list, declutter the segment panel (pinned ID/Name, collapsed Quality), and render a meaningful emoji marker per POI type.

**Architecture:** Introduce an `images[]` contract on data markers with a shared `normalizePoiImages` helper that also reads legacy `photo`/`thumbnail`, so old data keeps working. The editor uploads append hash-named WebP derivatives; the featured gallery flattens every image into its own route-ordered carousel slide; map markers render the type emoji on the type-colored circle (warnings keep SVG icons).

**Tech Stack:** Node (editor server, `sharp`), vanilla JS editor client, React featured components, Mapbox GL style expressions, plain `node:assert` test scripts run via `npm test`, Playwright E2E.

**Reference spec:** `plans/poi-editor-refinements/design.md`

---

## File Structure

- `packages/core/src/data/poiTypes.js` (Modify) — add `normalizePoiImages`, `primaryPoiImage`, `galleryImageSlides`; update `isGalleryEligiblePoi`.
- `packages/core/src/data/dataMarkers.js` (Modify) — emit primary `photo`/`thumbnail` + `emoji`/`color` from normalized images.
- `packages/core/src/map/mapStyles.js` (Modify) — add `DATA_MARKERS_CIRCLE_STYLE`; add emoji `text-field` to `DATA_MARKERS_STYLE`.
- `src/map/mapLayers.product.js` (Modify) — add the circle layer + clear it in `syncDataMarkerLayers`.
- `editor/editor.js` (Modify) — emoji symbol layout; managed image list (replaces path text fields); multi-file upload; sticky header wiring.
- `editor/index.html` (Modify) — sticky ID/Name header; wrap Quality in `<details>`.
- `editor/styles.css` (Modify) — sticky header, image list, collapsed quality styles.
- `editor/server.mjs` (Modify) — hash-named filenames in `processPoiImage`; `images[]` in `validateSourceGeojson` and `findMissingSourceImages`.
- `src/components/featured/RoutePoiGallery.jsx` (Modify) — render flattened image slides.
- `data/map-source.geojson` + `public-data/segments.json` (Modify) — migrate the 4 seeded POIs to `images[]`.
- Tests: `tests/test-poi-types.mjs`, `tests/test-data-markers.mjs`, `tests/test-editor-poi-validation.mjs`, `tests/test-editor-poi-images.mjs`, `tests/e2e/featured-route-layout.spec.mjs`.

Run all Node unit tests at any point with: `npm test` (Python + Node). For a fast loop, run a single file, e.g. `node tests/test-poi-types.mjs`.

---

## Task 1: `normalizePoiImages` + primary image helper

**Files:**
- Modify: `packages/core/src/data/poiTypes.js`
- Test: `tests/test-poi-types.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/test-poi-types.mjs` (before the final `console.log`):

```js
import {
  normalizePoiImages,
  primaryPoiImage,
} from "@cycleways/core/data/poiTypes.js";

// images[] passthrough, filtering invalid entries
assert.deepEqual(
  normalizePoiImages({
    images: [
      { photo: "a.webp", thumbnail: "a-thumb.webp" },
      { photo: "b.webp" },
      { thumbnail: "no-photo.webp" }, // dropped: no photo
      "nope", // dropped: not an object
    ],
  }),
  [
    { photo: "a.webp", thumbnail: "a-thumb.webp" },
    { photo: "b.webp", thumbnail: "b.webp" },
  ],
);

// legacy photo/thumbnail synthesized into a single entry
assert.deepEqual(normalizePoiImages({ photo: "c.webp", thumbnail: "c-t.webp" }), [
  { photo: "c.webp", thumbnail: "c-t.webp" },
]);
assert.deepEqual(normalizePoiImages({ photo: "d.webp" }), [
  { photo: "d.webp", thumbnail: "d.webp" },
]);

// nothing -> empty
assert.deepEqual(normalizePoiImages({ type: "warning" }), []);
assert.deepEqual(normalizePoiImages(null), []);

// primaryPoiImage returns images[0] or null
assert.deepEqual(primaryPoiImage({ photo: "c.webp" }), {
  photo: "c.webp",
  thumbnail: "c.webp",
});
assert.equal(primaryPoiImage({ type: "gate" }), null);

console.log("normalizePoiImages tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-poi-types.mjs`
Expected: FAIL — `does not provide an export named 'normalizePoiImages'`.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/core/src/data/poiTypes.js`:

```js
function imageEntry(photo, thumbnail) {
  const p = typeof photo === "string" ? photo.trim() : "";
  if (!p) return null;
  const t = typeof thumbnail === "string" && thumbnail.trim() ? thumbnail.trim() : p;
  return { photo: p, thumbnail: t };
}

// Normalize a data marker's images to an array of { photo, thumbnail }.
// Prefers marker.images; falls back to legacy photo/thumbnail; else [].
export function normalizePoiImages(marker) {
  if (!marker || typeof marker !== "object") return [];
  if (Array.isArray(marker.images) && marker.images.length > 0) {
    return marker.images
      .map((entry) =>
        entry && typeof entry === "object"
          ? imageEntry(entry.photo, entry.thumbnail)
          : null,
      )
      .filter(Boolean);
  }
  const legacy = imageEntry(marker.photo, marker.thumbnail);
  return legacy ? [legacy] : [];
}

export function primaryPoiImage(marker) {
  const images = normalizePoiImages(marker);
  return images.length > 0 ? images[0] : null;
}
```

- [ ] **Step 4: Update `isGalleryEligiblePoi` to use normalized images**

Replace the existing `isGalleryEligiblePoi` in `packages/core/src/data/poiTypes.js`:

```js
export function isGalleryEligiblePoi(point) {
  if (!point || isWarningType(point.type)) return false;
  if (point.gallery === false) return false;
  return normalizePoiImages(point).length > 0;
}
```

(Define `normalizePoiImages` above this function, or hoist via `function` declaration — the `export function` form is hoisted, so order is fine.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `node tests/test-poi-types.mjs`
Expected: PASS — ends with `normalizePoiImages tests passed` and `POI types tests passed`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/data/poiTypes.js tests/test-poi-types.mjs
git commit -m "feat(poi): add normalizePoiImages and primary image helper"
```

---

## Task 2: `galleryImageSlides` — flatten images for the carousel

**Files:**
- Modify: `packages/core/src/data/poiTypes.js`
- Test: `tests/test-poi-types.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/test-poi-types.mjs`:

```js
import { galleryImageSlides } from "@cycleways/core/data/poiTypes.js";

const points = [
  {
    id: "mid",
    type: "cafe",
    name: "Mid cafe",
    information: "info",
    description: "desc",
    routeProgressMeters: 500,
    images: [
      { photo: "mid-1.webp", thumbnail: "mid-1-t.webp" },
      { photo: "mid-2.webp", thumbnail: "mid-2-t.webp" },
    ],
  },
  {
    id: "start",
    type: "viewpoint",
    name: "Start view",
    routeProgressMeters: 10,
    photo: "start.webp", // legacy single image
  },
  { id: "warn", type: "gate", routeProgressMeters: 5 }, // not gallery eligible
  { id: "nogal", type: "cafe", gallery: false, routeProgressMeters: 1, photo: "x.webp" },
];

const slides = galleryImageSlides(points);

// Order: start (10), then mid image 1, then mid image 2. Warnings + gallery:false dropped.
assert.deepEqual(
  slides.map((s) => `${s.poiId}#${s.imageIndex}`),
  ["start#0", "mid#0", "mid#1"],
);

// Each slide carries presentation fields + its image.
assert.equal(slides[0].photo, "start.webp");
assert.equal(slides[0].thumbnail, "start.webp");
assert.equal(slides[0].name, "Start view");
assert.equal(slides[1].photo, "mid-1.webp");
assert.equal(slides[1].poiId, "mid");

console.log("galleryImageSlides tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-poi-types.mjs`
Expected: FAIL — `does not provide an export named 'galleryImageSlides'`.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/core/src/data/poiTypes.js`:

```js
// Flatten gallery-eligible POIs into one slide per image, ordered by the POI's
// route progress and then by image index. Stable POI id breaks progress ties.
export function galleryImageSlides(points) {
  const eligible = (Array.isArray(points) ? points : [])
    .filter(isGalleryEligiblePoi)
    .map((point) => ({ point, images: normalizePoiImages(point) }));

  eligible.sort((a, b) => {
    const ap = Number.isFinite(a.point.routeProgressMeters)
      ? a.point.routeProgressMeters
      : Number.POSITIVE_INFINITY;
    const bp = Number.isFinite(b.point.routeProgressMeters)
      ? b.point.routeProgressMeters
      : Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;
    return String(a.point.id || "").localeCompare(String(b.point.id || ""));
  });

  const slides = [];
  for (const { point, images } of eligible) {
    images.forEach((image, imageIndex) => {
      slides.push({
        poiId: point.id,
        type: point.type,
        name: point.name || "",
        information: point.information || "",
        description: point.description || "",
        location: point.location,
        routeProgressMeters: point.routeProgressMeters,
        imageIndex,
        photo: image.photo,
        thumbnail: image.thumbnail,
      });
    });
  }
  return slides;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/test-poi-types.mjs`
Expected: PASS — ends with `galleryImageSlides tests passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/data/poiTypes.js tests/test-poi-types.mjs
git commit -m "feat(poi): add galleryImageSlides flatten+order helper"
```

---

## Task 3: Data marker features emit the primary image

**Files:**
- Modify: `packages/core/src/data/dataMarkers.js`
- Test: `tests/test-data-markers.mjs`

- [ ] **Step 1: Write the failing test**

Add to `tests/test-data-markers.mjs` a segment whose marker uses `images[]`, and assert the emitted feature exposes the primary photo/thumbnail. Append before the final pass log:

```js
{
  const features = dataMarkerFeaturesFromSegments({
    "Seg images": {
      data: [
        {
          id: "multi",
          type: "cafe",
          name: "Multi cafe",
          location: [33.1, 35.6],
          images: [
            { photo: "a.webp", thumbnail: "a-t.webp" },
            { photo: "b.webp", thumbnail: "b-t.webp" },
          ],
        },
      ],
    },
  });
  const f = features.find((feat) => feat.properties.dataPointId === "multi");
  assert.equal(f.properties.photo, "a.webp");
  assert.equal(f.properties.thumbnail, "a-t.webp");
  assert.equal(f.properties.emoji, "☕");
}
console.log("data-marker images tests passed");
```

(If `dataMarkerFeaturesFromSegments` / `assert` are not yet imported in this file, reuse the existing imports at its top — check the file head before adding.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-data-markers.mjs`
Expected: FAIL — `f.properties.photo` is `""` (legacy fields only) so it won't equal `"a.webp"`.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/data/dataMarkers.js`, import the helper and emit the primary image. Update the import line and the `properties` block:

```js
import { poiColor, poiEmoji, poiIcon, poiLabel, primaryPoiImage } from "./poiTypes.js";
```

Inside `dataMarkerFeaturesFromSegments`, before building `properties`, add:

```js
      const primary = primaryPoiImage(dataPoint);
```

and set the photo/thumbnail props from it:

```js
          photo: primary?.photo || "",
          thumbnail: primary?.thumbnail || dataPoint.thumbnail || "",
```

(Leave `name`, `description`, `gallery`, `emoji`, `label`, `color`, `icon` as-is.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/test-data-markers.mjs`
Expected: PASS — ends with `data-marker images tests passed` and `test-data-markers passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/data/dataMarkers.js tests/test-data-markers.mjs
git commit -m "feat(poi): emit primary image on data marker features"
```

---

## Task 4: Server — hash-named image derivatives

**Files:**
- Modify: `editor/server.mjs`
- Test: `tests/test-editor-poi-images.mjs`

- [ ] **Step 1: Write the failing test**

In `tests/test-editor-poi-images.mjs`, replace the exact-filename assertions in the `processPoiImage` block with hash-name assertions, and add an idempotency check. Replace:

```js
  assert.equal(result.photo, "public-data/poi-images/beit-hillel-viewpoint.webp");
  assert.equal(
    result.thumbnail,
    "public-data/poi-images/beit-hillel-viewpoint-thumb.webp",
  );

  const photoBuffer = await readFile(join(workDir, "beit-hillel-viewpoint.webp"));
  const thumbBuffer = await readFile(
    join(workDir, "beit-hillel-viewpoint-thumb.webp"),
  );
```

with:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-editor-poi-images.mjs`
Expected: FAIL — current code produces `beit-hillel-viewpoint.webp` (no hash), so `assert.match` fails.

- [ ] **Step 3: Write minimal implementation**

In `editor/server.mjs`, `processPoiImage` already imports `createHash` (top of file). Compute a content hash and fold it into the filenames. Replace the `safeId`/filename section of `processPoiImage`:

```js
  const safeId = sanitizePoiImageId(id);
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 8);
  const baseName = `${safeId}-${hash}`;
  const outputDir = options.outputDir || poiImagesDir;
  const publicPath = options.publicPath || POI_IMAGE_PUBLIC_PATH;
  await mkdir(outputDir, { recursive: true });
```

Then use `baseName` for the writes and return values:

```js
  await writeFile(join(outputDir, `${baseName}.webp`), photoBuffer);
  await writeFile(join(outputDir, `${baseName}-thumb.webp`), thumbBuffer);

  return {
    photo: `${publicPath}/${baseName}.webp`,
    thumbnail: `${publicPath}/${baseName}-thumb.webp`,
    bytes: { photo: photoBuffer.length, thumbnail: thumbBuffer.length },
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-editor-poi-images.mjs`
Expected: PASS — `processPoiImage tests passed`.

- [ ] **Step 5: Commit**

```bash
git add editor/server.mjs tests/test-editor-poi-images.mjs
git commit -m "feat(editor): hash-name POI image derivatives for multi-upload"
```

---

## Task 5: Server — validate and existence-check `images[]`

**Files:**
- Modify: `editor/server.mjs`
- Test: `tests/test-editor-poi-validation.mjs`, `tests/test-editor-poi-images.mjs`

- [ ] **Step 1: Write the failing validation test**

Append to `tests/test-editor-poi-validation.mjs` (before the final `console.log`):

```js
// images[] is accepted when shaped correctly
validateSourceGeojson(
  sourceWithMarker({
    type: "cafe",
    id: "segment-cafe-multi",
    name: "Segment cafe",
    images: [
      { photo: "/attached_assets/background.png", thumbnail: "/attached_assets/background.png" },
      { photo: "/attached_assets/background_grass.png" },
    ],
    location: [33.105, 35.605],
  }),
);

// images entries must have a string photo
assert.throws(
  () =>
    validateSourceGeojson(
      sourceWithMarker({
        type: "cafe",
        id: "bad-images",
        name: "Bad",
        images: [{ thumbnail: "/attached_assets/background.png" }],
        location: [33.105, 35.605],
      }),
    ),
  /image/i,
);

// a gallery POI with empty images[] and no legacy photo is rejected (no image)
assert.throws(
  () =>
    validateSourceGeojson(
      sourceWithMarker({
        type: "viewpoint",
        id: "empty-images",
        name: "Empty",
        gallery: true,
        images: [],
        location: [33.105, 35.605],
      }),
    ),
  /no image/,
);

console.log("editor POI images[] validation tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-editor-poi-validation.mjs`
Expected: FAIL — `images` is currently ignored, so the malformed-images case does not throw.

- [ ] **Step 3: Write minimal implementation — validation**

In `editor/server.mjs`, update `hasGalleryImage` and the marker validation loop in `validateSourceGeojson`.

Replace `hasGalleryImage`:

```js
function markerImages(marker) {
  if (Array.isArray(marker?.images)) return marker.images;
  if (hasText(marker?.photo)) return [{ photo: marker.photo, thumbnail: marker.thumbnail }];
  return [];
}

function hasGalleryImage(marker) {
  if (Array.isArray(marker?.images)) {
    return marker.images.some((entry) => entry && hasText(entry.photo));
  }
  return hasText(marker.photo) || hasText(marker.thumbnail);
}
```

In the marker loop in `validateSourceGeojson`, after the existing `gallery` boolean check, add `images` shape validation:

```js
        if (marker.images !== undefined) {
          if (!Array.isArray(marker.images)) {
            throw new Error(`Feature ${name || index} data marker ${markerIndex} has non-array images`);
          }
          for (const [imageIndex, entry] of marker.images.entries()) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
              throw new Error(`Feature ${name || index} data marker ${markerIndex} image ${imageIndex} is invalid`);
            }
            if (!hasText(entry.photo)) {
              throw new Error(`Feature ${name || index} data marker ${markerIndex} image ${imageIndex} is missing a photo`);
            }
            if (entry.thumbnail !== undefined && typeof entry.thumbnail !== "string") {
              throw new Error(`Feature ${name || index} data marker ${markerIndex} image ${imageIndex} has invalid thumbnail`);
            }
          }
        }
```

The existing block `if (marker.gallery === true && !hasGalleryImage(marker))` now also covers `images: []` because `hasGalleryImage` returns false for it (yields the `no image` error).

- [ ] **Step 4: Run validation test to verify it passes**

Run: `node tests/test-editor-poi-validation.mjs`
Expected: PASS — `editor POI images[] validation tests passed`.

- [ ] **Step 5: Write the failing existence-check test**

In `tests/test-editor-poi-images.mjs`, extend the `findMissingSourceImages` block. After the existing `source` is created, also exercise `images[]`. Add before the final assertions:

```js
  // images[] entries are walked too.
  source.features[0].properties.data.push({
    type: "cafe",
    id: "with-images",
    images: [
      { photo: "public-data/poi-images/present.webp", thumbnail: "public-data/poi-images/present.webp" },
      { photo: "public-data/poi-images/also-missing.webp" },
    ],
  });
  const missingWithImages = await findMissingSourceImages(source, repoDir);
  assert.ok(missingWithImages.includes("public-data/poi-images/also-missing.webp"));
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node tests/test-editor-poi-images.mjs`
Expected: FAIL — `collectSourceImagePaths` only reads `photo`/`thumbnail`, so `also-missing.webp` is not detected.

- [ ] **Step 7: Write minimal implementation — collect images[]**

In `editor/server.mjs`, update `collectSourceImagePaths` to also walk `images[]`:

```js
function collectSourceImagePaths(source) {
  const paths = [];
  const features = Array.isArray(source?.features) ? source.features : [];
  for (const feature of features) {
    const data = feature?.properties?.data;
    if (!Array.isArray(data)) continue;
    for (const marker of data) {
      for (const field of ["photo", "thumbnail"]) {
        const value = marker?.[field];
        if (typeof value === "string" && value.trim() !== "") paths.push(value);
      }
      if (Array.isArray(marker?.images)) {
        for (const entry of marker.images) {
          for (const field of ["photo", "thumbnail"]) {
            const value = entry?.[field];
            if (typeof value === "string" && value.trim() !== "") paths.push(value);
          }
        }
      }
    }
  }
  return paths;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node tests/test-editor-poi-images.mjs`
Expected: PASS — all four `editor POI image*` lines print.

- [ ] **Step 9: Commit**

```bash
git add editor/server.mjs tests/test-editor-poi-validation.mjs tests/test-editor-poi-images.mjs
git commit -m "feat(editor): validate and existence-check POI images[]"
```

---

## Task 6: Featured gallery renders flattened image slides

**Files:**
- Modify: `src/components/featured/RoutePoiGallery.jsx`
- Test: `tests/e2e/featured-route-layout.spec.mjs` (extend), plus the unit coverage from Task 2.

- [ ] **Step 1: Update the component to use `galleryImageSlides`**

Replace the `items` derivation and selection logic in `src/components/featured/RoutePoiGallery.jsx`. Change the import:

```jsx
import { galleryImageSlides, poiLabel } from "@cycleways/core/data/poiTypes.js";
```

Replace the `items` `useMemo` (the old `.filter(isGalleryEligiblePoi).sort(byRouteProgress)`):

```jsx
  const items = useMemo(
    () => galleryImageSlides(routeState.activeDataPoints),
    [routeState.activeDataPoints],
  );
```

Each `item` is now a slide. Update `imageSrc` to read the slide directly:

```jsx
function imageSrc(item) {
  const src = item.thumbnail || item.photo || "";
  if (/^(https?:)?\/\//.test(src) || src.startsWith("/")) return src;
  return `/${src}`;
}
```

In the focus effect and `selectIndex`, match on the slide's `poiId` instead of `id`:

```jsx
  useEffect(() => {
    if (!focusedPoiId) return;
    const index = items.findIndex((item) => item.poiId === focusedPoiId);
    if (index >= 0) setSelectedIndex(index);
  }, [focusedPoiId, items]);
```

```jsx
  function selectIndex(index) {
    const next = items[index];
    if (!next) return;
    setSelectedIndex(index);
    setFocusedPoiId(next.poiId);
    if (Array.isArray(next.location) && next.location.length >= 2) {
      const [lat, lng] = next.location;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setFocusedCoord({ lat, lng });
      }
    }
  }
```

Update the dot `key`/`alt` and card `alt`/`img` to use the slide fields (`item.poiId + "-" + item.imageIndex` for `key`, `item.name`/`poiLabel(item.type)` for text). Remove the now-unused `byRouteProgress` function and the `isGalleryEligiblePoi` import.

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: `BUILD OK` (no unresolved import / unused-binding errors).

- [ ] **Step 3: Extend the desktop E2E to assert per-image slides**

In `tests/e2e/featured-route-layout.spec.mjs`, the desktop test currently asserts `.sbh-carousel-dots button` `toHaveCount(4)`. After Task 7 migrates the 4 seeded POIs (some with 2 images), update the count to the new total number of images. For now, change the hard count assertion to a range check so it survives seeding:

```js
    const dotCount = await page.locator(".sbh-carousel-dots button").count();
    expect(dotCount).toBeGreaterThanOrEqual(4);
```

- [ ] **Step 4: Run E2E**

Run: `npx playwright test tests/e2e/featured-route-layout.spec.mjs`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/featured/RoutePoiGallery.jsx tests/e2e/featured-route-layout.spec.mjs
git commit -m "feat(featured): render flattened per-image gallery slides"
```

---

## Task 7: Migrate seeded Beit Hillel POIs to `images[]`

**Files:**
- Modify: `data/map-source.geojson`
- Modify: `public-data/segments.json` (the promoted mirror; keep in sync so the featured page renders without a rebuild)

- [ ] **Step 1: Migrate each seeded POI**

In `data/map-source.geojson`, for each of the 4 POIs (`beit-hillel-village-stop`, `beit-hillel-hasbani-path`, `beit-hillel-west-fields`, `beit-hillel-north-fence`), replace the `"photo"`/`"thumbnail"` string pair with an `images` array. Example for the cafe:

```json
            "images": [
              {
                "photo": "/attached_assets/background.png",
                "thumbnail": "/attached_assets/background.png"
              }
            ],
```

Give at least one POI two images (so the flattened carousel is exercised), e.g. `beit-hillel-west-fields`:

```json
            "images": [
              { "photo": "/attached_assets/background_grass.png", "thumbnail": "/attached_assets/background_grass.png" },
              { "photo": "/attached_assets/background.png", "thumbnail": "/attached_assets/background.png" }
            ],
```

Remove the now-replaced `"photo"`/`"thumbnail"` keys from those markers. Keep `id`, `type`, `name`, `gallery`, `location`.

- [ ] **Step 2: Mirror the same change into `public-data/segments.json`**

Find the same 4 markers in `public-data/segments.json` and apply the identical `images[]` change so the live featured page reflects it without a full Build/Promote.

- [ ] **Step 3: Validate the source parses and passes validation**

Run:
```bash
node --input-type=module -e 'import {readFile} from "node:fs/promises"; import {validateSourceGeojson, findMissingSourceImages} from "./editor/server.mjs"; const s=JSON.parse(await readFile("data/map-source.geojson","utf-8")); validateSourceGeojson(s); console.log("valid; missing:", JSON.stringify(await findMissingSourceImages(s)));'
```
Expected: prints `valid; missing: []`.

- [ ] **Step 4: Confirm the gallery orders correctly**

Run: `npx playwright test tests/e2e/featured-route-layout.spec.mjs`
Expected: PASS; the desktop test's dot count is now ≥ 5 (4 POIs, one with 2 images).

- [ ] **Step 5: Commit**

```bash
git add data/map-source.geojson public-data/segments.json
git commit -m "chore(data): migrate seeded Beit Hillel POIs to images[]"
```

---

## Task 8: Emoji-on-circle markers — shared style + product map

**Files:**
- Modify: `packages/core/src/map/mapStyles.js`
- Modify: `src/map/mapLayers.product.js`

This is map-rendering code without unit assertions; verify in the browser. The testable feature properties (`emoji`, `color`, `icon`) are already emitted and covered by `tests/test-data-markers.mjs`.

- [ ] **Step 1: Add a circle style and emoji text to the shared marker style**

In `packages/core/src/map/mapStyles.js`, add a circle style above `DATA_MARKERS_STYLE` and a layer id near `DATA_MARKERS_LAYER_ID`:

```js
export const DATA_MARKERS_CIRCLE_LAYER_ID = "react-data-markers-circle";

export const DATA_MARKERS_CIRCLE_STYLE = {
  paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 6, 14, 9, 16, 12],
    "circle-color": ["coalesce", ["get", "color"], "#607076"],
    "circle-opacity": ["case", ["boolean", ["get", "active"], false], 0.95, 0.6],
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 1.5,
  },
};
```

Update `DATA_MARKERS_STYLE.layout` so warnings keep their SVG icon (blank emoji text) while POI types show their emoji. We cannot ask an expression whether an SVG image is actually loaded, so we blank the emoji text explicitly for the seven warning types (matching `POI_WARNING_PRIORITY`); every other type renders its emoji:

```js
export const DATA_MARKERS_STYLE = {
  layout: {
    "icon-image": ["get", "icon"],
    "icon-size": 1,
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
    "text-field": [
      "match",
      ["get", "type"],
      ["payment", "gate", "mud", "warning", "slope", "narrow", "severe"],
      "",
      ["coalesce", ["get", "emoji"], ""],
    ],
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": ["interpolate", ["linear"], ["zoom"], 10, 11, 16, 16],
    "text-allow-overlap": true,
    "text-ignore-placement": true,
  },
  paint: {
    "icon-opacity": ["case", ["boolean", ["get", "active"], false], 0.9, 0.45],
  },
};
```

- [ ] **Step 2: Add and clear the circle layer in the product map**

In `src/map/mapLayers.product.js`:

Import the new style/id alongside the existing imports from `@cycleways/core/map/mapStyles.js`:

```js
  DATA_MARKERS_CIRCLE_LAYER_ID,
  DATA_MARKERS_CIRCLE_STYLE,
```

In `syncDataMarkerLayers`, add the circle layer **before** the symbol layer so the emoji/icon sits on top:

```js
  if (!map.getLayer(DATA_MARKERS_CIRCLE_LAYER_ID)) {
    map.addLayer({
      id: DATA_MARKERS_CIRCLE_LAYER_ID,
      type: "circle",
      source: DATA_MARKERS_SOURCE_ID,
      ...DATA_MARKERS_CIRCLE_STYLE,
    });
  }
```

(Place this block immediately before the existing `map.addLayer({ id: DATA_MARKERS_LAYER_ID, ... })`. If there is a layer-removal/cleanup function for data markers in this file, add `DATA_MARKERS_CIRCLE_LAYER_ID` removal there too.)

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: `BUILD OK`.

- [ ] **Step 4: Manual browser check**

Run the editor or featured page and confirm POI markers now show a colored circle with the type emoji, and warnings still show their SVG icon. (`npm run dev`, open `/featured/sovev-beit-hillel`.)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/map/mapStyles.js src/map/mapLayers.product.js
git commit -m "feat(map): emoji-on-circle markers for POI types"
```

---

## Task 9: Editor map — emoji marker symbol layer

**Files:**
- Modify: `editor/editor.js`

- [ ] **Step 1: Add emoji text to the editor symbol layer**

In `editor/editor.js`, the `data-markers-layer` symbol layer (around line 7165) currently uses only `icon-image`. Add the same warning-aware `text-field` so POI types show their emoji on the existing colored halo/circle:

```js
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": ["case", ["get", "selected"], 1.12, 0.95],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "text-field": [
          "match",
          ["get", "type"],
          ["payment", "gate", "mud", "warning", "slope", "narrow", "severe"],
          "",
          ["coalesce", ["get", "emoji"], ""],
        ],
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-size": ["case", ["get", "selected"], 16, 13],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
```

The existing `data-markers-halo` circle already uses `dataColorExpression()`, so POI markers get a colored disc plus the emoji.

- [ ] **Step 2: Verify the editor file parses**

Run: `node --check editor/editor.js`
Expected: no output (exit 0).

- [ ] **Step 3: Manual browser check**

Open the editor (`EDITOR_PORT=8899 node editor/server.mjs`, then `http://127.0.0.1:8899/editor/`), select a segment with POI markers, and confirm emoji render on the colored circles; warnings keep SVGs.

- [ ] **Step 4: Commit**

```bash
git add editor/editor.js
git commit -m "feat(editor): emoji glyphs on POI map markers"
```

---

## Task 10: Editor — managed image list (replace path fields + multi-upload)

**Files:**
- Modify: `editor/editor.js`
- Modify: `editor/styles.css`

- [ ] **Step 1: Add image array helpers near the data-marker editing code**

In `editor/editor.js`, near `appendDataPhotoPreview` / `appendDataImageUpload`, add helpers to read/mutate `marker.images`:

```js
function markerImageList(marker) {
  if (Array.isArray(marker?.images)) {
    return marker.images.filter((e) => e && typeof e === "object" && e.photo);
  }
  if (marker?.photo) {
    return [{ photo: marker.photo, thumbnail: marker.thumbnail || marker.photo }];
  }
  return [];
}

function setMarkerImages(index, images) {
  // Writing images[] supersedes the legacy single-image fields.
  updateDataMarker(index, { images, photo: undefined, thumbnail: undefined });
  renderDataList();
}
```

- [ ] **Step 2: Replace the "Photo path" / "Thumbnail path" text fields with a managed list**

In the data-marker render function in `editor/editor.js`, delete the two `appendDataTextField` blocks labelled `"Photo path"` and `"Thumbnail path"`. In their place call a new renderer (defined in Step 3), passing the current marker and index:

```js
    appendDataImageManager(item, index, marker);
```

Keep the existing `appendDataImageUpload(item, index)` call, but its success handler must now **append** to `images[]` instead of setting `photo`/`thumbnail`. Update the `updateDataMarker(...)` line inside `appendDataImageUpload`'s `fetch` success path:

```js
      const current = markerImageList(selectedData()[index]);
      const next = [...current, { photo: body.photo, thumbnail: body.thumbnail }];
      setMarkerImages(index, next);
```

Also set the file input to allow multiple files (`input.multiple = true`) and, when multiple files are chosen, upload them sequentially, appending each. Replace the single-file read with a loop over `input.files`:

```js
    const files = Array.from(input.files || []);
    if (files.length === 0) return;
    const marker = selectedData()[index];
    const id = marker && typeof marker.id === "string" ? marker.id.trim() : "";
    if (!id) {
      statusEl.textContent = "Set a stable ID before uploading an image.";
      input.value = "";
      return;
    }
    statusEl.textContent = `Uploading ${files.length} image(s)…`;
    try {
      for (const file of files) {
        const dataUrl = await readFileAsDataUrl(file);
        const res = await fetch("/api/poi-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, data: dataUrl }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) throw new Error(body.error || `upload failed (${res.status})`);
        const current = markerImageList(selectedData()[index]);
        setMarkerImages(index, [...current, { photo: body.photo, thumbnail: body.thumbnail }]);
      }
      setStatus(`Stored ${files.length} image(s).`);
    } catch (error) {
      statusEl.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      input.value = "";
    }
```

- [ ] **Step 3: Add the `appendDataImageManager` renderer**

Add to `editor/editor.js` (near `appendDataPhotoPreview`):

```js
// Read-only thumbnail strip of a POI's images with Make-primary / Remove.
function appendDataImageManager(item, index, marker) {
  const images = markerImageList(marker);
  if (images.length === 0) return;

  const fieldLabel = document.createElement("span");
  fieldLabel.className = "field-label";
  fieldLabel.textContent = `Images (${images.length})`;
  item.appendChild(fieldLabel);

  const strip = document.createElement("div");
  strip.className = "data-image-strip";

  images.forEach((image, imageIndex) => {
    const cell = document.createElement("div");
    cell.className = imageIndex === 0 ? "data-image-cell primary" : "data-image-cell";

    const thumb = document.createElement("img");
    thumb.className = "data-image-thumb";
    thumb.src = dataImageSrc(image.thumbnail || image.photo);
    thumb.alt = marker.name || "POI image";
    thumb.loading = "lazy";
    cell.appendChild(thumb);

    if (imageIndex === 0) {
      const badge = document.createElement("span");
      badge.className = "data-image-badge";
      badge.textContent = "Primary";
      cell.appendChild(badge);
    } else {
      const makePrimary = document.createElement("button");
      makePrimary.type = "button";
      makePrimary.className = "mini-button";
      makePrimary.textContent = "Make primary";
      makePrimary.addEventListener("click", () => {
        const next = images.slice();
        const [picked] = next.splice(imageIndex, 1);
        next.unshift(picked);
        setMarkerImages(index, next);
      });
      cell.appendChild(makePrimary);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mini-button danger";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      const next = images.slice();
      next.splice(imageIndex, 1);
      setMarkerImages(index, next);
    });
    cell.appendChild(remove);

    strip.appendChild(cell);
  });

  item.appendChild(strip);
}
```

- [ ] **Step 4: Add styles**

In `editor/styles.css`, after `.data-image-status`, add:

```css
.data-image-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.data-image-cell {
  position: relative;
  display: grid;
  gap: 4px;
  width: 96px;
}

.data-image-thumb {
  width: 96px;
  height: 72px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--line);
}

.data-image-cell.primary .data-image-thumb {
  border-color: #2e7d32;
  border-width: 2px;
}

.data-image-badge {
  font-size: 10px;
  font-weight: 700;
  color: #2e7d32;
  text-align: center;
}
```

- [ ] **Step 5: Verify the editor parses**

Run: `node --check editor/editor.js`
Expected: no output (exit 0).

- [ ] **Step 6: Manual browser check**

In the editor, select a segment with a POI, upload 2 images, confirm the strip shows both with Primary on the first, test Make-primary and Remove, and Save. Reload and confirm `images[]` persisted via Save → `/api/source`.

- [ ] **Step 7: Commit**

```bash
git add editor/editor.js editor/styles.css
git commit -m "feat(editor): managed multi-image list replaces path fields"
```

---

## Task 11: Editor panel — pinned ID/Name header + collapsed Quality

**Files:**
- Modify: `editor/index.html`
- Modify: `editor/styles.css`
- Modify: `editor/editor.js` (only if the name/id elements move and event wiring needs the new nodes)

- [ ] **Step 1: Pin the ID/Name header**

In `editor/index.html`, the Segment panel header is `<header class="panel-header"><h2>Segment</h2>...`. Add a sticky sub-header that shows the segment id and name. Replace the `<header class="panel-header">` block of the first `.panel` (lines ~87-90) with:

```html
            <header class="panel-header segment-pinned-header">
              <div class="segment-pinned-title">
                <h2>Segment</h2>
                <span id="segment-id-display" class="segment-id-display"></span>
              </div>
              <span id="selected-count">None selected</span>
            </header>
```

Keep the existing `#segment-id` hidden input and `#segment-name` input where they are. (The Name input stays in the form directly below the pinned header, so it scrolls into the sticky region at the top.)

- [ ] **Step 2: Make the header sticky and populate the id display**

In `editor/styles.css`, add:

```css
.segment-pinned-header {
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--panel, #fff);
  border-bottom: 1px solid var(--line);
}

.segment-pinned-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.segment-id-display {
  font-size: 12px;
  color: var(--muted);
  font-weight: 700;
}
```

In `editor/editor.js`, wherever the segment form is populated (search for `segment-id`/`getElementById("segment-id")`), set the display text. Add next to the existing id assignment:

```js
  const idDisplay = document.getElementById("segment-id-display");
  if (idDisplay) idDisplay.textContent = segmentIdValue ? `#${segmentIdValue}` : "";
```

(Use the same value already written to the hidden `#segment-id` input.)

- [ ] **Step 3: Collapse Quality below the fold**

In `editor/index.html`, wrap the quality container in a `<details>` so it is collapsed by default. Replace:

```html
              <div id="segment-quality" class="quality-section" aria-label="Segment quality"></div>
```

with:

```html
              <details class="segment-quality-details">
                <summary>Quality</summary>
                <div id="segment-quality" class="quality-section" aria-label="Segment quality"></div>
              </details>
```

In `editor/styles.css`, add modest spacing:

```css
.segment-quality-details {
  margin-top: 12px;
}

.segment-quality-details > summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
  padding: 6px 0;
}
```

- [ ] **Step 4: Verify parse + build**

Run: `node --check editor/editor.js`
Expected: no output (exit 0).

- [ ] **Step 5: Manual browser check**

Open the editor, select a segment, scroll the details pane: the `Segment #<id>` header stays pinned at the top, Quality is collapsed and expands on click, and the Data/POI list is reachable with minimal scrolling.

- [ ] **Step 6: Commit**

```bash
git add editor/index.html editor/styles.css editor/editor.js
git commit -m "feat(editor): pin segment id/name header and collapse quality"
```

---

## Task 12: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: `FULL SUITE PASSED`; the new lines `normalizePoiImages tests passed`, `galleryImageSlides tests passed`, `data-marker images tests passed`, `editor POI images[] validation tests passed`, and the `editor POI image*` lines all print.

- [ ] **Step 2: Run the featured E2E**

Run: `npx playwright test tests/e2e/featured-route-layout.spec.mjs tests/e2e/featured-route-slots.spec.mjs`
Expected: all pass.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: `BUILD OK`.

- [ ] **Step 4: Manual smoke (editor + featured)**

- Editor: pinned header, collapsed quality, multi-image upload + Make-primary/Remove, emoji markers.
- Featured `/featured/sovev-beit-hillel`: every POI image appears as its own route-ordered slide; clicking a slide focuses its marker; clicking a marker selects its first slide.

- [ ] **Step 5: Final commit (if any uncommitted verification tweaks)**

```bash
git add -A
git commit -m "test(poi): verify POI editor refinements end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** §1 data contract → Tasks 1,3,7; §2 managed list → Tasks 4,10; §3 panel → Task 11; §4 emoji markers → Tasks 8,9; §5 flattened gallery → Tasks 2,6; §6 validation/promote → Task 5; §7 testing → per-task tests + Task 12.
- **Types/names consistency:** `normalizePoiImages`, `primaryPoiImage`, `galleryImageSlides`, `markerImageList`, `setMarkerImages`, `appendDataImageManager`, `DATA_MARKERS_CIRCLE_LAYER_ID/STYLE` are used consistently across tasks. Gallery slides use `poiId`/`imageIndex` everywhere.
- **Migration safety:** `normalizePoiImages` + `markerImages`/`hasGalleryImage` read legacy `photo`/`thumbnail`, so partial migration never breaks validation, gallery, or the existence check.
