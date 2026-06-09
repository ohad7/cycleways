# Segment tooltip restyle + legend relocation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the planner's segment hover/click tooltip into a cream POI-preview-style card (forest accent, optional photo, capped data chips), hide it during active playback, and relocate the road-type legend to the bottom-left so the card (and the POI preview) own the top-left corner.

**Architecture:** A small pure helper picks a representative image off a segment's data points (reusing existing `primaryPoiImage` + `imageSrc`). The `SegmentNameDisplay` React component in `src/App.jsx` is restructured into a media + body card. All styling is hardcoded hex (the planner does **not** load `featured.css`/`--fv-*`), matching the existing planner POI-preview rules in `react-app.css`. CSS moves the legend to bottom-left, shifts the segment card and POI preview flush to the top-left, hides the card during play, and keeps a shove-down for the paused-next-to-a-POI case.

**Tech Stack:** React 19, plain CSS (`styles.css` global + `src/react-app.css`), node-based `.mjs` assert tests (`node:assert/strict`, no framework).

Design spec: `plans/segment-name-display/design.md`.

---

### Task 1: `segmentPreviewImage` helper + unit test

**Files:**
- Create: `src/components/segmentPreviewImage.js`
- Test: `tests/test-segment-preview-image.mjs`
- Modify: `package.json` (test script)

- [ ] **Step 1: Write the failing test**

Create `tests/test-segment-preview-image.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/test-segment-preview-image.mjs`
Expected: FAIL — `Cannot find module '.../src/components/segmentPreviewImage.js'`.

- [ ] **Step 3: Write the helper**

Create `src/components/segmentPreviewImage.js`:

```js
import { primaryPoiImage } from "@cycleways/core/data/poiTypes.js";
import { imageSrc } from "./featured/routePoiStoryData.js";

// Pick a representative image for a segment from its data points (POIs/markers).
// Returns a resolved URL string for the first data point that has an image, or
// "" when none of the segment's data points carry an image. Mirrors how the POI
// preview resolves images, so paths and thumbnail preference stay consistent.
export function segmentPreviewImage(details) {
  const dataPoints = Array.isArray(details?.dataPoints) ? details.dataPoints : [];
  for (const dataPoint of dataPoints) {
    const image = primaryPoiImage(dataPoint);
    if (image) return imageSrc(image);
  }
  return "";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-segment-preview-image.mjs`
Expected: PASS — prints `segmentPreviewImage tests passed`.

- [ ] **Step 5: Wire the test into `npm test`**

In `package.json`, in the `"test"` script, insert the new test after the POI-types test. Find:

```
node tests/test-poi-types.mjs && node tests/test-route-endpoints.mjs
```

Replace with:

```
node tests/test-poi-types.mjs && node tests/test-segment-preview-image.mjs && node tests/test-route-endpoints.mjs
```

- [ ] **Step 6: Commit**

```bash
git add src/components/segmentPreviewImage.js tests/test-segment-preview-image.mjs package.json
git commit -m "feat(segment-card): segmentPreviewImage helper for segment data-point photos"
```

---

### Task 2: Restructure the `SegmentNameDisplay` component

**Files:**
- Modify: `src/App.jsx` (import near line 1–33; component at ~line 680–710)

- [ ] **Step 1: Add the helper import**

In `src/App.jsx`, add this import alongside the other `./components/...` imports (e.g. just after the `DataMarkerCard` import on line 4):

```jsx
import { segmentPreviewImage } from "./components/segmentPreviewImage.js";
```

- [ ] **Step 2: Replace the `SegmentNameDisplay` component body**

Replace the entire existing `SegmentNameDisplay` function (currently rendering `<strong>`, a `<br/>`, the stats line, and `.react-segment-data-list`) with:

```jsx
const SEGMENT_CHIP_CAP = 3;

function SegmentNameDisplay({
  details,
  inspectedSegment,
}) {
  if (!inspectedSegment) {
    return <div className="segment-name-display" id="segment-name-display" />;
  }

  const dataPoints = details?.dataPoints || [];
  const imageUrl = segmentPreviewImage(details);
  const shownChips = dataPoints.slice(0, SEGMENT_CHIP_CAP);
  const extraChips = dataPoints.length - shownChips.length;

  return (
    <div
      className="segment-name-display react-segment-name-display--active"
      id="segment-name-display"
    >
      {imageUrl ? (
        <img className="segment-card__media" src={imageUrl} alt="" />
      ) : (
        <span className="segment-card__icon" aria-hidden="true">🛣️</span>
      )}
      <div className="segment-card__body">
        <span className="segment-card__eyebrow">מקטע</span>
        <strong className="segment-card__name">{inspectedSegment}</strong>
        <div className="segment-card__stats">
          <span>📏 {details?.distanceKm || "0.0"} ק"מ</span>
          <span>⬆️ {details?.elevationGain || 0} מ'</span>
          <span>⬇️ {details?.elevationLoss || 0} מ'</span>
        </div>
        {shownChips.length > 0 && (
          <div className="segment-card__chips">
            {shownChips.map((dataPoint, index) => (
              <span
                className="segment-card__chip"
                key={`${dataPoint.type}-${index}`}
              >
                {dataPoint.emoji || WARNING_EMOJIS[dataPoint.type] || "⚠️"}{" "}
                {dataPoint.information}
              </span>
            ))}
            {extraChips > 0 && (
              <span className="segment-card__chip segment-card__chip--more">
                +{extraChips} נוספים
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

Note: `WARNING_EMOJIS` is already imported/used in `App.jsx` — leave its import as-is.

- [ ] **Step 3: Verify the existing JS test suite still passes**

Run: `npm test`
Expected: PASS — all tests, including `segmentPreviewImage tests passed`. (No JS test imports `App.jsx`; this step is a regression guard.)

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat(segment-card): media + body card layout with capped data chips"
```

---

### Task 3: Restyle the card CSS

**Files:**
- Modify: `styles.css` (`.segment-name-display` base ~487–503; entrance keyframe; mobile rule ~568–580)
- Modify: `src/react-app.css` (active rule ~1159–1161; `.react-segment-data-list` ~1163–1173; desktop block ~891–902; add playing-hide)

- [ ] **Step 1: Replace the base `.segment-name-display` rule in `styles.css`**

Replace the existing `.segment-name-display { ... }` block (the steel-blue one, ~lines 487–503) with:

```css
.segment-name-display {
  position: absolute;
  top: 25px;
  left: 25px;
  z-index: 1001;
  display: none;
  align-items: stretch;
  gap: 12px;
  direction: rtl;
  text-align: right;
  max-width: 340px;
  padding: 12px;
  border: 1px solid rgba(36, 49, 58, 0.16);
  border-radius: 8px;
  background: rgba(253, 252, 248, 0.96);
  box-shadow: 0 12px 28px rgba(16, 24, 32, 0.22);
  color: #24313a;
}
```

- [ ] **Step 2: Replace the mobile `.segment-name-display` rule in `styles.css`**

Replace the `@media (max-width: 768px) { .segment-name-display { ... } }` block (~lines 568–580) with:

```css
@media (max-width: 768px) {
  .segment-name-display {
    top: 15px;
    left: 15px;
    right: auto;
    gap: 8px;
    max-width: min(280px, calc(100% - 30px));
    padding: 8px;
  }
}
```

- [ ] **Step 3: Replace the active rule and data-list styles in `src/react-app.css`**

Replace the `.react-segment-name-display--active { display: block; }` rule **and** the `.react-segment-data-list` / `.react-segment-data-list div` rules (~lines 1159–1173) with the active rule plus the new inner-element styles:

```css
.react-segment-name-display--active {
  display: flex;
  animation: segmentCardIn 0.18s ease-out;
}

@keyframes segmentCardIn {
  0% {
    opacity: 0;
    transform: translateY(4px);
    box-shadow: 0 12px 28px rgba(16, 24, 32, 0.22), 0 0 0 0 rgba(63, 93, 51, 0);
  }
  60% {
    opacity: 1;
    transform: translateY(0);
    box-shadow: 0 12px 28px rgba(16, 24, 32, 0.22), 0 0 14px 2px rgba(63, 93, 51, 0.35);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
    box-shadow: 0 12px 28px rgba(16, 24, 32, 0.22), 0 0 0 0 rgba(63, 93, 51, 0);
  }
}

.segment-card__media {
  flex: 0 0 auto;
  width: 104px;
  height: 96px;
  border-radius: 6px;
  object-fit: cover;
}

.segment-card__icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 64px;
  height: 64px;
  border-radius: 999px;
  background: rgba(63, 93, 51, 0.18);
  color: #3f5d33;
  font-size: 28px;
  line-height: 1;
}

.segment-card__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.segment-card__eyebrow {
  color: #3f5d33;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.segment-card__name {
  display: block;
  margin-top: 2px;
  overflow-wrap: anywhere;
  color: #24313a;
  font-size: 17px;
  font-weight: 800;
  line-height: 1.18;
}

.segment-card__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 8px;
  color: #53616a;
  font-size: 12px;
  font-weight: 600;
}

.segment-card__chips {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.segment-card__chip {
  align-self: flex-start;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(63, 93, 51, 0.18);
  color: #3f5d33;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
}

.segment-card__chip--more {
  background: rgba(36, 49, 58, 0.08);
  color: #53616a;
}
```

- [ ] **Step 4: Move the desktop card flush to the corner + add the playing-hide in `src/react-app.css`**

In the `@media (min-width: 769px)` block (~lines 891–902), change the two `left: 138px` values to `left: 25px` so the rules read:

```css
@media (min-width: 769px) {
  .map-container .segment-name-display {
    top: 25px;
    right: auto;
    left: 25px;
  }

  .map-container--has-planner-poi .segment-name-display {
    top: 122px;
    left: 25px;
  }
}
```

Then add this **global** rule (outside any media query — e.g. immediately after the `.segment-card__chip--more` rule from Step 3) so the card hides during active playback on every viewport:

```css
.map-container--planner-playing .segment-name-display {
  display: none;
}
```

- [ ] **Step 5: Verify tests still pass and check for stale selectors**

Run: `npm test`
Expected: PASS.

Run: `grep -rn "react-segment-data-list" src/`
Expected: no matches (the component no longer renders it and the CSS was removed).

- [ ] **Step 6: Commit**

```bash
git add styles.css src/react-app.css
git commit -m "style(segment-card): cream POI-style card, forest accent, hide during play"
```

---

### Task 4: Relocate the legend + align the POI preview to the corner

**Files:**
- Modify: `styles.css` (`.legend-container` ~582–589; mobile legend ~591–598)
- Modify: `src/react-app.css` (planner POI preview `left` ~1050; shove-down note; add route-ready legend lift + playing-hide)

- [ ] **Step 1: Move the legend to bottom-left in `styles.css`**

Replace the `.legend-container { ... }` base rule (~lines 582–589) with:

```css
.legend-container {
  position: absolute;
  bottom: 25px;
  left: 25px;
  z-index: 1000;
  direction: rtl;
  min-width: 100px;
}
```

Replace the mobile `@media (max-width: 768px) { .legend-container { ... } }` block (~lines 591–598) with:

```css
@media (max-width: 768px) {
  .legend-container {
    bottom: 15px;
    left: 15px;
    right: auto;
    width: auto;
  }
}
```

- [ ] **Step 2: Lift the legend above the controls when a route is ready; hide it on mobile and during play (`src/react-app.css`)**

Add these rules near the other `.legend-container` / `.map-container--*` rules. The route-ready lift and the playing-hide are **global**:

```css
.map-container--route-ready .legend-container {
  bottom: 104px;
}

.map-container--planner-playing .legend-container {
  display: none;
}
```

The existing `.map-container--planner-playing .legend-container { display: none; }` inside the `@media (max-width: 768px)` block (~line 1423) is now redundant with the global rule — leave it (harmless) or delete it; do not change other rules in that block.

In the mobile block (`@media (max-width: 768px)`), add an override so a loaded route hides the legend rather than lifting it into the crowded mobile bottom UI:

```css
@media (max-width: 768px) {
  .map-container--route-ready .legend-container {
    display: none;
  }
}
```

- [ ] **Step 3: Align the planner POI preview flush to the corner (`src/react-app.css`)**

The planner POI preview still sits at `left: 138px` (it used to clear the legend). With the legend gone from the top-left, move it flush. In `.planner-route-poi-preview.fv-video-poi-preview { ... }` (~line 1050), change `left: 138px;` to `left: 25px;`.

This keeps the POI preview and the (paused) shove-down segment card in one clean left column at `left: 25px`.

- [ ] **Step 4: Verify tests still pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add styles.css src/react-app.css
git commit -m "style(planner): move legend to bottom-left, align card + POI preview to corner"
```

---

### Task 5: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full JS test suite**

Run: `npm test`
Expected: PASS, including `segmentPreviewImage tests passed`.

- [ ] **Step 2: Launch the app and verify behavior**

Use the `run` skill (or `npm run dev` and open the printed URL). On the planner (`/`), verify:

- Hover a plain segment → cream card appears top-left with the 🛣️ icon, `מקטע` eyebrow (green), name, and a stats row (distance / ⬆️ gain / ⬇️ loss).
- Hover a segment that has a warning/POI with a photo → the photo shows as the card thumbnail and a green chip lists the data point.
- Hover the one segment with 4 data points → at most 3 chips show, then a `+1 נוספים` chip.
- The road-type legend now sits in the **bottom-left**.
- Build a route → the legend lifts above the playback controls; the play transport appears at the bottom.
- Press play → the segment card is hidden while playing; the POI preview sits flush in the top-left corner; the legend is hidden.
- Pause near a POI → the card returns and stacks **below** the POI preview (no overlap).
- Narrow the window to mobile width → card and legend reposition sensibly; the legend hides once a route is loaded.

- [ ] **Step 3: (Optional) Run the smoke tests**

Run: `npm run test:smoke`
Expected: PASS (Playwright). Skip if the environment can't run browsers.

---

## Self-review notes

- **Spec coverage:** restyle (Task 2–3), image source + helper (Task 1–2), chip cap (Task 2), hide-during-play + shove-down (Task 3), legend bottom-left + route-ready lift + play-hide (Task 4), POI-preview corner alignment (Task 4, a necessary consequence of the legend move), mobile (Task 3–4), testing (Task 1, Task 5). All design sections map to a task.
- **Hardcoded palette:** all colors are literal hex/rgba matching the planner POI preview — no `var(--fv-*)` (those are not loaded on the planner).
- **Type/name consistency:** helper `segmentPreviewImage(details)` is defined in Task 1 and consumed in Task 2; class names `segment-card__media/__icon/__body/__eyebrow/__name/__stats/__chips/__chip/__chip--more` are introduced in Task 2 (JSX) and styled in Task 3 (CSS) with matching names.
