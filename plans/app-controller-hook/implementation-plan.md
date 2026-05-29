# App Controller Hook (`useCyclewaysApp`) — Implementation Plan

**Goal:** Move the `App` component body (L65–1165) into
`src/app/useCyclewaysApp.js` as `useCyclewaysApp()`; make `App.jsx` a thin view
that destructures the hook and renders the existing JSX. Zero web behavior
change. See `plans/app-controller-hook/design.md`.

**Gates:** `npm test` 9/9 · `npm run build` · dev-probe (app renders + route from
`?route=` loads) · `npm run test:smoke` = baseline (40 pass / 12 fail). Branch
`claude/iphone-app` — NO branch/checkout operations.

---

### Task 1: Baseline
- [ ] `npm test` → green. STOP if red.

### Task 2: Create `src/app/useCyclewaysApp.js`
- [ ] Create the file. Move into it the **imports** App.jsx uses that are needed
      by the component BODY (engine `RouteManager`, `src/routing/*`,
      `src/platform/*`, `src/data/*`, `src/map/mapLayers.js` helpers used in the
      body like `dataMarkerFeaturesFromSegments`, `createRouteDirectionAnimator`,
      `featureFlags`, React hooks, plus the in-file helpers it calls —
      `routeStateFromSnapshot`, `clearRouteStateFields`, `addPendingRoutePoint`,
      `removePendingRoutePoint`, `routingShardFormat`, `getGeoJsonCoordinateBounds`,
      `snapRoutePointsToGeometryIndices`, `routePointsFromDragPreview`,
      `routePointDragCursor`, `routePointWithCoordinates`, `getSegmentDetails`,
      `findCyclewaysFeatureById`, `failureClassLabel`, `unavailableRoutingShardStatus`,
      etc.). Those in-file helpers may stay exported from App.jsx and be imported
      by the hook, OR move into the hook module — choose whichever keeps both
      files resolvable; prefer moving the pure helpers used ONLY by the body into
      the hook module, and `import` from App.jsx the ones also used by App.jsx's
      sub-components. Verify by grep which helpers are used where.
- [ ] Define `export function useCyclewaysApp() {` containing the verbatim body
      (L65–1165): every `useState`/`useReducer`/`useRef`/`useEffect`/
      `useCallback`/`useMemo` and derived const, UNCHANGED (same code, same
      dependency arrays).
- [ ] End with `return { … }` listing every identifier the App JSX (L1166–1372)
      references — see the design's interface list; reconcile against the actual
      JSX.

### Task 3: Make `App.jsx` a thin view
- [ ] Replace the `App` body (L65–1165) with:
      `const { <full interface> } = useCyclewaysApp();`
- [ ] Keep the JSX return (L1166–1372) byte-identical.
- [ ] Add `import { useCyclewaysApp } from "./app/useCyclewaysApp.js";`
- [ ] Remove imports from App.jsx that are now used only by the hook (and keep
      those still used by the JSX/sub-components/helpers). Let `npm run build`
      surface any unused/missing import.

### Task 4: Fast verify (catch crashes before the 8-min smoke)
- [ ] `npm run build` → succeeds (resolves imports). Fix any unresolved import.
- [ ] Dev-probe: start `npm run dev` on a spare port; load
      `/?route=Bjjy1nRHHDArrNAoctqGv4RHL3un`; assert `#root` is non-empty, the
      route-description shows a `ק"מ` distance, and there are zero page errors.
      If `#root` is empty → a return-key is missing/misnamed; fix and re-probe.

### Task 5: Full verify
- [ ] `npm test` → 9/9 + all JS green.
- [ ] `npm run test:smoke` → 40 pass / 12 fail (baseline); no NEW failures
      (watch the `react-migration-smoke` load/plan/restore/share tests and the
      drag flow).

### Task 6: Commit
- [ ] `git commit -m "refactor(app): extract orchestration into useCyclewaysApp hook"`

### Task 7 (optional follow-up, NOT this commit)
- Split `useCyclewaysApp` into focused hooks (`useMapAssets`, `useRouteSession`,
  `useMapUiState`, web-only `useOsmDebugOverlay`) once the single hook is green.
