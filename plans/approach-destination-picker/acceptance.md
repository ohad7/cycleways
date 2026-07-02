# Approach Destination Picker — Acceptance

**Date:** 2026-06-30
**Status:** core + web automated validation complete; native per-file Babel
validation complete; device pass pending local Expo/Xcode (incl. `expo prebuild`
for the iOS scheme allowlist).

## Automated (complete)
- [x] `npm test` EXIT=0 — external-nav registry/buildAppUrl, custom route-snap
  target + keep-suggestion session behavior, default-to-start, and the updated
  presentation fields.
- [x] All touched native files transform under `babel-preset-expo`:
  MapScreen, useNavigationSession, NavPanel, DestinationSheet.
- [x] `app.json` valid; `LSApplicationQueriesSchemes` added (comgooglemaps, waze,
  moovit).

## Device (pending)
- [ ] Banner reads "<destination> · <distance>"; the "יעד" button opens the sheet.
- [ ] Sheet lists start / nearest-join (with skip) / pick-on-map, and only the
  navigation apps actually installed (probe via `canOpenURL`). Requires
  `expo prebuild` so the scheme allowlist takes effect.
- [ ] Choosing a destination does NOT blink the on-map suggestion line out (it
  stays until the replacement is ready); the thin direct line is always visible.
- [ ] "בחר נקודה על המסלול" → tap mode → the tap snaps onto the route and becomes
  the target.
- [ ] Tapping an app opens it routing to the current target.
