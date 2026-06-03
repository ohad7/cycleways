# Mobile map gesture intent disambiguation

Date: 2026-06-01
Status: approved, implementing

## Problem

On the iPhone app the map is "too sensitive": touches meant to **add a point**
or **pan** are frequently misinterpreted as **moving an existing point**. The
gesture logic in `apps/mobile/src/MapScreen.jsx` was tuned for a mouse (precise
pointer, hover, distinct click-on-marker) and those constants do not translate
to a fingertip.

### Root causes (current behaviour)

All disambiguation lives in one `PanResponder` wrapping the map (lines ~264-396)
plus the MapView `onPress`:

1. **28 px hit radius** — anything within 28 px of a ~4-5 px dot is captured for
   select/move, so taps and pans *near* a point get stolen.
2. **Claim + pan-kill at touch-down** — `onStartShouldSetPanResponder` claims the
   gesture the instant a touch lands near a point and sets
   `scrollEnabled={!pointGestureActive}`, so a pan that merely *begins* near a
   point cannot pan; it is locked into point mode.
3. **6 px move threshold** — normal finger jitter crosses it, turning a touch
   near a point into a drag almost immediately.
4. **No multi-touch guard** — a pinch whose first finger lands near a point is
   claimed as a point gesture, breaking zoom near points.
5. **Cannot add near a point** — the capture + 350 ms add-guard always win.

## Approach (chosen)

Moving a point requires a deliberate **long-press to pick it up**, then drag.
This eliminates accidental moves and frees taps/pans/zoom near points. Combined
with a tighter hit radius and a multi-touch guard so pinch is never captured.

(An earlier iteration kept immediate-drag with tightened thresholds; we pivoted
to long-press because it removes accidental moves more decisively.)

## Intent decision rules

Evaluated in `routePointPanResponder` (single finger unless noted):

- **Touch-down, 2+ fingers** → do not claim → Mapbox handles pinch zoom/rotate.
- **Touch-down, 1 finger within `POINT_HIT_RADIUS` of a committed point** → claim
  as a point candidate and start a `LONG_PRESS_MS` timer.
- **Touch-down, 1 finger ≥ `POINT_HIT_RADIUS` from every point** → do not claim →
  MapView pans, or on release `onPress` adds a point.
- **Long-press timer fires (finger still down, < `LONG_PRESS_MAX_DRIFT` drift)** →
  pick the point up (`handleRoutePointDragStart`; drag-preview halo = feedback).
- **Picked up, finger moves** → `handleRoutePointDrag` (point follows finger).
- **Drift ≥ `LONG_PRESS_MAX_DRIFT` before pick-up** → cancel the candidate (a
  drag that began on a dot without holding does nothing; start off-dot to pan).
- **A second finger arrives before pick-up** → abort so Mapbox can pinch.
- **Release before pick-up, minimal movement** → `handleRoutePointSelect` (tap).
- **Release after pick-up** → `handleRoutePointDragEnd`.

## Parameters

Centralised as named constants for easy on-device tuning:

| Constant | Value |
|---|---|
| `POINT_HIT_RADIUS` | **18** (was 28) |
| `LONG_PRESS_MS` | **300** |
| `LONG_PRESS_MAX_DRIFT` | **12** |
| `ADD_GUARD_MS` | 350 (unchanged) |

## Intent legibility

When a move begins, the existing route-drag preview (halo + dashed line via
`routePointDragPreview` / `DRAG_PREVIEW_HALO_STYLE`) renders at the grabbed
point, giving immediate "you picked this up" feedback. Visual only — no haptics,
no new dependency.

## Outcome by intent

| Intent | After |
|---|---|
| Add | Tapping ≥18 px from dots adds, even close to existing points |
| Move | Must touch within 18 px *and* drag ≥13 px — deliberate |
| Pan | Only suppressed when the touch starts within 18 px of a dot |
| Zoom | Multi-touch always passes through to Mapbox |

## Out of scope (YAGNI)

Long-press pickup, two-step select-then-drag, route-line insert-drag on mobile.

## Testing

Primarily a manual on-device matrix (Maestro cannot do precise drags):

1. Tap empty map → adds a point.
2. Tap near (not on) an existing point → adds a point (not select/move).
3. Long-press a dot (~300 ms) then drag → moves it.
4. Touch a dot + quick release → selects it.
5. Drag starting on a dot without holding → no move (start off-dot to pan).
6. Drag starting off any dot → pans.
7. Pinch with a finger near a dot → zooms (no accidental move/select).
