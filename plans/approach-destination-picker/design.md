# Approach Destination Picker

**Date:** 2026-06-30
**Builds on:** `plans/turn-by-turn-rejoin-routing/` (approach-to-route guidance).
A device pass surfaced that the inline approach prompt is overloaded and the
on-map line blinks out when a target is chosen. This redesigns the approach
destination UX.

## Motivation

The inline NavPanel made a routing-philosophy decision (start vs join vs
external app) in a cramped banner, and selecting a target nulled the suggested
connector before its replacement existed, so the line visibly disappeared (and
never returned when the new target had no road path). For a discovery app, the
right shape is a **simple default inline** with **richer choices behind a
dialog**.

## Behavior

**Default (inline):**
- Target is **always the route start** by default; the automatic start-vs-nearest
  scoring is gone. Joining elsewhere is only ever an explicit user choice.
- Banner is one row: compass arrow + `מנווט לתחילת המסלול · <distance>`, plus a
  single **"יעד"** control that opens the options sheet. The disclaimer moves
  into the sheet.
- The **direct line is always rendered** (never waits on async). The **in-app
  dashed road suggestion stays**, drawn to the current target.

**Options sheet ("לאן לנווט?"):**
- **תחילת המסלול** — start (default).
- **הצטרף לנקודה הקרובה** — nearest projected point, labelled "דילוג ~<X>".
- **בחר נקודה על המסלול** — dismisses the sheet; the next map tap snaps to the
  **nearest point on the route** and becomes the target (with a marker).
- **נווט באפליקציה אחרת** — a WhatsApp-style list of the navigation apps actually
  installed (Apple Maps, Google Maps, Waze, Moovit), each opening to the current
  target. iOS has no system nav-chooser, so the list is self-built from
  `Linking.canOpenURL` probes.
- The "ניווט מחוץ לרשת CycleWays" disclaimer lives here.

## Line-blink fix

On any target change (start / nearest / custom) and while a new connector
request is in flight, **keep the existing `suggestionGeometry`** (only reset
`suggestionStatus`). `CONNECTOR_READY` replaces it; `CONNECTOR_FAILED` clears it.
The direct line is always on, so the spatial cue never disappears.

## Architecture

**Core (`@cycleways/core`, node-tested):**
- `externalNav.js` — a registry `EXTERNAL_NAV_APPS = [{ id, label, probeUrl,
  alwaysAvailable?, buildUrl(point) }]` for apple-maps (always available),
  google-maps (bicycling), waze (car), moovit. `buildUrl(point)` returns the
  per-app navigation URL to a `{lat,lng}`. Replaces the two-link
  `buildExternalNavLinks`.
- `navigationSession.js` — default the approach target to the start (already the
  case); add `SET_APPROACH_CUSTOM_TARGET { point }` which projects the tapped
  point onto the route (`projectOntoRoute`) and sets the target; stop nulling
  `suggestionGeometry` on target change / new request.
- `connectorTargeting.js` — reuse `projectOntoRoute` for the custom snap.

**Native (device-verified):**
- A `DestinationSheet` component (bottom sheet / modal): the three destination
  options + the detected app list + disclaimer.
- NavPanel: decluttered banner + the "יעד" control; opens the sheet.
- MapScreen: "pick a point" tap mode → snap + dispatch `SET_APPROACH_CUSTOM_TARGET`
  + a target marker; `canOpenURL` filtering for the app list; passes the
  current target through.
- Expo config: add `comgooglemaps`, `waze`, `moovit` to
  `ios.infoPlist.LSApplicationQueriesSchemes` (needs `expo prebuild`).

## Out of scope

- Android intent chooser (iOS-first; the registry is platform-neutral).
- Arbitrary off-route destinations (tap always snaps to the route).
- Persisting a chosen destination across sessions.

## Testing

- Node: `EXTERNAL_NAV_APPS` URL/probe construction per app; custom-target
  projection + the keep-suggestion-on-change session behavior; default-to-start.
- Device: the sheet, the app list reflecting installed apps, map-tap targeting,
  and that the line no longer blinks out.
