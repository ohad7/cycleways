# Edge-Pick Segment Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace point-drawing with direct base-edge selection for new CW segments in the editor; auto-commit an accepted overlay mapping when the picked edges pass continuity/exclusivity validation.

**Architecture:** A new `state.draw.type === "newSegmentEdges"` mode in the existing draw state machine. Picked edges live transiently on `state.draw.edgeRefs`; on Done, a single atomic step assigns an id, stitches `LineString` coordinates from the edges, writes the source feature, runs validation, and saves the overlay mapping. Pure helpers (stitching, validation, conflict detection) live in a new ES module under `editor/lib/` so they can be unit-tested headlessly. No new server endpoints, no schema changes.

**Tech Stack:** Vanilla JS ESM (browser script type=module), mapbox-gl-js, Node ESM test scripts using `node:assert/strict`. Project conventions are tabbed-into via `package.json` scripts (`npm test`).

---

## File Structure

**Create:**
- `editor/lib/edge-pick.mjs` — pure helpers: `stitchCoordsFromEdgeRefs`, `validateEdgePickMapping`, `conflictingSegmentForEdge`. No imports from `editor.js`; takes data structures as arguments only.
- `tests/test-edge-pick-helpers.mjs` — node ESM unit tests for the helpers.
- `plans/edge-pick-segment-creation/manual-smoke.md` — short checklist matching the design's "Manual smoke checklist" section, kept next to the plan for the implementer.

**Modify:**
- `editor/editor.js` — new draw type, click handlers, draft rendering, commit path, edit-mode tooling for edge-picked segments. ~ +400 LOC across multiple sections.
- `editor/index.html` — new toolbar buttons (`undo-last`, `draw-freehand-instead`), new edit-mode buttons (`edit-segment-edges`, `split-segment-edge`) in segments side panel, new compose-status div.
- `editor/styles.css` — draft chain styling, hover affordance, compose-status block styling.
- `editor/README.md` — update "Current Editing Scope" section.
- `package.json` — add the new test script to the `test` chain.

**Do not touch:** `editor/server.mjs`, `editor/dev-server.mjs`, `data/*`, `processing/*`, anything under `src/`.

---

## Important Reused APIs (read before starting)

The plan calls these existing helpers by exact name. Re-read their definitions if unsure:

- `normalizeOverlayEdgeRefs(edgeRefs)` — editor.js:1059. Sorts by `sequenceIndex`. No topology.
- `edgeRefContinuityGaps(edgeRefs)` — editor.js:1962. Distance-threshold against `MAX_EDGE_CONNECTION_GAP_M = 12` (editor.js:118).
- `edgeRefFromBaseFeature(feature, sequenceIndex)` — editor.js:2221. Build an EdgeRef from a clicked base graph feature.
- `coordDistanceMeters(a, b)` — editor.js:1776.
- `nextSegmentId()` — editor.js:3561.
- `uniqueSegmentName(preferredName)` — editor.js:3572.
- `defaultQuality()` — editor.js:457.
- `isBaseGraphStale()` — editor.js:1535.
- `emptyDrawState()` — editor.js:296.
- `isDrawing()` — editor.js:324.
- `clearDrawState()` — editor.js:3253.
- `canFinishDraw()` — editor.js:1442.
- `renderDrawControls()` — editor.js:1454.
- `finishDraw()` — editor.js:4103.
- `cancelDraw()` — editor.js:4139.
- `removeLastDrawPoint()` — editor.js:4149.
- `commitNewDrawnSegment()` — editor.js:3823.
- `toggleSelectedOverlayBaseEdge(feature)` — editor.js:2330.
- `saveBaseOverlay()` — editor.js:5135.
- `saveSelectedBaseOverlayMapping(mapping)` — editor.js:5162.
- `overlayMappingForSegment(segmentId)` — find via grep; reads `state.baseOverlay.overlay.segments[id]`.
- `markDirty()` — sets `state.dirty`.
- `queueChangedFeature(feature)` — editor.js:3846 area, marks changed for the changed-segment queue.
- `renderAll()` — repaints UI + map.
- `setStatus(message, level?)` — status bar.

Constants:
- `MAX_EDGE_CONNECTION_GAP_M = 12` — editor.js:118.

If you don't find one of these, stop and re-grep before improvising.

---

## Task 1: Pure helpers module + tests

**Files:**
- Create: `editor/lib/edge-pick.mjs`
- Create: `tests/test-edge-pick-helpers.mjs`
- Modify: `package.json` (add to `test` script)

Pure helpers, no DOM, no global state. The editor calls them with the data they need.

- [ ] **Step 1: Write failing tests for `stitchCoordsFromEdgeRefs`**

Create `tests/test-edge-pick-helpers.mjs`:

```js
import assert from "node:assert/strict";
import {
  stitchCoordsFromEdgeRefs,
  validateEdgePickMapping,
  conflictingSegmentForEdge,
} from "../editor/lib/edge-pick.mjs";

// stitchCoordsFromEdgeRefs ---------------------------------------------------

// Two forward edges sharing an endpoint are stitched and the duplicate point is dropped.
{
  const edges = new Map([
    ["e1", { coordinates: [[0, 0], [1, 0]] }],
    ["e2", { coordinates: [[1, 0], [2, 0]] }],
  ]);
  const refs = [
    { edgeId: "e1", direction: "forward", sequenceIndex: 0 },
    { edgeId: "e2", direction: "forward", sequenceIndex: 1 },
  ];
  assert.deepEqual(stitchCoordsFromEdgeRefs(refs, edges), [
    [0, 0], [1, 0], [2, 0],
  ]);
}

// A reverse-direction edge has its coords reversed before stitching.
{
  const edges = new Map([
    ["e1", { coordinates: [[0, 0], [1, 0]] }],
    ["e2", { coordinates: [[2, 0], [1, 0]] }],
  ]);
  const refs = [
    { edgeId: "e1", direction: "forward", sequenceIndex: 0 },
    { edgeId: "e2", direction: "reverse", sequenceIndex: 1 },
  ];
  assert.deepEqual(stitchCoordsFromEdgeRefs(refs, edges), [
    [0, 0], [1, 0], [2, 0],
  ]);
}

// A single edge passes through unchanged.
{
  const edges = new Map([["e1", { coordinates: [[0, 0], [1, 1]] }]]);
  const refs = [{ edgeId: "e1", direction: "forward", sequenceIndex: 0 }];
  assert.deepEqual(stitchCoordsFromEdgeRefs(refs, edges), [[0, 0], [1, 1]]);
}

// Missing edge in the lookup yields an empty stitch (caller must validate first).
{
  const edges = new Map();
  const refs = [{ edgeId: "e1", direction: "forward", sequenceIndex: 0 }];
  assert.deepEqual(stitchCoordsFromEdgeRefs(refs, edges), []);
}

// Non-touching pair still concatenates (validation, not stitching, flags gaps).
{
  const edges = new Map([
    ["e1", { coordinates: [[0, 0], [1, 0]] }],
    ["e2", { coordinates: [[5, 5], [6, 6]] }],
  ]);
  const refs = [
    { edgeId: "e1", direction: "forward", sequenceIndex: 0 },
    { edgeId: "e2", direction: "forward", sequenceIndex: 1 },
  ];
  assert.deepEqual(stitchCoordsFromEdgeRefs(refs, edges), [
    [0, 0], [1, 0], [5, 5], [6, 6],
  ]);
}

console.log("stitchCoordsFromEdgeRefs ok");
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
node tests/test-edge-pick-helpers.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` (module does not yet exist) — that is the desired failure.

- [ ] **Step 3: Implement `stitchCoordsFromEdgeRefs`**

Create `editor/lib/edge-pick.mjs`:

```js
// Pure helpers for edge-picked CW segment creation.
// No imports from editor.js; all dependencies are passed as arguments.

/**
 * Stitch a LineString coordinate array from an ordered EdgeRef list.
 * - edgeRefs: { edgeId, direction, sequenceIndex }[] (already normalized).
 * - edgeLookup: Map<edgeIdString, { coordinates: [lng, lat][] }>
 *
 * Edges with direction === "reverse" have their coordinates reversed before
 * concatenation. Shared endpoints between consecutive edges are deduplicated
 * (the duplicated start of the next edge is dropped).
 *
 * Missing edges contribute nothing; the caller is responsible for validating
 * the lookup is complete.
 */
export function stitchCoordsFromEdgeRefs(edgeRefs, edgeLookup) {
  const result = [];
  for (const ref of edgeRefs || []) {
    const edge = edgeLookup.get(String(ref.edgeId));
    if (!edge?.coordinates?.length) continue;
    const coords = ref.direction === "reverse"
      ? [...edge.coordinates].reverse()
      : edge.coordinates;
    if (result.length === 0) {
      result.push(...coords.map((c) => c.slice()));
      continue;
    }
    const tail = result[result.length - 1];
    const head = coords[0];
    const dedup = tail[0] === head[0] && tail[1] === head[1];
    for (let i = dedup ? 1 : 0; i < coords.length; i++) {
      result.push(coords[i].slice());
    }
  }
  return result;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
node tests/test-edge-pick-helpers.mjs
```

Expected: `stitchCoordsFromEdgeRefs ok`.

- [ ] **Step 5: Write failing tests for `validateEdgePickMapping`**

Append to `tests/test-edge-pick-helpers.mjs`:

```js
// validateEdgePickMapping ----------------------------------------------------

const MAX_GAP_M = 12;

// Helper: continuity gap detector mirroring editor.js edgeRefContinuityGaps.
function continuityGapsFromCoords(refs, edgeLookup, maxGapM, distanceFn) {
  const gaps = [];
  for (let i = 0; i < refs.length - 1; i++) {
    const a = edgeLookup.get(String(refs[i].edgeId));
    const b = edgeLookup.get(String(refs[i + 1].edgeId));
    if (!a?.coordinates?.length || !b?.coordinates?.length) continue;
    const aCoords = refs[i].direction === "reverse"
      ? [...a.coordinates].reverse() : a.coordinates;
    const bCoords = refs[i + 1].direction === "reverse"
      ? [...b.coordinates].reverse() : b.coordinates;
    const distance = distanceFn(aCoords[aCoords.length - 1], bCoords[0]);
    if (distance > maxGapM) {
      gaps.push({ sequenceIndex: i, fromEdgeId: String(refs[i].edgeId), toEdgeId: String(refs[i + 1].edgeId), distanceMeters: distance });
    }
  }
  return gaps;
}

// Trivial distance function for tests: euclidean × 100000 (so 1° ~ 111km approx).
const flatDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * 100000;

// Empty edgeRefs is invalid (UI gate also blocks this, but the helper must too).
{
  const result = validateEdgePickMapping({
    segmentId: 99,
    edgeRefs: [],
    acceptedMappings: new Map(),
    continuityGaps: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureClass, "edge_pick_empty");
}

// Single edge with no continuity gaps passes.
{
  const result = validateEdgePickMapping({
    segmentId: 99,
    edgeRefs: [{ edgeId: "e1", direction: "forward", sequenceIndex: 0 }],
    acceptedMappings: new Map(),
    continuityGaps: [],
  });
  assert.equal(result.ok, true);
}

// Continuity gap reported by the caller produces edge_pick_gap.
{
  const result = validateEdgePickMapping({
    segmentId: 99,
    edgeRefs: [
      { edgeId: "e1", direction: "forward", sequenceIndex: 0 },
      { edgeId: "e2", direction: "forward", sequenceIndex: 1 },
    ],
    acceptedMappings: new Map(),
    continuityGaps: [{ sequenceIndex: 0, fromEdgeId: "e1", toEdgeId: "e2", distanceMeters: 42 }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureClass, "edge_pick_gap");
  assert.equal(result.gaps.length, 1);
}

// Edge owned by another accepted segment produces edge_pick_conflict.
{
  const accepted = new Map([
    ["e1", { segmentId: 7, segmentName: "Foo" }],
  ]);
  const result = validateEdgePickMapping({
    segmentId: 99,
    edgeRefs: [{ edgeId: "e1", direction: "forward", sequenceIndex: 0 }],
    acceptedMappings: accepted,
    continuityGaps: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureClass, "edge_pick_conflict");
  assert.equal(result.conflicts[0].segmentId, 7);
}

// Edge owned only by the *current* segment does not conflict (self-edits).
{
  const accepted = new Map([
    ["e1", { segmentId: 99, segmentName: "Self" }],
  ]);
  const result = validateEdgePickMapping({
    segmentId: 99,
    edgeRefs: [{ edgeId: "e1", direction: "forward", sequenceIndex: 0 }],
    acceptedMappings: accepted,
    continuityGaps: [],
  });
  assert.equal(result.ok, true);
}

console.log("validateEdgePickMapping ok");
```

- [ ] **Step 6: Run, confirm failure**

```bash
node tests/test-edge-pick-helpers.mjs
```

Expected: `SyntaxError: ... validateEdgePickMapping is not exported` or `TypeError: validateEdgePickMapping is not a function`.

- [ ] **Step 7: Implement `validateEdgePickMapping`**

Append to `editor/lib/edge-pick.mjs`:

```js
/**
 * Validate an edge-picked overlay mapping. Returns:
 *   { ok: true } on success, or
 *   { ok: false, failureClass, message, gaps?, conflicts? } on failure.
 *
 * Inputs:
 *   - segmentId: number of the segment being validated (used to exclude itself
 *     from the conflict check).
 *   - edgeRefs: ordered EdgeRef list.
 *   - acceptedMappings: Map<edgeIdString, { segmentId, segmentName }> built
 *     from the current overlay (only accepted_edge_set / accepted_auto_match
 *     mappings should be included by the caller).
 *   - continuityGaps: pre-computed gaps from editor.js' edgeRefContinuityGaps.
 */
export function validateEdgePickMapping({ segmentId, edgeRefs, acceptedMappings, continuityGaps }) {
  if (!edgeRefs || edgeRefs.length === 0) {
    return {
      ok: false,
      failureClass: "edge_pick_empty",
      message: "Pick at least one base edge before saving.",
    };
  }

  const gaps = (continuityGaps || []).slice();
  if (gaps.length > 0) {
    return {
      ok: false,
      failureClass: "edge_pick_gap",
      message: `Gap between edge ${gaps[0].sequenceIndex} and ${gaps[0].sequenceIndex + 1} (${Math.round(gaps[0].distanceMeters)}m).`,
      gaps,
    };
  }

  const conflicts = [];
  for (const ref of edgeRefs) {
    const owner = acceptedMappings.get(String(ref.edgeId));
    if (owner && Number(owner.segmentId) !== Number(segmentId)) {
      conflicts.push({ edgeId: String(ref.edgeId), segmentId: owner.segmentId, segmentName: owner.segmentName });
    }
  }
  if (conflicts.length > 0) {
    return {
      ok: false,
      failureClass: "edge_pick_conflict",
      message: `Edge ${conflicts[0].edgeId} is already owned by segment ${conflicts[0].segmentName || conflicts[0].segmentId}.`,
      conflicts,
    };
  }

  return { ok: true };
}
```

- [ ] **Step 8: Run, confirm passing**

```bash
node tests/test-edge-pick-helpers.mjs
```

Expected: `stitchCoordsFromEdgeRefs ok` then `validateEdgePickMapping ok`.

- [ ] **Step 9: Write failing tests for `conflictingSegmentForEdge`**

Append to `tests/test-edge-pick-helpers.mjs`:

```js
// conflictingSegmentForEdge --------------------------------------------------

{
  // Helper that walks an overlay segments object and produces the
  // acceptedMappings Map. Used by editor.js as well as the tests.
  const overlaySegments = {
    "10": { segmentId: 10, segmentName: "Alpha", status: "accepted_edge_set", edgeRefs: [{ edgeId: "e1" }, { edgeId: "e2" }] },
    "20": { segmentId: 20, segmentName: "Beta",  status: "needs_edit",        edgeRefs: [{ edgeId: "e3" }] },
    "30": { segmentId: 30, segmentName: "Gamma", status: "accepted_auto_match", edgeRefs: [{ edgeId: "e4" }] },
  };

  // e2 owned by Alpha (accepted_edge_set) → conflict
  assert.deepEqual(conflictingSegmentForEdge("e2", 99, overlaySegments), { segmentId: 10, segmentName: "Alpha" });

  // e3 only owned by needs_edit → not a conflict
  assert.equal(conflictingSegmentForEdge("e3", 99, overlaySegments), null);

  // e4 owned by Gamma (accepted_auto_match) → conflict
  assert.deepEqual(conflictingSegmentForEdge("e4", 99, overlaySegments), { segmentId: 30, segmentName: "Gamma" });

  // Same segment → not a conflict
  assert.equal(conflictingSegmentForEdge("e1", 10, overlaySegments), null);

  // Unknown edge → not a conflict
  assert.equal(conflictingSegmentForEdge("e99", 99, overlaySegments), null);
}

console.log("conflictingSegmentForEdge ok");
```

- [ ] **Step 10: Run, confirm failure**

```bash
node tests/test-edge-pick-helpers.mjs
```

Expected: `TypeError: conflictingSegmentForEdge is not a function`.

- [ ] **Step 11: Implement `conflictingSegmentForEdge`**

Append to `editor/lib/edge-pick.mjs`:

```js
const ACCEPTED_STATUSES = new Set(["accepted_edge_set", "accepted_auto_match"]);

/**
 * Find an accepted overlay mapping (other than excludeSegmentId) that already
 * references this edgeId. Returns { segmentId, segmentName } or null.
 *
 * Mappings with status outside ACCEPTED_STATUSES (e.g. needs_edit) are not
 * considered committed owners and do not produce a conflict.
 */
export function conflictingSegmentForEdge(edgeId, excludeSegmentId, overlaySegments) {
  const target = String(edgeId);
  for (const mapping of Object.values(overlaySegments || {})) {
    if (!mapping || !ACCEPTED_STATUSES.has(mapping.status)) continue;
    if (Number(mapping.segmentId) === Number(excludeSegmentId)) continue;
    if (!Array.isArray(mapping.edgeRefs)) continue;
    if (mapping.edgeRefs.some((ref) => String(ref.edgeId) === target)) {
      return { segmentId: mapping.segmentId, segmentName: mapping.segmentName };
    }
  }
  return null;
}
```

- [ ] **Step 12: Run, confirm all tests pass**

```bash
node tests/test-edge-pick-helpers.mjs
```

Expected: all three `... ok` lines.

- [ ] **Step 13: Wire test into npm test**

Edit `package.json`. In the `"test"` script string, add ` && node tests/test-edge-pick-helpers.mjs` immediately after the existing `node tests/test-catalog-filter.mjs` segment (mid-chain placement is fine — pick any spot in the existing `&&` sequence).

```bash
npm test
```

Expected: full test suite passes. If only the helper test is needed: `node tests/test-edge-pick-helpers.mjs`.

- [ ] **Step 14: Add `.mjs` MIME type to the editor server**

The browser will load `editor/lib/edge-pick.mjs` via `import` in Task 5. The server's MIME map (editor/server.mjs:58) does not include `.mjs`, so without this step the browser would receive `application/octet-stream` and refuse to execute the module.

In `editor/server.mjs`, change:

```js
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
]);
```

to:

```js
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
]);
```

- [ ] **Step 15: Commit**

```bash
git add editor/lib/edge-pick.mjs tests/test-edge-pick-helpers.mjs package.json editor/server.mjs
git commit -m "feat(editor): edge-pick helpers (stitch, validate, conflict)"
```

---

## Task 2: New draw type wiring

**Files:**
- Modify: `editor/editor.js`

Introduce `state.draw.type === "newSegmentEdges"` end-to-end in the draw state machine — without yet handling clicks or rendering. After this task, clicking Add Segment enters compose mode (toolbar swaps to Done/Cancel) and Cancel returns to select. Nothing else works yet; the next tasks add behavior.

- [ ] **Step 1: Extend `emptyDrawState` defaults**

Find `function emptyDrawState()` (editor.js:296). Add two fields so the new draw type has predictable defaults:

```js
function emptyDrawState() {
  return {
    active: false,
    type: null,
    sourceIndex: -1,
    endpoint: null,
    hoverEndpoint: null,
    coords: [],
    hoverCoord: null,
    edgeRefs: [],
    hoverEdgeId: null,
  };
}
```

- [ ] **Step 2: Replace `addSegment` body with the new entry point**

Find `function addSegment()` (editor.js:3806). Replace:

```js
function addSegment() {
  startNewSegmentDraw();
}
```

with:

```js
function addSegment() {
  startNewSegmentEdgesDraw();
}
```

- [ ] **Step 3: Add the new draw starter**

Immediately after `function startNewSegmentDraw()` (editor.js:3725 area), add:

```js
function startNewSegmentEdgesDraw() {
  if (!state.source) return;
  if (state.workspaceMode !== "segments") {
    setStatus("Switch to Segments mode to add a segment.", "error");
    return;
  }
  if (isBaseGraphStale()) {
    setStatus("Run Recalculate Graph + Matches before adding a segment.", "error");
    return;
  }
  if (!state.baseOverlay.loaded) {
    state.baseOverlay.enabled = true;
    loadBaseOverlayData().then(() => {
      if (!isBaseGraphStale()) startNewSegmentEdgesDraw();
    }).catch(showError);
    return;
  }

  state.selectedIndex = -1;
  state.selectedVertexIndex = -1;
  state.selectedDataIndex = -1;
  state.draw = {
    ...emptyDrawState(),
    active: true,
    type: "newSegmentEdges",
    edgeRefs: [],
  };
  setMode("draw");
  renderAll();
  setStatus("Click base edges to compose the new segment. Press Done when ready.");
  map.doubleClickZoom.disable();
}
```

- [ ] **Step 4: Extend `canFinishDraw` for the new type**

Find `function canFinishDraw()` (editor.js:1442). Add a branch:

```js
function canFinishDraw() {
  if (!isDrawing()) return false;
  if (state.draw.type === "newSegmentEdges") {
    return Array.isArray(state.draw.edgeRefs) && state.draw.edgeRefs.length >= 1;
  }
  if (state.draw.type === "new" || state.draw.type === "manualBaseEdge") {
    return state.draw.coords.length >= 2;
  }
  return (
    (state.draw.type === "extend" || state.draw.type === "manualBaseEdgeExtend") &&
    Boolean(state.draw.endpoint) &&
    state.draw.coords.length >= 1
  );
}
```

- [ ] **Step 5: Add a stub commit branch in `finishDraw`**

Find `async function finishDraw()` (editor.js:4103). Locate the chain:

```js
  const result =
    drawType === "new"
      ? commitNewDrawnSegment()
      : drawType === "manualBaseEdge"
        ? await commitManualBaseEdgeDrawn()
        : drawType === "manualBaseEdgeExtend"
          ? await commitManualBaseEdgeExtendDrawn()
          : commitExtendDrawnSegment();
```

Replace with:

```js
  const result =
    drawType === "newSegmentEdges"
      ? await commitNewSegmentEdgesDrawn()
      : drawType === "new"
        ? commitNewDrawnSegment()
        : drawType === "manualBaseEdge"
          ? await commitManualBaseEdgeDrawn()
          : drawType === "manualBaseEdgeExtend"
            ? await commitManualBaseEdgeExtendDrawn()
            : commitExtendDrawnSegment();
```

And update the status-line branch at the bottom of `finishDraw`:

```js
  setStatus(
    drawType === "manualBaseEdge" || drawType === "manualBaseEdgeExtend"
      ? `${result.message} Rebuild the OSM graph when ready.`
      : drawType === "newSegmentEdges"
        ? `${result.message} Save the source when ready.`
        : `${result.message} Save the source when ready.`,
  );
```

(Yes, two branches print the same message; keeping them separate makes the next task simpler when message variants land.)

- [ ] **Step 6: Add a stub `commitNewSegmentEdgesDrawn`**

Anywhere near the other commit functions (editor.js:3823 area), add:

```js
async function commitNewSegmentEdgesDrawn() {
  // Stub: replaced by Task 6.
  throw new Error("commitNewSegmentEdgesDrawn not implemented yet.");
}
```

- [ ] **Step 7: Sanity load the editor**

```bash
EDITOR_PORT=8899 node editor/server.mjs
```

Open `http://127.0.0.1:8899/editor/`. Click Add Segment. Confirm:

- Toolbar swaps: Done and Cancel are visible, the other edit buttons hidden.
- Done is disabled (no edges picked yet).
- Cancel/Esc returns to select mode with no errors in the JS console.

Stop the server. (Don't click Done — it would throw the stub error.)

- [ ] **Step 8: Commit**

```bash
git add editor/editor.js
git commit -m "feat(editor): newSegmentEdges draw type scaffolding"
```

---

## Task 3: Reveal base graph + click-to-toggle in Segments mode

**Files:**
- Modify: `editor/editor.js`

Make base graph and manual edges visible and clickable in Segments mode **only while composing** a new segment. Each click toggles the edge in `state.draw.edgeRefs`.

- [ ] **Step 1: Find the composing flag helper**

Add this small helper near `isDrawing()` (editor.js:324):

```js
function isComposingNewSegmentEdges() {
  return isDrawing() && state.draw.type === "newSegmentEdges";
}
```

- [ ] **Step 2: Extend `updateWorkspaceLayerVisibility` to show base graph while composing**

Find `function updateWorkspaceLayerVisibility()` (editor.js:1117 area). Read the existing body, then change the visibility decisions so the base graph + manual base edges layers (`base-graph-edges-layer`, `base-graph-edges-hit-layer`, `manual-base-edges-layer`, `manual-base-edges-hit-layer`) are visible when **either** the current workspace is base/overlay **or** `isComposingNewSegmentEdges()` is true.

The function uses local booleans like `showBaseEdges`. Wherever those are computed, OR them with `composing`:

```js
function updateWorkspaceLayerVisibility() {
  const composing = isComposingNewSegmentEdges();
  const showSegments = state.workspaceMode === "segments";
  const showBaseGraph =
    composing || state.workspaceMode === "base" || state.workspaceMode === "overlay";
  // ... existing layer visibility logic, replacing the current showBaseGraph
  // computation with the new one. Keep all other variables as-is.
}
```

If `showBaseGraph` is not the existing variable name, read 30 lines of the function and adapt. The visibility predicate must end up `composing OR base OR overlay`.

- [ ] **Step 3: Toggle helper in the editor**

Add this near `toggleSelectedOverlayBaseEdge` (editor.js:2330):

```js
function toggleEdgeInCompose(feature) {
  if (!isComposingNewSegmentEdges()) return;
  const ref = edgeRefFromBaseFeature(feature, state.draw.edgeRefs.length);
  if (!ref) return;
  const currentIdx = state.draw.edgeRefs.findIndex(
    (existing) => String(existing.edgeId) === String(ref.edgeId),
  );
  if (currentIdx >= 0) {
    state.draw.edgeRefs = state.draw.edgeRefs
      .filter((_, i) => i !== currentIdx)
      .map((existing, i) => ({ ...existing, sequenceIndex: i }));
    setStatus(`Removed base edge ${ref.edgeId} from draft.`);
  } else {
    state.draw.edgeRefs = [...state.draw.edgeRefs, ref];
    setStatus(`Added base edge ${ref.edgeId} to draft (${state.draw.edgeRefs.length} edges).`);
  }
  updateMapSources();
  renderDrawControls();
  renderComposeStatus(); // added in Task 5
}
```

For Task 3 you may temporarily stub `renderComposeStatus`:

```js
function renderComposeStatus() {}
```

Place the stub just above `toggleEdgeInCompose`; Task 5 will replace it.

- [ ] **Step 4: Wire the click handlers**

Find the existing handler for `base-graph-edges-hit-layer` (editor.js:5579). Change the gate so composing also accepts the click:

```js
  map.on("click", "base-graph-edges-hit-layer", (event) => {
    if (state.mode !== "select" && !isComposingNewSegmentEdges()) return;
    if (state.mode === "select" && !["base", "overlay"].includes(state.workspaceMode)) return;
    if (cwOverlayNetworkFeaturesAtPoint(event.point).length > 0) return;
    state.suppressNextSegmentClick = true;
    window.setTimeout(() => { state.suppressNextSegmentClick = false; }, 0);
    if (isComposingNewSegmentEdges()) {
      toggleEdgeInCompose(event.features[0]);
      return;
    }
    if (state.workspaceMode === "base") {
      selectBaseGraphEdge(event.features[0]);
    } else {
      toggleSelectedOverlayBaseEdge(event.features[0]).catch(showError);
    }
  });
```

Do the same for the `manual-base-edges-hit-layer` handler (editor.js:5593): if `isComposingNewSegmentEdges()`, call `toggleEdgeInCompose(event.features[0])` and return; otherwise existing behavior.

- [ ] **Step 5: Sanity check**

Boot the editor, click Add Segment, click a base edge → status line should confirm `Added base edge ... (1 edges).`; click again → `Removed base edge ...`. Click two edges → Done becomes enabled. Don't click Done (still stubbed). Esc to cancel.

- [ ] **Step 6: Commit**

```bash
git add editor/editor.js
git commit -m "feat(editor): toggle base edges during edge-pick compose"
```

---

## Task 4: Draft chain rendering layer

**Files:**
- Modify: `editor/editor.js`
- Modify: `editor/styles.css`

Add a new transient map layer that renders the picked draft chain in a distinct style with edge order labels for the first few edges.

- [ ] **Step 1: Add the source registration**

In `async function addMapLayers()` (editor.js:5865 area), after the existing `selected-overlay-edges` source registration (editor.js:5922), add:

```js
  if (!map.getSource("compose-edge-pick")) {
    map.addSource("compose-edge-pick", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
```

- [ ] **Step 2: Add the layer registration**

Still in `addMapLayers`, find the existing `selected-overlay-edges-layer` block (editor.js:6102 area) and add **after** it:

```js
  if (!map.getLayer("compose-edge-pick-layer")) {
    map.addLayer({
      id: "compose-edge-pick-layer",
      type: "line",
      source: "compose-edge-pick",
      layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
      paint: {
        "line-color": "#ea580c",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 9, 16, 13],
        "line-opacity": 0.9,
      },
    });
  }
  if (!map.getLayer("compose-edge-pick-labels")) {
    map.addLayer({
      id: "compose-edge-pick-labels",
      type: "symbol",
      source: "compose-edge-pick",
      layout: {
        "symbol-placement": "line-center",
        "text-field": ["to-string", ["get", "sequenceNumber"]],
        "text-size": 14,
        "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
        visibility: "none",
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "#ea580c",
        "text-halo-width": 2,
      },
    });
  }
```

(The `text-font` value mirrors what other editor symbol layers use; if grep shows a different font, match it.)

- [ ] **Step 3: Build the collection function**

Near `manualBaseEdgeCollection` (editor.js:928 area), add:

```js
function composeEdgePickCollection() {
  if (!isComposingNewSegmentEdges()) {
    return { type: "FeatureCollection", features: [] };
  }
  const graphLookup = new Map();
  for (const feature of state.baseOverlay.graphEdges?.features || []) {
    graphLookup.set(String(graphEdgeFeatureId(feature)), feature);
  }
  for (const feature of manualBaseEdgeFeatures()) {
    graphLookup.set(String(manualBaseEdgeFeatureId(feature)), feature);
  }
  const features = [];
  state.draw.edgeRefs.forEach((ref, index) => {
    const source = graphLookup.get(String(ref.edgeId));
    const coords = source?.geometry?.coordinates;
    if (!coords?.length) return;
    const oriented = ref.direction === "reverse" ? [...coords].reverse() : coords;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: oriented },
      properties: { edgeId: String(ref.edgeId), sequenceNumber: index + 1 },
    });
  });
  return { type: "FeatureCollection", features };
}
```

- [ ] **Step 4: Wire collection into `updateMapSources`**

In `function updateMapSources()` (editor.js:1068), add a line near the other `setSourceData` calls:

```js
  setSourceData("compose-edge-pick", composeEdgePickCollection());
```

- [ ] **Step 5: Layer visibility**

In `updateWorkspaceLayerVisibility`, after computing `composing` from Task 3 Step 2, toggle the two compose layers:

```js
  setLayerVisibility("compose-edge-pick-layer", composing);
  setLayerVisibility("compose-edge-pick-labels", composing);
```

- [ ] **Step 6: Style the source segments layer so the in-progress draft pops**

In `editor/styles.css`, add (anywhere near other map-related styles):

```css
.map-toolbar.drawing .toolbar-group-create,
.map-toolbar.drawing .toolbar-group-edit,
.map-toolbar.drawing .toolbar-group-view {
  opacity: 0.5;
}
```

(`drawing` class is already toggled by `renderDrawControls`.)

- [ ] **Step 7: Hover affordance for +/−**

The design says hover should indicate whether a click would add or remove. Implement with cursor + a small status hint, not a paint change (paint change would re-run the layer for every mousemove, too expensive).

Add a mouseenter/mouseleave/mousemove handler block near the existing hover bindings (editor.js:5610 area):

```js
  map.on("mousemove", "base-graph-edges-hit-layer", (event) => {
    if (!isComposingNewSegmentEdges()) return;
    const f = event.features?.[0];
    if (!f) return;
    const edgeId = String(graphEdgeFeatureId(f));
    const already = state.draw.edgeRefs.some((r) => String(r.edgeId) === edgeId);
    map.getCanvas().style.cursor = already ? "not-allowed" : "copy";
    state.draw.hoverEdgeId = edgeId;
  });
  map.on("mouseleave", "base-graph-edges-hit-layer", () => {
    if (!isComposingNewSegmentEdges()) return;
    state.draw.hoverEdgeId = null;
    map.getCanvas().style.cursor = "crosshair";
  });
```

Repeat the same two handlers for `manual-base-edges-hit-layer`, using `manualBaseEdgeFeatureId(f)` to derive the id.

- [ ] **Step 8: Sanity check**

Boot the editor, click Add Segment, click two base edges. The picked edges should render in orange with order labels `1` and `2`. Toggle an edge off → it disappears. Cancel → layer empties. Hovering an unpicked edge shows the `copy` cursor; hovering a picked edge shows `not-allowed`.

- [ ] **Step 9: Commit**

```bash
git add editor/editor.js editor/styles.css
git commit -m "feat(editor): render draft chain + hover affordance for edge-pick"
```

---

## Task 5: Compose toolbar buttons + side-panel status

**Files:**
- Modify: `editor/index.html`
- Modify: `editor/editor.js`
- Modify: `editor/styles.css`

Add Undo last + Draw freehand instead buttons, wire keybindings, render live validation status in the segments side panel.

- [ ] **Step 1: Add the new toolbar buttons to HTML**

In `editor/index.html`, locate the `toolbar-group-draw` block (editor/index.html:52):

```html
<div class="toolbar-group toolbar-group-draw">
  <button id="draw-done" class="tool-button confirm" type="button" hidden>Done</button>
  <button id="draw-cancel" class="tool-button danger" type="button" hidden>Cancel</button>
</div>
```

Replace with:

```html
<div class="toolbar-group toolbar-group-draw">
  <button id="draw-done" class="tool-button confirm" type="button" hidden>Done</button>
  <button id="draw-undo-last" class="tool-button" type="button" hidden>Undo last</button>
  <button id="draw-freehand" class="tool-button" type="button" hidden>Draw freehand</button>
  <button id="draw-cancel" class="tool-button danger" type="button" hidden>Cancel</button>
</div>
```

- [ ] **Step 2: Add a compose-status block to the side panel**

Find the segments side panel section in `editor/index.html` (look for `id="segment-form"`, around line 90). Just above the segment form, add:

```html
<div id="compose-edge-status" class="compose-edge-status" hidden></div>
```

- [ ] **Step 3: Wire the elements into the `els` map**

In `editor/editor.js` `els` object (editor.js:184 area), add:

```js
  drawUndoLast: document.getElementById("draw-undo-last"),
  drawFreehand: document.getElementById("draw-freehand"),
  composeEdgeStatus: document.getElementById("compose-edge-status"),
```

- [ ] **Step 4: Render the new buttons' visibility/disabled state**

In `renderDrawControls` (editor.js:1454), find the existing `els.drawDone.hidden = !drawing;` block (editor.js:1487 area) and add immediately after:

```js
  const composing = drawing && state.draw.type === "newSegmentEdges";
  els.drawUndoLast.hidden = !composing;
  els.drawUndoLast.disabled = !composing || state.draw.edgeRefs.length === 0;
  els.drawFreehand.hidden = !composing;
  els.drawFreehand.disabled = !composing;
```

- [ ] **Step 5: Wire the Undo Last button + keybinding**

In `editor/editor.js`, near the existing draw-button bindings (editor.js:5535 area), add:

```js
  els.drawUndoLast.addEventListener("click", () => removeLastDrawStep());
  els.drawFreehand.addEventListener("click", () => switchComposeToFreehand());
```

Replace `function removeLastDrawPoint()` (editor.js:4149) with a polymorphic version:

```js
function removeLastDrawStep() {
  if (!isDrawing()) return;
  if (state.draw.type === "newSegmentEdges") {
    if (state.draw.edgeRefs.length === 0) return;
    const removed = state.draw.edgeRefs[state.draw.edgeRefs.length - 1];
    state.draw.edgeRefs = state.draw.edgeRefs
      .slice(0, -1)
      .map((ref, i) => ({ ...ref, sequenceIndex: i }));
    updateMapSources();
    renderDrawControls();
    renderComposeStatus();
    setStatus(`Removed last edge ${removed.edgeId} from draft.`);
    return;
  }
  if (state.draw.coords.length === 0) return;
  state.draw.coords.pop();
  updateMapSources();
  renderDrawControls();
  setStatus("Removed last drawn point.");
}
```

Find the existing `removeLastDrawPoint()` callsite in the keydown handler (editor.js:5847) and rename it to `removeLastDrawStep()`. Confirm by grep that no other callers remain.

- [ ] **Step 6: Implement `switchComposeToFreehand`**

Add near `startNewSegmentEdgesDraw`:

```js
function switchComposeToFreehand() {
  if (state.draw.type !== "newSegmentEdges") return;
  const hadEdges = state.draw.edgeRefs.length > 0;
  if (hadEdges && !window.confirm("Switch to freehand drawing? Picked edges will be discarded.")) {
    return;
  }
  state.draw = {
    ...emptyDrawState(),
    active: true,
    type: "new",
  };
  updateMapSources();
  renderDrawControls();
  renderComposeStatus();
  setStatus("Switched to freehand drawing. Click points to draw the segment.");
}
```

- [ ] **Step 7: Implement `renderComposeStatus` (replaces the Task 3 stub)**

Replace the empty stub with the real implementation:

```js
function renderComposeStatus() {
  const composing = isComposingNewSegmentEdges();
  if (!composing) {
    els.composeEdgeStatus.hidden = true;
    els.composeEdgeStatus.innerHTML = "";
    return;
  }
  const edgeCount = state.draw.edgeRefs.length;
  if (edgeCount === 0) {
    els.composeEdgeStatus.hidden = false;
    els.composeEdgeStatus.textContent = "Click base edges to compose the new segment.";
    return;
  }
  const normalized = normalizeOverlayEdgeRefs(state.draw.edgeRefs);
  const gaps = edgeRefContinuityGaps(normalized);
  const conflicts = state.draw.edgeRefs
    .map((ref) => conflictingSegmentForEdgeFromOverlay(ref.edgeId, /* segmentId */ -1))
    .filter(Boolean);
  const continuityLine = gaps.length === 0
    ? `<div class="compose-ok">✓ continuous (${edgeCount} edges)</div>`
    : `<div class="compose-bad">Gap between edge ${gaps[0].sequenceIndex + 1} and ${gaps[0].sequenceIndex + 2} (${Math.round(gaps[0].distanceMeters)}m)</div>`;
  const conflictLine = conflicts.length === 0
    ? `<div class="compose-ok">✓ exclusive</div>`
    : `<div class="compose-bad">Edge ${conflicts[0].edgeId || ""} already owned by ${conflicts[0].segmentName || `segment ${conflicts[0].segmentId}`}</div>`;
  els.composeEdgeStatus.hidden = false;
  els.composeEdgeStatus.innerHTML = continuityLine + conflictLine;
}
```

And add the convenience wrapper:

```js
function conflictingSegmentForEdgeFromOverlay(edgeId, excludeSegmentId) {
  return conflictingSegmentForEdge(
    edgeId,
    excludeSegmentId,
    state.baseOverlay.overlay?.segments || {},
  );
}
```

- [ ] **Step 8: Import the helper module**

At the top of `editor/editor.js`, add the import:

```js
import {
  stitchCoordsFromEdgeRefs,
  validateEdgePickMapping,
  conflictingSegmentForEdge,
} from "./lib/edge-pick.mjs";
```

Confirm the file is loaded as a module (it is, per `editor/index.html` `<script type="module" src="/editor/editor.js"></script>` at line 265).

- [ ] **Step 9: Hook `renderComposeStatus` into `renderAll`**

`renderAll` is at editor.js:3131. Add `renderComposeStatus();` right after `renderBaseOverlayPanel();`:

```js
function renderAll() {
  els.sourceSummary.textContent = `${state.activeFeatures.length} active · ${state.source.features.length} records`;
  renderWorkspaceChrome();
  renderDrawControls();
  renderList();
  renderForm();
  renderDataList();
  renderBaseGraphPanel();
  renderBaseOverlayPanel();
  renderComposeStatus();
  updateMapSources();
}
```

- [ ] **Step 10: Add basic CSS for compose-status**

In `editor/styles.css`:

```css
.compose-edge-status {
  margin: 8px 12px;
  padding: 8px 12px;
  border: 1px solid #d4a373;
  border-radius: 6px;
  background: #fff7ed;
  font-size: 13px;
  color: #2d2a26;
}
.compose-edge-status .compose-ok { color: #166534; }
.compose-edge-status .compose-bad { color: #b91c1c; font-weight: 600; }
```

- [ ] **Step 11: Sanity check**

Boot editor, Add Segment, click two contiguous edges → side panel shows `✓ continuous (2 edges)` and `✓ exclusive`. Click two distant edges → continuity line flips to `Gap between edge 1 and 2 (...m)`. Undo last → reverts. Draw freehand → confirms, toolbar swaps to point-drawing.

- [ ] **Step 12: Commit**

```bash
git add editor/editor.js editor/index.html editor/styles.css
git commit -m "feat(editor): compose toolbar + side-panel status for edge-pick"
```

---

## Task 6: Commit path — create segment + overlay mapping atomically

**Files:**
- Modify: `editor/editor.js`

Replace the Task 2 stub with the real commit. On Done: assign id, stitch coords, build feature, run validation, write overlay mapping, push to source, save overlay.

- [ ] **Step 1: Replace the stub `commitNewSegmentEdgesDrawn`**

Replace the stub from Task 2 with:

```js
async function commitNewSegmentEdgesDrawn() {
  if (isBaseGraphStale()) {
    throw new Error("Run Recalculate Graph + Matches before saving the segment.");
  }
  const edgeRefs = normalizeOverlayEdgeRefs(state.draw.edgeRefs);
  if (edgeRefs.length === 0) {
    throw new Error("Pick at least one base edge before saving.");
  }

  const segmentId = nextSegmentId();
  const continuityGaps = edgeRefContinuityGaps(edgeRefs);

  // Build acceptedMappings lookup once for validation.
  const acceptedMappings = new Map();
  for (const mapping of Object.values(state.baseOverlay.overlay?.segments || {})) {
    if (!mapping || (mapping.status !== "accepted_edge_set" && mapping.status !== "accepted_auto_match")) {
      continue;
    }
    for (const ref of mapping.edgeRefs || []) {
      acceptedMappings.set(String(ref.edgeId), { segmentId: mapping.segmentId, segmentName: mapping.segmentName });
    }
  }

  const validation = validateEdgePickMapping({
    segmentId,
    edgeRefs,
    acceptedMappings,
    continuityGaps,
  });

  // Stitch coordinates from the picked edges.
  const edgeLookup = new Map();
  for (const feature of state.baseOverlay.graphEdges?.features || []) {
    edgeLookup.set(String(graphEdgeFeatureId(feature)), feature.geometry);
  }
  for (const feature of manualBaseEdgeFeatures()) {
    edgeLookup.set(String(manualBaseEdgeFeatureId(feature)), feature.geometry);
  }
  const coordinates = stitchCoordsFromEdgeRefs(edgeRefs, edgeLookup);
  if (coordinates.length < 2) {
    throw new Error("Could not build segment geometry from the picked edges.");
  }

  const name = uniqueSegmentName("New segment");
  const newFeature = {
    type: "Feature",
    properties: {
      id: segmentId,
      name,
      status: "active",
      roadType: "paved",
      quality: defaultQuality(),
    },
    geometry: {
      type: "LineString",
      coordinates,
    },
  };

  state.source.features.push(newFeature);
  const sourceIndex = state.source.features.length - 1;
  refreshActiveFeatures();
  state.selectedIndex = state.activeFeatures.findIndex((record) => record.sourceIndex === sourceIndex);

  const mapping = {
    segmentId,
    segmentName: name,
    source: "edge_pick",
    status: validation.ok ? "accepted_edge_set" : "needs_edit",
    edgeRefs,
    confidence: "manual",
    coverageRatio: 1,
    avgDistanceMeters: null,
    gapCount: continuityGaps.length,
    failureClass: validation.ok ? null : validation.failureClass,
    failureMessage: validation.ok ? null : validation.message,
    updatedAt: new Date().toISOString(),
  };
  await saveSelectedBaseOverlayMapping(mapping);
  queueChangedFeature(newFeature);

  const detail = validation.ok
    ? `Accepted ${name} with ${edgeRefs.length} base edges.`
    : `Created ${name} but mapping needs edit: ${validation.message}`;
  return { feature: newFeature, message: detail };
}
```

- [ ] **Step 2: Sanity test the happy path**

Boot editor, Add Segment, click two contiguous edges, Done. Confirm:

- Segment appears in the list, selected on the map.
- `data/cw-base-overlay.json` (open in your editor or `cat`) now has the new segment id under `segments`, with `source: "edge_pick"` and `status: "accepted_edge_set"`.
- The side panel shows the segment with its name + quality defaults.
- `state.dirty` toggles (`Save` button enables); save it to persist the source feature.

- [ ] **Step 3: Sanity test the gap path**

Add Segment, click two distant base edges, Done. Confirm:

- Segment still created.
- Overlay mapping has `status: "needs_edit"`, `failureClass: "edge_pick_gap"`.

- [ ] **Step 4: Sanity test the conflict path**

Pick any base edge already used by an existing accepted segment (any accepted CW segment shows its edges in CW Overlay mode). Add Segment, click that edge, Done. Confirm `failureClass: "edge_pick_conflict"`.

- [ ] **Step 5: Commit**

```bash
git add editor/editor.js
git commit -m "feat(editor): commit edge-picked segment + overlay mapping"
```

---

## Task 7: Gate vertex tools by segment source

**Files:**
- Modify: `editor/editor.js`

Hide drag-vertex / insert / delete-vertex / extend / split for segments whose overlay mapping has `source: "edge_pick"`. Show new edit buttons instead.

- [ ] **Step 1: Add a helper to detect edge-picked segments**

Near `selectedFeature` or `overlayMappingForSegment` in `editor.js`, add:

```js
function isEdgePickedSelected() {
  const segmentId = selectedSegmentId();
  if (segmentId === null) return false;
  const mapping = state.baseOverlay.overlay?.segments?.[String(segmentId)];
  return mapping?.source === "edge_pick";
}
```

- [ ] **Step 2: Find the buttons' enablement code**

In `renderDrawControls` (editor.js:1454) and any sibling function that handles segment-form button states (look for the block that toggles `els.extendSegment.disabled`, `els.deleteVertex.disabled`, etc. — search for `els.extendSegment.disabled`).

For each of these buttons:
- `els.extendSegment`
- `els.deleteVertex`
- `els.splitSegment`
- `els.modeInsert`

Change `.hidden = ...` to also be true when `isEdgePickedSelected()`:

```js
  const edgePicked = isEdgePickedSelected();
  els.extendSegment.hidden = drawing || overlayMode || edgePicked;
  els.deleteVertex.hidden = drawing || overlayMode || edgePicked;
  els.splitSegment.hidden = drawing || overlayMode || edgePicked;
  els.modeInsert.hidden = drawing || overlayMode || edgePicked;
```

(Adapt to the exact existing predicates — these are illustrative.)

Vertex dragging is event-driven on the `vertices-layer` click. Find that handler (editor.js:5698) and add an early return when `isEdgePickedSelected()`.

- [ ] **Step 3: Add the new edit buttons to HTML**

In `editor/index.html`, find the segments side panel (where `segment-form` lives). Below the segment form, before the data-markers section, add:

```html
<div class="edge-pick-edit-controls" id="edge-pick-edit-controls" hidden>
  <button id="edit-segment-edges" class="mini-button" type="button">Add/remove edges</button>
  <button id="split-segment-edge" class="mini-button" type="button">Split at edge boundary</button>
</div>
```

Add to the `els` map:

```js
  edgePickEditControls: document.getElementById("edge-pick-edit-controls"),
  editSegmentEdges: document.getElementById("edit-segment-edges"),
  splitSegmentEdge: document.getElementById("split-segment-edge"),
```

In `renderDrawControls` (or the function that updates side-panel visibility), toggle:

```js
  els.edgePickEditControls.hidden = !edgePicked;
```

- [ ] **Step 4: Sanity check**

Boot editor. Select a freshly-created edge-picked segment. Confirm:

- Extend / Delete / Split / Insert buttons are hidden.
- The new "Add/remove edges" and "Split at edge boundary" buttons appear in the side panel.
- Selecting a legacy point-drawn segment shows the old buttons (and not the new ones).

The new buttons don't do anything yet — that's Task 8.

- [ ] **Step 5: Commit**

```bash
git add editor/editor.js editor/index.html
git commit -m "feat(editor): gate vertex tools off for edge-picked segments"
```

---

## Task 8: Edit-edges mode for committed edge-picked segments

**Files:**
- Modify: `editor/editor.js`

Make "Add/remove edges" enter a mode where clicking a base graph edge toggles it in the selected segment's overlay mapping. Re-runs validation; mapping status flips to `accepted_edge_set` automatically on each save if valid, else `needs_edit`.

- [ ] **Step 1: Add a state flag**

Add to the initial `state` object (search for `selectedIndex: -1` in editor.js to find it):

```js
  editingEdgePickEdges: false,
```

- [ ] **Step 2: Wire the button**

Add the click binding:

```js
  els.editSegmentEdges.addEventListener("click", () => {
    state.editingEdgePickEdges = !state.editingEdgePickEdges;
    if (state.editingEdgePickEdges) {
      setStatus("Click base edges to add or remove them from this segment.");
    } else {
      setStatus("Exited edge-edit mode.");
    }
    renderAll();
  });
```

Render the button's pressed-state in the function that updates the new edit controls:

```js
  els.editSegmentEdges.classList.toggle("active", state.editingEdgePickEdges && edgePicked);
```

- [ ] **Step 3: Layer visibility while editing**

In `updateWorkspaceLayerVisibility`, OR the base graph visibility predicate with `state.editingEdgePickEdges && isEdgePickedSelected()`:

```js
  const editingEdges = state.editingEdgePickEdges && isEdgePickedSelected();
  const showBaseGraph =
    composing || editingEdges || state.workspaceMode === "base" || state.workspaceMode === "overlay";
```

- [ ] **Step 4: Click handler branch**

In the `base-graph-edges-hit-layer` click handler (modified in Task 3), add a third branch:

```js
  map.on("click", "base-graph-edges-hit-layer", (event) => {
    if (state.mode !== "select" && !isComposingNewSegmentEdges()) return;
    // ... existing guards ...
    if (isComposingNewSegmentEdges()) { toggleEdgeInCompose(event.features[0]); return; }
    if (state.editingEdgePickEdges && isEdgePickedSelected()) {
      toggleEdgeInEdgePickedSegment(event.features[0]).catch(showError);
      return;
    }
    // ... existing base/overlay behavior ...
  });
```

Do the same in the `manual-base-edges-hit-layer` handler.

- [ ] **Step 5: Implement `toggleEdgeInEdgePickedSegment`**

```js
async function toggleEdgeInEdgePickedSegment(feature) {
  const segmentId = selectedSegmentId();
  const selected = selectedFeature();
  if (segmentId === null || !selected) return;
  const existing = state.baseOverlay.overlay?.segments?.[String(segmentId)] || {};
  const currentRefs = normalizeOverlayEdgeRefs(existing.edgeRefs || []);
  const ref = edgeRefFromBaseFeature(feature, currentRefs.length);
  if (!ref) return;
  const existingIdx = currentRefs.findIndex(
    (r) => String(r.edgeId) === String(ref.edgeId),
  );
  let nextRefs = existingIdx >= 0
    ? currentRefs.filter((_, i) => i !== existingIdx)
    : [...currentRefs, ref];
  nextRefs = normalizeOverlayEdgeRefs(nextRefs);
  await saveEdgePickedMapping(segmentId, selected, nextRefs);
}
```

- [ ] **Step 6: Implement `saveEdgePickedMapping` (shared with re-stitch)**

Add:

```js
async function saveEdgePickedMapping(segmentId, feature, edgeRefs) {
  const continuityGaps = edgeRefContinuityGaps(edgeRefs);
  const acceptedMappings = new Map();
  for (const mapping of Object.values(state.baseOverlay.overlay?.segments || {})) {
    if (!mapping || (mapping.status !== "accepted_edge_set" && mapping.status !== "accepted_auto_match")) continue;
    if (Number(mapping.segmentId) === Number(segmentId)) continue;
    for (const ref of mapping.edgeRefs || []) {
      acceptedMappings.set(String(ref.edgeId), { segmentId: mapping.segmentId, segmentName: mapping.segmentName });
    }
  }
  const validation = validateEdgePickMapping({ segmentId, edgeRefs, acceptedMappings, continuityGaps });

  const edgeLookup = new Map();
  for (const f of state.baseOverlay.graphEdges?.features || []) {
    edgeLookup.set(String(graphEdgeFeatureId(f)), f.geometry);
  }
  for (const f of manualBaseEdgeFeatures()) {
    edgeLookup.set(String(manualBaseEdgeFeatureId(f)), f.geometry);
  }
  const coords = stitchCoordsFromEdgeRefs(edgeRefs, edgeLookup);
  if (coords.length >= 2) {
    feature.geometry.coordinates = coords;
  }

  const existing = state.baseOverlay.overlay?.segments?.[String(segmentId)] || {};
  const mapping = {
    ...existing,
    segmentId,
    segmentName: featureName(feature),
    source: "edge_pick",
    status: validation.ok ? "accepted_edge_set" : "needs_edit",
    edgeRefs,
    confidence: "manual",
    coverageRatio: 1,
    avgDistanceMeters: null,
    gapCount: continuityGaps.length,
    failureClass: validation.ok ? null : validation.failureClass,
    failureMessage: validation.ok ? null : validation.message,
    updatedAt: new Date().toISOString(),
  };
  await saveSelectedBaseOverlayMapping(mapping);
  queueChangedFeature(feature);
  markDirty();
  renderAll();
  setStatus(
    validation.ok
      ? `Updated ${featureName(feature)} (${edgeRefs.length} edges).`
      : `Updated ${featureName(feature)} but mapping needs edit: ${validation.message}`,
  );
}
```

- [ ] **Step 7: Sanity check**

Boot editor. Select an edge-picked segment. Click "Add/remove edges". Confirm base graph becomes visible. Click an edge already in the segment → it's removed; the source geometry re-stitches and shrinks; the mapping persists. Click another edge → added.

- [ ] **Step 8: Commit**

```bash
git add editor/editor.js
git commit -m "feat(editor): add/remove edges for edge-picked segments"
```

---

## Task 9: Split at edge boundary

**Files:**
- Modify: `editor/editor.js`

Implement Split for edge-picked segments: pick an internal edge boundary, parent deprecates, two children inherit halves of the edgeRefs.

- [ ] **Step 1: Wire the button into a mode**

Add a state flag and binding:

```js
  splittingEdgePickAt: null, // numeric index of the boundary preview, or null
```

```js
  els.splitSegmentEdge.addEventListener("click", () => {
    if (!isEdgePickedSelected()) return;
    state.splittingEdgePickAt = state.splittingEdgePickAt === null ? 0 : null;
    setStatus(
      state.splittingEdgePickAt === null
        ? "Cancelled split."
        : "Click an edge boundary on the segment to split it.",
    );
    renderAll();
  });
```

Active visual:

```js
  els.splitSegmentEdge.classList.toggle("active", state.splittingEdgePickAt !== null);
```

- [ ] **Step 2: Click handler — pick a boundary**

In the `base-graph-edges-hit-layer` click handler, before the existing edge-edit branch, add:

```js
  if (state.splittingEdgePickAt !== null && isEdgePickedSelected()) {
    splitEdgePickedAtClickedEdge(event.features[0]).catch(showError);
    return;
  }
```

Same branch in `manual-base-edges-hit-layer`.

- [ ] **Step 3: Implement `splitEdgePickedAtClickedEdge`**

```js
async function splitEdgePickedAtClickedEdge(feature) {
  const segmentId = selectedSegmentId();
  const selected = selectedFeature();
  if (segmentId === null || !selected) return;
  const mapping = state.baseOverlay.overlay?.segments?.[String(segmentId)] || {};
  const refs = normalizeOverlayEdgeRefs(mapping.edgeRefs || []);
  const ref = edgeRefFromBaseFeature(feature, 0);
  if (!ref) return;
  const boundaryIndex = refs.findIndex((r) => String(r.edgeId) === String(ref.edgeId));
  if (boundaryIndex <= 0 || boundaryIndex >= refs.length) {
    setStatus("Pick an internal edge to split here (not the first or last).", "error");
    return;
  }
  const firstHalf = refs.slice(0, boundaryIndex).map((r, i) => ({ ...r, sequenceIndex: i }));
  const secondHalf = refs.slice(boundaryIndex).map((r, i) => ({ ...r, sequenceIndex: i }));

  // Build geometry for both halves.
  const edgeLookup = new Map();
  for (const f of state.baseOverlay.graphEdges?.features || []) {
    edgeLookup.set(String(graphEdgeFeatureId(f)), f.geometry);
  }
  for (const f of manualBaseEdgeFeatures()) {
    edgeLookup.set(String(manualBaseEdgeFeatureId(f)), f.geometry);
  }
  const firstCoords = stitchCoordsFromEdgeRefs(firstHalf, edgeLookup);
  const secondCoords = stitchCoordsFromEdgeRefs(secondHalf, edgeLookup);
  if (firstCoords.length < 2 || secondCoords.length < 2) {
    setStatus("Split would leave an empty half. Cancelled.", "error");
    return;
  }

  // Build the two children.
  const childAId = nextSegmentId();
  const childAName = uniqueSegmentName(`${featureName(selected)} A`);
  const childA = {
    type: "Feature",
    properties: {
      id: childAId,
      name: childAName,
      status: "active",
      roadType: selected.properties.roadType || "paved",
      quality: selected.properties.quality || defaultQuality(),
    },
    geometry: { type: "LineString", coordinates: firstCoords },
  };
  state.source.features.push(childA);

  const childBId = nextSegmentId();
  const childBName = uniqueSegmentName(`${featureName(selected)} B`);
  const childB = {
    type: "Feature",
    properties: {
      id: childBId,
      name: childBName,
      status: "active",
      roadType: selected.properties.roadType || "paved",
      quality: selected.properties.quality || defaultQuality(),
    },
    geometry: { type: "LineString", coordinates: secondCoords },
  };
  state.source.features.push(childB);

  // Deprecate parent with routeAnchors so existing route URLs still rebuild.
  selected.properties = {
    ...selected.properties,
    status: "deprecated",
    deprecated: true,
    routeAnchors: selected.geometry.coordinates.map((c) => [c[0], c[1]]),
  };
  selected.geometry = null;

  // Move parent's overlay mapping aside and save child mappings.
  const overlaySegments = { ...(state.baseOverlay.overlay?.segments || {}) };
  delete overlaySegments[String(segmentId)];
  state.baseOverlay.overlay = {
    ...emptyBaseOverlay(),
    ...state.baseOverlay.overlay,
    segments: overlaySegments,
  };
  await saveBaseOverlay();
  await saveEdgePickedMapping(childAId, childA, firstHalf);
  await saveEdgePickedMapping(childBId, childB, secondHalf);

  state.splittingEdgePickAt = null;
  refreshActiveFeatures();
  state.selectedIndex = state.activeFeatures.findIndex((r) => r.sourceIndex === state.source.features.length - 1);
  markDirty();
  renderAll();
  setStatus(`Split ${featureName(selected)} into ${childAName} and ${childBName}.`);
}
```

- [ ] **Step 4: Sanity check**

Boot editor, select an edge-picked segment with at least 3 edges, Split at edge boundary, click an internal edge → two children, parent deprecated. Both children should appear with sensible names; their overlay mappings should be saved.

- [ ] **Step 5: Commit**

```bash
git add editor/editor.js
git commit -m "feat(editor): split edge-picked segments at edge boundary"
```

---

## Task 10: README + manual smoke checklist

**Files:**
- Modify: `editor/README.md`
- Create: `plans/edge-pick-segment-creation/manual-smoke.md`

- [ ] **Step 1: Update the README**

In `editor/README.md`, find the "Current Editing Scope" bullets (around line 76). Replace the relevant bullets:

Find:

```markdown
- Select a segment from the map, or open the Segments drawer when search/list selection is needed.
- Draw a new segment by clicking points on the map, then committing with Done.
- Extend a selected segment by clicking near its closest endpoint and drawing outward.
```

Replace with:

```markdown
- Select a segment from the map, or open the Segments drawer when search/list selection is needed.
- Add a new segment by clicking base graph edges in order; press Done to commit. The new segment is auto-accepted into the CW base overlay if its edges are continuous and unowned; otherwise it is saved as `needs_edit` for review.
- The escape-hatch "Draw freehand" button in the compose toolbar reverts to the legacy point-drawing flow for areas with no base coverage. Add the missing base edges in Base Graph mode first when possible.
- Extend a selected legacy (point-drawn) segment by clicking near its closest endpoint and drawing outward. Edge-picked segments instead expose Add/remove edges and Split at edge boundary in the segment side panel.
```

Also update the editing-tools bullets (drag vertex, insert vertex, etc.) to clarify they apply only to legacy point-drawn segments.

- [ ] **Step 2: Create the manual smoke checklist**

Create `plans/edge-pick-segment-creation/manual-smoke.md` with the bullet list from the design doc's "Manual smoke checklist (in lieu of editor e2e)" section. The implementer runs through it after Task 9 lands.

- [ ] **Step 3: Commit**

```bash
git add editor/README.md plans/edge-pick-segment-creation/manual-smoke.md
git commit -m "docs(editor): edge-pick flow in README + smoke checklist"
```

---

## Final Verification

After all tasks land:

- [ ] **Run all node tests**

```bash
npm test
```

Expected: all existing tests + the new `test-edge-pick-helpers.mjs` pass.

- [ ] **Run the manual smoke checklist**

Walk through `plans/edge-pick-segment-creation/manual-smoke.md` against the live editor. File issues for any flake.

- [ ] **Confirm no regressions for legacy point-drawn segments**

Select an existing accepted point-drawn segment, verify Extend / Delete / Split / vertex-drag still work. Confirm Add/remove edges / Split at edge boundary buttons are hidden for it.

---
