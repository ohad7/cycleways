# Approach Destination Picker — Implementation Plan

**Goal:** Decluttered approach banner (default to start) + an options sheet with
destination choices, a map-tap route-snap target, and a WhatsApp-style list of
installed navigation apps; plus the line-blink fix.

**Tech:** `@cycleways/core` (node ESM tests), React Native + `@rnmapbox/maps`,
`react-native` `Linking`, Expo config.

## Global Constraints
- New pure core tests: standalone `node tests/test-<name>.mjs`, appended to the
  `package.json` `"test"` chain before `&& cd tests && node test-route-manager.js`.
- Hebrew/RTL copy. Native UI verified via `babel-preset-expo` transform + device.
- Default approach target = route start; nearest/custom only via explicit action.
- Never null `suggestionGeometry` on target change / new request; only
  `CONNECTOR_READY` (replace) or `CONNECTOR_FAILED` (clear) change it.

---

### Task 1: External nav app registry (core)
- Replace `buildExternalNavLinks` in `packages/core/src/navigation/externalNav.js`
  with `EXTERNAL_NAV_APPS = [{ id, label, probeUrl, alwaysAvailable?, buildUrl(point) }]`:
  - apple-maps: `alwaysAvailable: true`, buildUrl `https://maps.apple.com/?daddr=<lat>,<lng>&dirflg=w`.
  - google-maps: probe `comgooglemaps://`, buildUrl `comgooglemaps://?daddr=<lat>,<lng>&directionsmode=bicycling`.
  - waze: probe `waze://`, buildUrl `https://waze.com/ul?ll=<lat>,<lng>&navigate=yes`.
  - moovit: probe `moovit://`, buildUrl `moovit://directions?dest_lat=<lat>&dest_lon=<lng>`.
  - Export `buildAppUrl(app, point)` guard returning null for invalid points.
- Update `tests/test-external-nav.mjs` to assert each app's `buildUrl` + `probeUrl`
  and invalid-point → null. Update any importer (NavPanel).

### Task 2: Session — custom route-snapped target + keep-suggestion (core)
- `navigationSession.js`: add `NAV_ACTIONS.SET_APPROACH_CUSTOM_TARGET { point }`;
  project via `projectOntoRoute(navigationRoute.geometry, point)` → target
  `{ point: projection.point, mainProgressMeters: projection.progressMeters, mode: "custom" }`;
  reset `suggestionStatus: "idle"`, re-arm request gate, but **keep**
  `suggestionGeometry`.
- In `requestSuggestion` and `SET_APPROACH_TARGET`, stop setting
  `suggestionGeometry: null` (keep prior until READY/FAILED).
- Tests in `tests/test-navigation-session.mjs`: custom target snaps onto the
  route; suggestion persists across target change until READY/FAILED.

### Task 3: Presentation (core)
- `navigationPresentation.js`: keep `approachDistanceText` as the single banner
  text (already). Add `destinationLabel` ("תחילת המסלול" | "נקודה במסלול") from
  `approach.target.mode`. No more inline prompt fields needed, but leave
  `joinPrompt`/`showJoinPrompt` (now unused by NavPanel) or remove — remove to
  avoid dead fields, updating the presentation test.

### Task 4: DestinationSheet (native)
- New `apps/mobile/src/planner/DestinationSheet.jsx`: modal/bottom-sheet listing
  the three destinations + the detected app list (filter `EXTERNAL_NAV_APPS` by
  `alwaysAvailable || await Linking.canOpenURL(probeUrl)`, computed in an effect)
  + disclaimer. Props: visible, current target mode, skip text, callbacks
  (`onPickStart`, `onPickNearest`, `onPickOnMap`, `onOpenApp(app)`, `onClose`).

### Task 5: NavPanel declutter (native)
- Remove the inline prompt + Waze/Maps buttons. Banner: arrow + approach row +
  a "יעד" button (opens the sheet). Keep disclaimer out of the banner.

### Task 6: MapScreen wiring (native)
- Hold sheet visibility + "pick on map" mode state; render `DestinationSheet`.
- On `onPickOnMap`, enter tap mode; the next map press dispatches
  `SET_APPROACH_CUSTOM_TARGET { point }` and drops a target marker; exit tap mode.
- `onOpenApp(app)` → `Linking.openURL(buildAppUrl(app, target)).catch(...)`.
- Wire `onPickStart`→`setApproachTarget("start")`, `onPickNearest`→`("nearest")`.

### Task 7: Expo iOS scheme allowlist (config)
- Add `comgooglemaps`, `waze`, `moovit` to `ios.infoPlist.LSApplicationQueriesSchemes`
  in the Expo app config. Needs `expo prebuild` (user, on device).

### Task 8: Gates
- `npm test` green; native files transform under `babel-preset-expo`; update
  acceptance notes. Device pass (sheet, app list, map-tap, no line blink).
