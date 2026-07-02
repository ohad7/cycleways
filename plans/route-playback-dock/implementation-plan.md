# Usable three-up route-playback layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the route player usable on mobile web and iOS by showing the map + player + a full interactive elevation graph at once (partial-height panel over a full-bleed map), wiring bidirectional elevation⇄player⇄route sync on iOS, and removing the iOS auto-firing direction animation.

**Architecture:** The map is a full-bleed layer; the planner bottom panel overlays its lower part at a partial snap with the playback area (player + elevation) at the top. One shared playback-engine cursor drives the map marker, the player readout, and the elevation graph cursor; scrubbing the elevation seeks the engine. iOS stops auto-firing the route-direction animator and drives everything from the playback cursor (as web already does).

**Tech Stack:** React 19 (web), React Native / Expo + `@gorhom/bottom-sheet` + `@rnmapbox/maps` (iOS), shared `@cycleways/core`, Node `assert` tests via `npm test`.

## Global Constraints

- Scope is **mobile web + iOS only**. Desktop web and featured-route playback (`RouteMapPlayback`, `VideoEmbed`) must not change behavior.
- The map is **full-bleed and never resized**; the panel overlays its lower portion. Keeping the animated route visible while the panel is up is a **camera-padding** concern, not a layout-resize concern.
- One cursor source: the shared playback engine (`@cycleways/core/ui/routePlaybackEngine.js`). Its `cursor.fraction` drives every cursor; scrubbing any control calls `seekToFraction`.
- Hebrew UI copy unchanged. New tests appended to the root `package.json` `"test"` chain.
- Do not hand-edit `public-data/` or `data/`.
- **Out of scope (separate follow-on plan):** replacing the iOS playback marker with web's `progress-head-pulse` video-cursor. This plan keeps the existing iOS marker (a single playback-driven dot); it becomes correct and synchronized here, just not yet the pulsing-head visual. Recorded in `plans/route-playback-dock/follow-ups.md`.

---

## File Structure

Shared (`packages/core/src`):
- `ui/playbackReadout.js` — **new**, `formatPlaybackTime(seconds)` (single source for the `m:ss` readout used by both controls).

Web (`src`):
- `components/featured/RoutePlaybackControls.jsx` — adopt the shared time formatter.
- `App.jsx` — snap the sheet to `"half"` on play.

Mobile (`apps/mobile/src`):
- `planner/PlaybackControls.jsx` — adopt the shared time formatter.
- `MapScreen.jsx` — reorder the build panel (playback area to top), disable the direction animator, drive the elevation chart from the playback cursor, auto-snap the sheet on play, sheet-aware camera padding.
- `planner/PlannerSheet.jsx` — accept a controlled/imperative snap so play can dock it at the partial height.
- `ElevationProfileChart.jsx` — playback-driven cursor + scrub-to-seek (replace the direction-animator wiring).

Tests (`tests/`):
- `test-playback-readout.mjs` (new).

---

# Phase A — Three-up partial-height layout

### Task A1: Shared playback time formatter

**Files:**
- Create: `packages/core/src/ui/playbackReadout.js`
- Test: `tests/test-playback-readout.mjs` (create)
- Modify: `package.json` (append test)
- Modify: `apps/mobile/src/planner/PlaybackControls.jsx`, `src/components/featured/RoutePlaybackControls.jsx`

**Interfaces:**
- Produces: `formatPlaybackTime(seconds) -> string` → `m:ss` (e.g. `0` → `"0:00"`, `95` → `"1:35"`), clamps non-finite/negative to `0:00`.

- [ ] **Step 1: Write the failing test**

Create `tests/test-playback-readout.mjs`:

```js
import assert from "node:assert/strict";
import { formatPlaybackTime } from "@cycleways/core/ui/playbackReadout.js";

assert.equal(formatPlaybackTime(0), "0:00");
assert.equal(formatPlaybackTime(9), "0:09");
assert.equal(formatPlaybackTime(95), "1:35");
assert.equal(formatPlaybackTime(600), "10:00");
assert.equal(formatPlaybackTime(-5), "0:00");
assert.equal(formatPlaybackTime(NaN), "0:00");
assert.equal(formatPlaybackTime(undefined), "0:00");
console.log("test-playback-readout: OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-playback-readout.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the formatter**

Create `packages/core/src/ui/playbackReadout.js`:

```js
// Single source for the m:ss playback readout used by the web and native
// playback controls.
export function formatPlaybackTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-playback-readout.mjs`
Expected: `test-playback-readout: OK`

- [ ] **Step 5: Adopt in both controls**

In `apps/mobile/src/planner/PlaybackControls.jsx`, delete the local `formatTime` function and import the shared one:

```js
import { formatPlaybackTime as formatTime } from "@cycleways/core/ui/playbackReadout.js";
```

In `src/components/featured/RoutePlaybackControls.jsx`, replace the body of its local `formatTime` so it delegates (keep the name to avoid touching call sites):

```js
import { formatPlaybackTime } from "@cycleways/core/ui/playbackReadout.js";
// ...
function formatTime(totalSeconds) {
  return formatPlaybackTime(totalSeconds);
}
```

(If `RoutePlaybackControls.jsx` has no standalone `formatTime`, add the import and replace inline `formatTime(...)` calls with `formatPlaybackTime(...)`. Do not change `formatDistance` there.)

- [ ] **Step 6: Register test + verify the featured tests still pass**

Append ` && node tests/test-playback-readout.mjs` to the `"test"` script after `node tests/test-route-playback-engine.mjs`.
Run: `node tests/test-playback-readout.mjs && node tests/test-video-sync.mjs`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/ui/playbackReadout.js tests/test-playback-readout.mjs package.json apps/mobile/src/planner/PlaybackControls.jsx src/components/featured/RoutePlaybackControls.jsx
git commit -m "feat(core): shared formatPlaybackTime adopted by web + native controls"
```

---

### Task A2: iOS — playback area (elevation + player) at the top of the build panel

**Files:**
- Modify: `apps/mobile/src/MapScreen.jsx` (`BuildPanelContent`)

**Interfaces:**
- Consumes: existing `ElevationProfileChart`, `PlaybackControls`, `playback`, `onSeekToFraction`, `hasElevationProfile`, `canDownload` already in `BuildPanelContent`.

Context: today `BuildPanelContent` renders stats → warnings → location → `ElevationProfileChart` → `RoutePoiList` → (`canDownload`: `PlaybackControls` + actions + nav CTA). The player sits **below** the POIs (`apps/mobile/src/MapScreen.jsx:1213`), and at the partial sheet height the user can't see the playback area. Move the **playback area** (elevation graph + player) to the **top** of the panel body, above the stats/warnings/POIs.

- [ ] **Step 1: Extract the playback area to the top**

In `BuildPanelContent`'s returned JSX, immediately after the opening scroll container / route message and **before** the stats grid, render the playback area when a route exists:

```jsx
{hasElevationProfile ? (
  <View testID="playback-area">
    <PlaybackControls
      isPlaying={playback.isPlaying}
      isReady={playback.isReady}
      currentTime={playback.currentTime}
      duration={playback.duration}
      onTogglePlayback={playback.togglePlayback}
      onSeekToFraction={onSeekToFraction}
    />
    <ElevationProfileChart
      cursorFraction={playback.cursor?.fraction ?? null}
      onSeekFraction={onSeekToFraction}
      distance={routeState.distance}
      geometry={routeState.geometry}
    />
  </View>
) : null}
```

(`ElevationProfileChart`'s new `cursorFraction`/`onSeekFraction` props are implemented in Task B2. Until B2 lands, the chart ignores unknown props and renders without a live cursor — acceptable mid-plan; A2 and B2 are sequential.)

- [ ] **Step 2: Remove the old lower placements**

Delete the previous `ElevationProfileChart` block (the one passing `animator`/`onScrub`, `MapScreen.jsx:1202-1209`) and the `PlaybackControls` element inside the `canDownload` block (`MapScreen.jsx:1213-1221`). Keep `RoutePoiList`, the actions row, and the "התחל ניווט" CTA where they are (below).

- [ ] **Step 3: Verify the Expo bundle builds**

Run: `cd apps/mobile && npx expo export --platform ios --output-dir /tmp/rn-a2-check`
Expected: builds cleanly. Statically confirm the playback area now renders above the stats/POIs and only once.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): move playback area (player + elevation) to top of build panel"
```

---

### Task A3: iOS — controlled sheet snap + auto-dock to partial height on play

**Files:**
- Modify: `apps/mobile/src/planner/PlannerSheet.jsx`
- Modify: `apps/mobile/src/MapScreen.jsx`

**Interfaces:**
- Produces (PlannerSheet): new optional prop `sheetRef` forwarded to the underlying `BottomSheet` so the parent can call `sheetRef.current.snapToIndex(1)`.
- Consumes: `playback.isPlaying` in `MapScreen`.

Context: `PlannerSheet` keeps its `BottomSheet` ref internal (`apps/mobile/src/planner/PlannerSheet.jsx:15`), snap points `["16%","48%","92%"]`. Index 1 (48%) is the partial height that shows the top of the panel while leaving the upper map uncovered.

- [ ] **Step 1: Forward a ref from PlannerSheet**

In `PlannerSheet.jsx`, accept `sheetRef` and pass it to `BottomSheet` (replace the internal `ref={ref}` with the forwarded one, falling back to the internal ref):

```jsx
export default function PlannerSheet({
  panelState,
  onPanelStateChange,
  discover,
  build,
  sheetRef,
}) {
  const innerRef = useRef(null);
  const ref = sheetRef || innerRef;
  // ...
  return (
    <BottomSheet
      ref={ref}
      index={1}
      snapPoints={snapPoints}
      ...
```

- [ ] **Step 2: Snap to partial height when playback starts**

In `MapScreen`, create a sheet ref and pass it to `PlannerSheet` (`sheetRef={plannerSheetRef}`). Add an effect that docks the sheet to the partial snap when playback begins:

```js
const plannerSheetRef = useRef(null);
useEffect(() => {
  if (playback.isPlaying) {
    plannerSheetRef.current?.snapToIndex?.(1);
  }
}, [playback.isPlaying]);
```

- [ ] **Step 3: Verify**

Run: `cd apps/mobile && npx expo export --platform ios --output-dir /tmp/rn-a3-check`
Expected: builds. Statically confirm `sheetRef` is forwarded and the play effect calls `snapToIndex(1)`.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/planner/PlannerSheet.jsx apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): dock planner sheet to partial height on play"
```

---

### Task A4: iOS — sheet-aware camera padding so the route stays framed above the panel

**Files:**
- Modify: `apps/mobile/src/MapScreen.jsx`

**Interfaces:**
- Consumes: `fitCameraToPoints(camera, points)` (`MapScreen.jsx:1646`), which currently fits with a fixed padding `[96, 42, 84, 42]` (`MapScreen.jsx:1674`).

Context: with the panel docked at ~48% height, a fixed bottom padding hides the lower route behind the panel. Increase the **bottom** padding so the route is framed into the uncovered upper area while previewing.

- [ ] **Step 1: Parameterize the bottom padding**

Change `fitCameraToPoints` to accept an optional bottom padding:

```js
function fitCameraToPoints(camera, points, bottomPadding = 84) {
  // ...
  camera.fitBounds?.([east, north], [west, south], [96, 42, bottomPadding, 42], 550);
}
```

- [ ] **Step 2: Pass a taller bottom padding while the playback panel is docked**

At the `fitRoute` callback and the `routeFitRequest` effect (`MapScreen.jsx:791-803`), pass a larger bottom padding when `mapPresentationActive` (the build/preview state). Use a constant near the other consts:

```js
const PLAYBACK_FIT_BOTTOM_PADDING = 340; // ~ sheet partial height in px
```

and at each `fitCameraToPoints(...)` call inside the planner/preview path:

```js
fitCameraToPoints(
  cameraRef.current,
  geometry,
  mapPresentationActive ? PLAYBACK_FIT_BOTTOM_PADDING : 84,
);
```

- [ ] **Step 3: Verify**

Run: `cd apps/mobile && npx expo export --platform ios --output-dir /tmp/rn-a4-check`
Expected: builds. Statically confirm the planner fit calls pass the larger bottom padding when `mapPresentationActive`.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): pad camera above the docked playback panel"
```

---

### Task A5: Web — dock the sheet to the partial height on play

**Files:**
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `setSheetSnap` (`src/App.jsx:236`, values `"peek"`/`"half"`), `plannerPlayback.isPlaying`, `isMobileSheet`.

Context: web already renders the elevation graph and the playback control in the build panel and as a map overlay; the complaint is that the drawer covers the player and you can't see all three. On the mobile sheet, dock to `"half"` when playback starts so the playback area + a slice of map show together (the panel content already has the playback area near the top).

- [ ] **Step 1: Snap to half on play**

In `App.jsx`, add an effect:

```js
useEffect(() => {
  if (isMobileSheet && plannerPlayback.isPlaying) {
    setSheetSnap("half");
  }
}, [isMobileSheet, plannerPlayback.isPlaying]);
```

- [ ] **Step 2: Verify the playback area is at the top of the panel at "half"**

Run: `npm run dev`, narrow the viewport to the mobile sheet, build a route, press play. Confirm: the sheet docks to "half", the player + elevation graph are visible, and the map (with the moving cursor) is visible above. If the playback area is below the fold at "half", move the `playback`/`elevation` slots above the POIs in `BuildPanel.jsx` (they already precede POIs — confirm) so they fall within the "half" viewport.

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat(web): dock mobile sheet to half height on planner play"
```

---

# Phase B — iOS bidirectional sync + remove auto-play

### Task B1: iOS — disable the auto-firing route-direction animator

**Files:**
- Modify: `apps/mobile/src/MapScreen.jsx`

**Interfaces:**
- Consumes: `useCyclewaysApp({ enableRouteDirectionAnimation })` (`packages/core/src/app/useCyclewaysApp.js:89-90`). With the flag false, `directionAnimatorRef.current` stays `null` and `animator.trigger(...)` (the auto-fire at `useCyclewaysApp.js:393`) never runs.

Context: opening a route currently auto-fires the direction-chevron (reads as "auto-play"). Disable it for the native app and remove the now-dead animator wiring.

- [ ] **Step 1: Pass the flag**

At `MapScreen.jsx:278`, change `} = useCyclewaysApp();` to:

```js
} = useCyclewaysApp({ enableRouteDirectionAnimation: false });
```

- [ ] **Step 2: Remove the direction-pulse map layer**

`directionAnimatorRef.current` is now `null`. Remove the `<RouteDirectionPulseLayer animator={directionAnimatorRef.current} ... />` element (`MapScreen.jsx:922-925`) and its `RouteDirectionPulseLayer` component definition + the `buildRouteDirectionPulseFeatureCollection` import if no longer referenced (grep first). Keep `ROUTE_DIRECTION_PULSE_*` style imports only if still used elsewhere; otherwise remove.

- [ ] **Step 3: Verify the bundle builds and nothing references the animator**

Run: `cd apps/mobile && grep -n "directionAnimator\|RouteDirectionPulseLayer\|buildRouteDirectionPulse" src/MapScreen.jsx`
Expected: the only remaining references are the destructured `directionAnimatorRef` from `useCyclewaysApp` (now unused — remove it from the destructure too) and the `ElevationProfileChart`'s `animator` prop (handled in B2). Then `npx expo export --platform ios --output-dir /tmp/rn-b1-check` builds cleanly.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): disable auto-firing route-direction animation"
```

---

### Task B2: iOS — playback-driven elevation chart (bidirectional sync)

**Files:**
- Modify: `apps/mobile/src/ElevationProfileChart.jsx`
- Modify: `apps/mobile/src/MapScreen.jsx` (already passes `cursorFraction`/`onSeekFraction` from Task A2)

**Interfaces:**
- Produces (`ElevationProfileChart`): new props `cursorFraction: number|null` (0..1 playback position) and `onSeekFraction: (fraction:number) => void`. Removes `animator` and `onScrub`.
- Consumes: `playback.cursor?.fraction` and `playback.seekToFraction` (via `onSeekToFraction`) from `MapScreen`.

Context: the chart currently subscribes to the direction `animator`'s `"elevation"` channel for its marker and calls `onScrub` on drag. Re-point it to the playback engine: the marker reflects `cursorFraction`; dragging seeks the engine.

- [ ] **Step 1: Replace the animator subscription with `cursorFraction`**

In `ElevationProfileChart.jsx`, change the signature to `{ cursorFraction, onSeekFraction, distance, geometry }`. Delete the `animator` `useEffect` and the `animatorMarkerX` state / `animatorMarkerEnabledRef`. Derive the marker from props:

```js
const [hoverX, setHoverX] = useState(null);
// marker: while dragging, follow the finger (hoverX); otherwise follow playback.
const markerX = hoverX != null
  ? hoverX
  : Number.isFinite(cursorFraction) ? cursorFraction * 100 : null;
```

Replace the old `const markerX = hoverInfo ? hoverInfo.t * 100 : animatorMarkerX;` accordingly, and render the marker `<Line>` when `Number.isFinite(markerX)`.

- [ ] **Step 2: Seek the engine on drag**

In the `panResponder` `update`, compute the fraction and seek; track `hoverX` for the live marker:

```js
function update(evt) {
  if (!profile) return;
  const width = widthRef.current || 1;
  const xPercent = Math.max(0, Math.min(100, (evt.nativeEvent.locationX / width) * 100));
  setHoverX(xPercent);
  onSeekFraction?.(xPercent / 100);
  const point = findClosestElevationPoint(profile.elevationData, xPercent);
  const payload = buildElevationHoverPayload(point);
  if (payload) setHoverInfo(payload);
}
function clear() {
  setHoverX(null);
  setHoverInfo(null);
}
```

Keep `hoverInfo` only for the on-chart tooltip text (grade/elevation). Remove the `onScrub?.(...)` calls and the `geometry`-change effect's `onScrub?.(null)` (replace with `setHoverX(null); setHoverInfo(null);`).

- [ ] **Step 3: Confirm the geometry-reset effect no longer references removed state**

The effect that ran on `[geometry, onScrub]` must now be `[geometry]` and only reset local hover state. Verify no remaining references to `animator`, `onScrub`, `animatorMarkerX`, or `animatorMarkerEnabledRef`.

- [ ] **Step 4: Verify build + the existing elevation tests**

Run: `node tests/test-elevation-profile.mjs && node tests/test-elevation-cursor.mjs`
Then `cd apps/mobile && npx expo export --platform ios --output-dir /tmp/rn-b2-check`
Expected: tests pass (they cover the shared `elevationProfile` builder, unchanged); bundle builds.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/ElevationProfileChart.jsx apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): elevation chart driven by playback cursor with scrub-to-seek"
```

---

### Task B3: iOS — single playback-driven map marker; cleanup

**Files:**
- Modify: `apps/mobile/src/MapScreen.jsx`

**Interfaces:**
- Consumes: `playback` (`useSyntheticRoutePlaybackEngine`), `setScrubPoint`, `scrubMarker`.

Context: the map marker (`scrubMarker` → `ELEVATION_SCRUB_STYLE`) is already driven by `playback.onCursorChange → setScrubPoint` (from the prior branch). With B1/B2 done, this is now the **only** moving marker and it stays in sync with the player and the elevation graph. Confirm and remove any dead wiring.

- [ ] **Step 1: Confirm the marker source**

Verify `setScrubPoint` is fed only by the playback `onCursorChange` (and cleared when `!mapPresentationActive`). Remove any remaining `onScrub={setScrubPoint}` prop now that `ElevationProfileChart` no longer takes `onScrub`. The `scrubMarker`/`ELEVATION_SCRUB_STYLE` layer stays (this plan keeps the dot; the pulse cursor is the follow-on plan).

- [ ] **Step 2: Verify build + a manual three-way sync check**

Run: `cd apps/mobile && npx expo export --platform ios --output-dir /tmp/rn-b3-check` (builds).
On a simulator (if available): build a route → no auto-animation on open; press play → the dot travels the route, the player readout advances, and the elevation cursor tracks it; drag the elevation graph → the player, readout, and dot follow. Report whichever verification was possible.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): single playback-driven map marker; remove dead scrub wiring"
```

---

## Self-Review

**Spec coverage:**
- Three views at once / partial-height panel (design §A) → A2 (panel order), A3 (auto-dock partial), A4 (camera padding), A5 (web dock). ✓
- Map full-bleed, never resized; camera padding (design §A camera framing) → A4 (iOS), web already overlay-based. ✓
- Bidirectional elevation⇄player⇄route sync (design §A2) → B2 (elevation→seek + cursor), B3 (single synced marker); web already has it. ✓
- iOS remove auto-firing direction animation (design §B) → B1. ✓
- Shared "one source" for the playback area (design §C) → A1 (shared readout formatter adopted by both controls). The fuller shared view-model was scoped down to the readout (YAGNI: the engine already exposes cursor/time/duration); noted as a deliberate reduction. ✓
- iOS `progress-head-pulse` web-parity marker (design §B animation) → **deliberately split** into a follow-on plan (see Global Constraints / follow-ups); this plan keeps the synced dot. ✓ (documented gap, not an omission)

**Placeholder scan:** No "TBD"/vague steps. The one cross-task dependency (A2 renders `cursorFraction`/`onSeekFraction` before B2 implements them) is called out explicitly and is safe (RN ignores unknown props). ✓

**Type consistency:** `formatPlaybackTime(seconds)→string` used in A1 by both controls. `ElevationProfileChart` new props `{ cursorFraction, onSeekFraction, distance, geometry }` defined in B2 and passed in A2. `PlannerSheet` new prop `sheetRef`; `MapScreen` `plannerSheetRef` calls `snapToIndex(1)`. `fitCameraToPoints(camera, points, bottomPadding=84)` consistent across A4 call sites. ✓
