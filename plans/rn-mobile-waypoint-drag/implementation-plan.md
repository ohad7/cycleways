# Native Route Waypoint Drag Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or executing-plans. Steps use `- [x]` checkboxes.

**Goal:** Drag a route waypoint on the iPhone map to reshape the route, by wiring RNMapbox draggable `PointAnnotation`s to the shared `handleRoutePointDragStart/Drag/End` handlers.

**Architecture:** Replace the native `route-points` `ShapeSource`+`CircleLayer` with one draggable `PointAnnotation` per displayed route point. Drag callbacks call the existing shared handlers; the controller snapshots (undo), previews, and recomputes the route on release. No shared/web/core changes.

**Tech Stack:** React Native / Expo SDK 56, `@rnmapbox/maps` `PointAnnotation`, shared `useCyclewaysApp`.

Design: `plans/rn-mobile-waypoint-drag/design.md`.

---

## Verification guard

- `npm test` green, `npm run build` succeeds (web/shared untouched → zero behavior change).
- `npx expo export --platform ios --output-dir /tmp/isravelo-mobile-export-waypoint-drag` succeeds.
- Simulator (iPhone 15 / iOS 17.5, UDID `961E0C3E-338F-4311-BD0B-72C2BF47C03B`; Metro via `npm run mobile`): build a route, drag a waypoint, route reshapes + stats update, `ביטול` undo restores.

---

## Task 1: Render route points as draggable PointAnnotations

**Files:** `apps/mobile/src/MapScreen.jsx` only.

- [x] **Step 1: Import `PointAnnotation`.** In the `@rnmapbox/maps` import block (lines 13-22), add `PointAnnotation` to the named imports:

```jsx
import Mapbox, {
  Camera,
  CircleLayer,
  LineLayer,
  MapView,
  PointAnnotation,
  ShapeSource,
  UserLocation,
  UserLocationRenderMode,
  UserTrackingMode,
} from "@rnmapbox/maps";
```

- [x] **Step 2: Add a coordinate helper.** Near the other module-level helpers (e.g. above `function buildRoutePointFeatureCollection`), add:

```jsx
// RNMapbox PointAnnotation drag events carry the new coordinate on the feature
// geometry (shape differs slightly by version), so read defensively.
function coordFromAnnotationEvent(event) {
  const coords =
    event?.geometry?.coordinates ||
    event?.payload?.geometry?.coordinates ||
    event?.nativeEvent?.payload?.geometry?.coordinates ||
    null;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}
```

- [x] **Step 3: Pull the drag handlers from the controller.** In `MapScreen()`, the `useCyclewaysApp()` destructuring already lists `handleRoutePointSelect`, `handleRoutePointRemove`, etc. Add the three drag handlers:

```jsx
    handleRoutePointDragStart,
    handleRoutePointDrag,
    handleRoutePointDragEnd,
```

- [x] **Step 4: Replace the `route-points` layer with annotations.** Replace the whole block at lines ~408-415:

```jsx
        <ShapeSource
          id="route-points"
          shape={routePoints}
          hitbox={{ width: 50, height: 50 }}
          onPress={handleRoutePointPress}
        >
          <CircleLayer id="route-points-circle" style={ROUTE_POINT_STYLE} />
        </ShapeSource>
```

with:

```jsx
        {displayedRoutePoints.map((point, index) => {
          const lng = Number(point?.lng);
          const lat = Number(point?.lat);
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
          const lastIndex = displayedRoutePoints.length - 1;
          const endpoint =
            index === 0 ? "start" : index === lastIndex ? "end" : "middle";
          const selected = index === mapUi.selectedRoutePointIndex;
          const pending = Boolean(point.pending);
          return (
            <PointAnnotation
              // key includes style-affecting state (not coordinate) so the
              // annotation remounts on selection/role change — RNMapbox iOS
              // does not reliably re-render PointAnnotation children otherwise.
              key={`route-point-${index}-${endpoint}-${selected}-${pending}`}
              id={`route-point-${index}`}
              coordinate={[lng, lat]}
              draggable={!pending}
              onSelected={() => handleRoutePointSelect(index)}
              onDragStart={() => handleRoutePointDragStart(index)}
              onDrag={(e) => {
                const coord = coordFromAnnotationEvent(e);
                if (coord) handleRoutePointDrag(index, coord);
              }}
              onDragEnd={() => {
                handleRoutePointDragEnd();
              }}
            >
              <View
                style={[
                  styles.routePointDot,
                  styles[`routePointDot_${endpoint}`],
                  selected ? styles.routePointDotSelected : null,
                  pending ? styles.routePointDotPending : null,
                ]}
              />
            </PointAnnotation>
          );
        })}
```

- [x] **Step 5: Add the dot styles.** In the `StyleSheet.create({...})`, add (colors mirror the old `ROUTE_POINT_STYLE`):

```jsx
  routePointDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#ffffff",
    backgroundColor: "#2b7bb9",
  },
  routePointDot_start: { backgroundColor: "#18a957" },
  routePointDot_end: { backgroundColor: "#c84c45" },
  routePointDot_middle: { backgroundColor: "#2b7bb9" },
  routePointDotSelected: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderColor: "#0f2f4f",
  },
  routePointDotPending: { opacity: 0.45 },
```

- [x] **Step 6: Remove now-dead code (verify each is unused with grep first).** After Step 4, these become unused: the `routePoints` memo (lines ~161-168), `handleRoutePointPress` (the `useCallback` ~217-224 and its destructured `routePointPressGuardRef` usage if any), `buildRoutePointFeatureCollection`, and `ROUTE_POINT_STYLE`. For each, run `grep -n "<name>" apps/mobile/src/MapScreen.jsx` and delete only if the sole remaining reference is its own definition. If `handleRoutePointPress`/`routePointPressGuardRef` is still referenced by the map's `ShapeSource onPress` for any other layer, leave it. Do not remove `displayedRoutePoints` or `buildRouteGeometryFeatureCollection`.

- [x] **Step 7: Validate the bundle.** Run from `apps/mobile`: `npx expo export --platform ios --output-dir /tmp/isravelo-mobile-export-waypoint-drag 2>&1 | tail -8`. Expected: export succeeds, no import/syntax errors.

- [x] **Step 8: Commit (stage only MapScreen.jsx):**

```bash
git add apps/mobile/src/MapScreen.jsx
git commit -m "feat(mobile): drag route waypoints via RNMapbox PointAnnotation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Verify on simulator + web guard + docs

**Files:** `plans/HANDOFF.md`, `plans/rn-mobile-waypoint-drag/implementation-plan.md`.

- [x] **Step 1: Web guard (zero-change confirmation).** `npm test` (green), `npm run build` (succeeds). (No `test:smoke` needed — no web files changed; run it only if paranoid.)

- [ ] **Step 2: Simulator drag check — NOT CONFIRMED (see Verification below).** Automation panned the map instead of dragging (RNMapbox needs a long-press the tool can't send); needs a manual finger long-press-drag. With Metro running and the app launched: build a 2–3 point route (search `Kfar Blum` → add, `HaGoshrim` → add). Drag an endpoint/middle waypoint a short distance onto the network. Confirm: the route line + distance/stats update, then tap `ביטול` (undo) and confirm the route returns to its pre-drag shape. Capture `/tmp/waypoint-drag-before.png` and `/tmp/waypoint-drag-after.png`. (Drive the drag with a Maestro `swipe` starting on the waypoint's screen position; tune the start coords from the before-screenshot. Run one Maestro instance at a time.)

- [x] **Step 3: Update docs.** Add a Phase 2.11 DONE entry to `plans/HANDOFF.md` §4 (draggable waypoints, files touched, verification + screenshots) and append a Verification section here. Mark this plan's checkboxes.

- [x] **Step 4: Commit (stage only the docs):**

```bash
git add plans/HANDOFF.md plans/rn-mobile-waypoint-drag/implementation-plan.md
git commit -m "docs: record Phase 2.11 native waypoint drag verification

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes & Risks

- **RNMapbox `PointAnnotation` iOS quirks:** children don't reliably re-render on prop change — hence the `key` includes endpoint/selected/pending (but NOT coordinate, so dragging doesn't remount). If the dot color still doesn't update on selection, that key strategy is the fix.
- **Drag coordinate payload shape** varies across `@rnmapbox/maps` versions — `coordFromAnnotationEvent` reads several shapes; if drag does nothing, `console.log(JSON.stringify(e))` in `onDrag` once to confirm the path.
- **Pending points** are rendered as non-draggable, dimmed dots (transient during routing); no separate CircleLayer needed.
- `useCyclewaysApp` and all web code are untouched — the web guard is a regression check only.

---

## Verification (2026-05-31)

- **Code-complete + compiles + loads.** Route points render as draggable
  `PointAnnotation`s wired to `handleRoutePointDragStart/Drag/End`; tap-to-select
  preserved. `npx expo export --platform ios` clean; app reloads on the sim and
  builds a route with the new waypoint dots (`/tmp/wd-route-built.png`).
- No web/shared/core files changed → web guard unaffected (not re-run).
- **Interactive drag NOT yet confirmed via automation.** A Maestro `swipe`
  starting on a waypoint **panned the map** instead of moving the point
  (`/tmp/wd-after-drag.png`, route stayed 7.6 km). Root cause: RNMapbox iOS
  draggable annotations require a **long-press to pick up the pin** before
  dragging; Maestro's synthetic swipe has no long-press phase, so it reads as a
  map pan. **Needs a manual finger long-press-drag on the simulator/device to
  confirm the route reshapes + `ביטול` undo restores.** If a manual test shows
  the pin doesn't drag at all, fall back to a custom `PanResponder` drag
  (design Approach B).
- **Known dead code (trivial follow-up):** `ROUTE_POINT_STYLE`,
  `buildRoutePointFeatureCollection`, `routePointIndexFromPressEvent` in
  `MapScreen.jsx` are now orphaned (the old CircleLayer route-point path was
  removed) — safe to delete.
