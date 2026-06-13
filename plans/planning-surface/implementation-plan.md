# Mobile-Build Touch Repair Implementation Plan (planning-surface D4, roadmap step 2b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-06-11
**Design:** [design.md](design.md) — D4: minimal mobile-Build repair (tap-to-select point removal, drag slop threshold). Mobile Build is otherwise feature-frozen.

**Goal:** A touch user can remove a single route point (tap point → floating "הסר נקודה" pill), and touching a point no longer hijacks map panning — a drag only begins after a 6-pixel movement, exactly like the existing route-line drag.

**Architecture:** `MapSurface`'s point-drag handlers move from "drag starts on touch/mousedown" to the pending→activate pattern already used by `startRouteLineDrag` (record start point, disable pan, activate only past the slop threshold, treat a no-move release as a tap-select). The existing `selectedRoutePointIndex` state (set on point click today) drives a new `RoutePointActions` overlay pill in `App.jsx` with remove/dismiss actions wired to existing handlers. No new core state.

**Tech Stack:** Mapbox GL event handlers in `src/map/MapSurface.jsx`, React overlay component, existing `mapUi.selectedRoutePointIndex` / `handleRoutePointRemove` / `handleRoutePointSelect` from `useCyclewaysApp`.

**Execution note:** Same branch as `plans/discovery-surface/implementation-plan-locate-me.md` (run that plan first). The drag-slop refactor is not unit-testable (canvas gestures; the e2e mapbox mock records no gestures) — correctness is covered by the unchanged node suite, the existing e2e staying green, and the real-browser smoke in Task 3. Known pre-existing e2e failures: `routes-index.spec.mjs:8`, `:114`, `featured-index.spec.mjs:37`, `react-migration-smoke.spec.mjs:81`.

---

### Task 1: Drag slop for route points in MapSurface

**Files:**
- Modify: `src/map/MapSurface.jsx` (the editing effect, ~lines 703–880)

Today `startDrag` (~line 720) sets `draggingPointRef.current = pointIndex`, disables pan, and fires `onRoutePointDragStart` immediately on `mousedown`/`touchstart`. The route-line path (`startRouteLineDrag`, ~line 731) already does this right: it records `{ insertIndex, startPoint, active: false }`, and `moveDrag` activates it only when `screenPointDistance(event.point, startPoint) >= 6`.

- [ ] **Step 1: Read the whole editing effect first**

Read `src/map/MapSurface.jsx` lines ~700–880 end to end. `draggingPointRef` is consulted in: `startRouteLineDrag` (guard), `moveDrag`, `endDrag`, `enterPoint`/`leavePoint`, `enterRouteLine`/`leaveRouteLine`. Every consultation must be updated coherently with the new shape.

- [ ] **Step 2: Restructure the point-drag state**

Replace the integer-or-null `draggingPointRef` usage inside this effect with a pending-drag object (keep the same ref, change its contents):

```js
    // Point drags activate only past the slop threshold, so a touch that's
    // really a tap (select) or a wobbly pan start doesn't move the point.
    // Mirrors the routeLineDrag pending→active pattern below.
    const POINT_DRAG_SLOP_PX = 6;

    const startDrag = (event) => {
      const pointIndex = getPointIndex(event);
      if (!Number.isInteger(pointIndex)) return;

      event.preventDefault?.();
      draggingPointRef.current = {
        index: pointIndex,
        startPoint: event.point,
        active: false,
      };
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grab";
    };
```

In `moveDrag`, replace the current integer branch:

```js
    const moveDrag = (event) => {
      const pointDrag = draggingPointRef.current;
      if (pointDrag) {
        if (!pointDrag.active) {
          const movedPixels = screenPointDistance(event.point, pointDrag.startPoint);
          if (movedPixels < POINT_DRAG_SLOP_PX) return;
          pointDrag.active = true;
          map.getCanvas().style.cursor = "grabbing";
          callbacksRef.current.onRoutePointDragStart?.(pointDrag.index);
        }
        callbacksRef.current.onRoutePointDrag?.(pointDrag.index, {
          lng: event.lngLat.lng,
          lat: event.lngLat.lat,
        });
        return;
      }
      // ... routeLineDrag branch unchanged ...
    };
```

In `endDrag`, replace the integer branch:

```js
    const endDrag = () => {
      const pointDrag = draggingPointRef.current;
      const routeLineDrag = routeLineDragRef.current;

      if (pointDrag) {
        draggingPointRef.current = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = "";
        if (pointDrag.active) {
          callbacksRef.current.onRoutePointDragEnd?.(pointDrag.index);
        } else {
          // A no-move release is a tap: select the point. Idempotent with the
          // layer click handler, which also fires on genuine clicks/taps.
          callbacksRef.current.onRoutePointSelect?.(pointDrag.index);
        }
        return;
      }
      // ... routeLineDrag branch unchanged ...
    };
```

Update the remaining consultations of `draggingPointRef.current`:
- `startRouteLineDrag` guard: `if (draggingPointRef.current !== null || routeLineDragRef.current) return;` — still correct (object is truthy), keep as `!== null`.
- `leavePoint` (~line 824): change `if (!Number.isInteger(draggingPointRef.current))` to `if (!draggingPointRef.current)`.
- `enterRouteLine`/`leaveRouteLine` (~lines 830–840): change `!Number.isInteger(draggingPointRef.current)` to `!draggingPointRef.current` in both.
- Search the WHOLE file for any other `draggingPointRef` reads (e.g., other effects or cleanup) and update them to the object shape. `git grep -n "draggingPointRef" src/map/MapSurface.jsx` must list only lines you have reconciled.

Important behavior note: `onRoutePointDragStart` now fires on the first slop-exceeding move rather than on press. The undo snapshot in `useCyclewaysApp` (`dragStartSnapshotRef`, set by `handleRoutePointDragStart`) is taken before the first `onRoutePointDrag` mutation either way — the invariant holds because activation fires DragStart strictly before the first Drag callback in the same handler.

- [ ] **Step 3: Verify the suites still pass**

Run: `node tests/test-map-interactions.mjs && npm test 2>&1 | tail -4`
Expected: green.

Run: `npx playwright test tests/e2e/front-panel.spec.mjs tests/e2e/discover-route-select.spec.mjs tests/e2e/react-migration-smoke.spec.mjs --project=desktop 2>&1 | tail -4`
Expected: same as before the change (react-migration-smoke:81 pre-existing failure only). The smoke spec exercises real point interactions under the mock-free production path — read any new failure carefully; do not loosen specs.

- [ ] **Step 4: Commit**

```bash
git add src/map/MapSurface.jsx
git commit -m "fix(map): route-point drags activate past a slop threshold; tap selects"
```

---

### Task 2: RoutePointActions pill (remove a selected point)

**Files:**
- Create: `src/components/RoutePointActions.jsx`
- Modify: `src/App.jsx` (render inside `.map-container`; extend `plannerFitRegistry`)
- Modify: `src/react-app.css` (pill styles)

- [ ] **Step 1: Create the component**

Create `src/components/RoutePointActions.jsx`:

```jsx
import React from "react";
import Icon from "./Icon.jsx";

// Floating actions for the selected route point: shown whenever a point is
// selected (tap on touch, click on desktop). Gives touch users a way to
// remove a single point — desktop right-click removal still works.
export default function RoutePointActions({
  selectedIndex,
  pointCount,
  onRemove,
  onDismiss,
}) {
  if (!Number.isInteger(selectedIndex)) return null;
  return (
    <div className="route-point-actions" role="toolbar" aria-label="פעולות נקודת מסלול">
      <span className="route-point-actions__label">
        נקודה {selectedIndex + 1} מתוך {pointCount}
      </span>
      <button
        type="button"
        className="route-point-actions__remove"
        onClick={onRemove}
      >
        <Icon name="trash-outline" /> הסר נקודה
      </button>
      <button
        type="button"
        className="route-point-actions__dismiss"
        aria-label="ביטול בחירה"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
```

(`trash-outline` already exists in `src/components/Icon.jsx` — it's used by the Build panel's clear button. Verify the exact key name there.)

- [ ] **Step 2: Render it in App.jsx**

Import it:

```js
import RoutePointActions from "./components/RoutePointActions.jsx";
```

Inside the `.map-container` div's `state.status === "ready"` fragment (a good spot is right after `<SegmentNameDisplay ... />`), add:

```jsx
                <RoutePointActions
                  selectedIndex={mapUi.selectedRoutePointIndex}
                  pointCount={routeState.points.length}
                  onRemove={() => {
                    handlePlaybackAwareRoutePointRemove(mapUi.selectedRoutePointIndex);
                    handleRoutePointSelect(null);
                  }}
                  onDismiss={() => handleRoutePointSelect(null)}
                />
```

`handleRoutePointSelect` is already destructured from `useCyclewaysApp` in App.jsx (it's passed to MapView as `onRoutePointSelect`); calling it with `null` clears `mapUi.selectedRoutePointIndex` (the hook stores the value verbatim, and its bounds-check effect tolerates null).

Add the pill to the overlay-aware fit registry — in `plannerFitRegistry` (~line 218), add one entry:

```js
    { selector: ".route-point-actions", side: "bottom" },
```

- [ ] **Step 3: Pill CSS**

Append to `src/react-app.css`:

```css
.route-point-actions {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 12;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid #e7dfca;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 4px 14px rgb(40 48 38 / 18%);
  font-size: 0.9rem;
}

.route-point-actions__label {
  color: #52615c;
  font-weight: 600;
  white-space: nowrap;
}

.route-point-actions__remove {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  border-radius: 999px;
  background: #c0392b;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.route-point-actions__dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #52615c;
  font-size: 1.1rem;
  cursor: pointer;
}

@media (max-width: 768px) {
  /* Sit above the playback transport when a route is ready. */
  .map-container--route-ready .route-point-actions {
    bottom: 74px;
  }
}
```

(The playback transport `.planner-route-playback` is bottom-anchored — check its mobile offsets in `react-app.css` (~line 1485) and adjust the 74px so the two don't overlap.)

- [ ] **Step 4: Verify + commit**

Run: `npx playwright test tests/e2e/front-panel.spec.mjs tests/e2e/discover-route-select.spec.mjs --project=desktop --project=mobile 2>&1 | tail -3`
Expected: green.

```bash
git add src/components/RoutePointActions.jsx src/App.jsx src/react-app.css
git commit -m "feat(planner): floating remove/dismiss pill for the selected route point"
```

---

### Task 3: Verification (both step-2 plans)

- [ ] **Step 1: Full suites**

Run `npm test` → green. Run `npx playwright test --project=desktop --project=mobile 2>&1 | tail -12` → no NEW failures beyond the four known pre-existing ones.

- [ ] **Step 2: Real-browser smoke (no mapbox mock)**

Start the dev server (`npm run dev -- --port 5176`) and drive a real Chromium (Playwright script, pattern: launch chromium, `viewport 1440x900`):
1. Build a route with two map clicks; click the first route point → the pill appears reading "נקודה 1 מתוך 2"; click "הסר נקודה" → the point disappears and the pill closes.
2. Mobile context (iPhone 13 descriptor, `geolocation: {latitude: 33.2177, longitude: 35.6097}`, `permissions: ["geolocation"]`): tap the locate button → fix marker appears, Discover cards show "ממך" labels.
3. Mobile: with a built route (tap map twice), touch-drag across a route point starting ON the point but moving immediately — the map should pan only if the gesture started off-point; a gesture starting on the point past 6px must drag the point. Tap (no move) on a point → pill appears.
Take screenshots at each stage and LOOK at them.

- [ ] **Step 3: Hand off**

Use superpowers:finishing-a-development-branch (merge target: `claude/fable-ux-planning`).
