# App Controller Hook (`useCyclewaysApp`) — Design

**Date:** 2026-05-29
**Status:** Approved (proceed-to-implement authorized by user)
**Branch:** `claude/iphone-app`

## Purpose

Final intermediate step toward sharing most React/JS code with a React Native
app (see [[iphone-app-direction]]). Extract `App.jsx`'s stateful orchestration —
the React *wiring* (reducer hookup, effects, handler callbacks, refs, derived
values) — into a platform-agnostic hook `useCyclewaysApp()`. `App.jsx` becomes a
thin **web view** that calls the hook and renders DOM/JSX from its return. A
future RN app calls the *same* hook and renders native UI on top of the
`MapSurface` contract + `src/platform` adapters. **Zero web behavior change.**

## Why this is now clean

Prior steps already made everything below the wiring shareable: the engine is an
importable module; route *logic* primitives live in `src/routing`
(`routeReducer`, `addPoint`, `removePoint`, `recalculatePoints`,
`buildShareInfo`, `createRouteManager`, `createShardedRouteSession`,
`applyRouteSnapshot`, …); browser location/storage are behind `src/platform`;
`src/components` have zero browser-API coupling. What remains in `App.jsx` is the
React wiring that ties these together — a hook is the right home for it.

## Structure of today's App.jsx

- **Main `App` component:** L64–1372. Body (state/refs/effects/handlers/derived)
  L65–1165; JSX `return` L1166–1372.
- **Sub-components + helpers (stay in App.jsx, unchanged):** `LoadingState`,
  `ErrorState`, `MapLegend`, `RouteDescription`, `RouteDescriptionText`,
  `OsmDebugLayerToggle`, `OsmMatchReviewPanel`, `SegmentNameDisplay`, and pure
  helpers (`routeStateFromSnapshot`, `clearRouteStateFields`,
  `addPendingRoutePoint`, `removePendingRoutePoint`, `routingShardFormat`,
  `getGeoJsonCoordinateBounds`, `snapRoutePointsToGeometryIndices`,
  `routePointsFromDragPreview`, `formatPercent`, etc.).

## Design

New file `src/app/useCyclewaysApp.js` exporting `useCyclewaysApp()`. Move the
**entire body** of `App` (L65–1165) into the hook verbatim — all `useState`,
`useReducer`, `useRef`, `useEffect`, `useCallback`, `useMemo`, and the pure
helpers it closes over that are defined inside the component (if any). The hook
ends with `return { … }` exposing exactly the interface the JSX consumes.
Imports the body needs (engine, `src/routing`, `src/platform`, `src/data`,
`src/map` layer helpers, `featureFlags`, `createRouteDirectionAnimator`, etc.)
move with it.

`App.jsx` becomes:

```jsx
export default function App() {
  const app = useCyclewaysApp();
  const { /* destructure the full interface below */ } = app;
  return ( /* the existing JSX, unchanged */ );
}
```

### Hook return interface (the shared contract)

State/derived:
`welcomeWizardOpen`, `setWelcomeWizardOpen`, `state`, `mapUi`, `routeState`,
`osmDebug`, `osmDebugLayerMode`, `selectedCwReviewSegmentId`,
`selectedCwReviewFeature`, `canUndo`, `canRedo`, `canDownload`,
`hasBrokenRoute`, `activeDataPointIds`, `dataMarkerFeatures`,
`routePointDragPreview`, `displayedRoutePoints`, `inspectedSegmentDetails`,
`inspectedSegment`, `inspectedOsmFeature`, `shareUrl`, `shareInfo`,
`featureFlags`, `directionAnimatorRef`.

Handlers:
`handleOpenTutorial`, `handleCloseTutorial`, `handleSearchSubmit`,
`handleSearchQueryChange`, `handleUndo`, `handleRedo`, `handleRouteClear`,
`handleOpenDownload`, `handleCloseDownload`, `handleDownloadGpx`,
`handleOsmDebugLayerModeChange`, `handleCwReviewSegmentSelect`,
`handleDataMarkerClick`, `handleMapClick`, `handleRoutePointDrag`,
`handleRoutePointDragEnd`, `handleRoutePointDragStart`, `handleRoutePointRemove`,
`handleRoutePointSelect`, `handleRouteLineDrag`, `handleRouteLineDragStart`,
`handleSegmentFocus`, `handleSegmentHover`, `handleViewportIdle`,
`handleOsmDebugHover`, `handleOsmGraphEdgeHover`, `handleCwOsmMatchHover`,
`handleElevationHover`.

(The implementer must reconcile this list against the actual JSX — every
identifier the JSX references must be returned; build does not catch a missing
key, so verification is by dev-probe + smoke.)

## Decisions

- **One faithful move, not a re-architecture.** Move the body verbatim into one
  hook (preserving every closure, ref, and effect dependency array exactly).
  Splitting into multiple smaller hooks (`useMapAssets`, `useRouteSession`, …) is
  attractive but the clusters are interdependent; splitting now is high-risk.
  Deferred as a possible follow-up once the single hook is in place and green.
- **Keep web-only OSM-debug logic in the hook for now.** It is gated by `?osm`
  and is inert in RN; pulling it into a separate web-only hook is deferred to
  avoid risky surgery during the move.
- **Sub-components/helpers stay in `App.jsx`.** Only the `App` component body
  moves.

## Scope

**In:** create `src/app/useCyclewaysApp.js`; move the App body into it; make
`App.jsx` a thin view. **Out:** multi-hook decomposition, RN code, separating
OSM-debug, any logic/behavior change, touching the sub-components.

## Risks & verification

- **Risk: missing/renamed return key → runtime crash** (blank `#root`, like a
  prior incident). Build will NOT catch it. Mitigation: a fast dev-probe
  (load `/?route=…`, assert `#root` non-empty + route distance renders) before
  the full smoke; then the full smoke.
- **Risk: effect dependency arrays or ref identities subtly change.** Mitigation:
  verbatim move — do not edit effect bodies or dep arrays.
- **Gates:** `npm test` 9/9 · `npm run build` OK · dev-probe (app renders + route
  loads from URL) · `npm run test:smoke` matches baseline (40 pass / 12 fail; the
  12 are pre-existing stale specs). The route load/plan/restore/drag/share flows
  in `react-migration-smoke` are the core behavioral guard.
