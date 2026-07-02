# Mobile planner ("תכנן מסלול") drawer & feedback UX

**Date:** 2026-07-02
**Status:** Approved for first web implementation slice.
**Scope:** Mobile web (≤860px) route planner: bottom-sheet behavior, playback
transport placement, route-ready feedback, viewport layout, hints. Desktop and
native app are out of scope (the native app has its own sheet).

## Background

A UX review of the mobile web planner (code walkthrough + live run at an
iPhone-13 viewport, driving the real flow: Discover home → "תכנן מסלול" →
tapping points → opening a route in the planner via `?route=` → all three sheet
snaps). The full-open Build panel content is good (stats, elevation with grade
bands, playback, GPX/share/send-to-phone, POI list). The problems are about
*when the user gets to see it* and about controls moving around.

Per the surface-roles model (`plans/discovery-surface/`,
`plans/planning-surface/`, `plans/navigation-handoff/`): mobile web is
discovery/preview-first; heavy planning is desktop. The mobile planner's job is
lightweight build/preview and funneling the route onward through today's web
outputs: native share/copy, route details, and GPX. The app is not published
yet, so app-specific promotion remains out of the web UI for this slice.

## Problems found (with evidence)

### P1. Completing a route gives almost no visible feedback

- `src/App.jsx:290` forces the sheet to `peek` on the 0→N points transition.
  That catches both hand-built first points and restored/shared `?route=`
  routes.
- Catalog route entry primarily happens via `/routes` "פתח במפה",
  route-story edit/open actions, direct shared `?route=` links, and
  back/forward restoration. Discover cards themselves route to dedicated
  `/routes/<slug>` pages.
- At `peek` the entire panel body is `visibility: hidden`
  (`src/components/frontPanel/front-panel.css:116`); the only feedback is the
  one-line peek row ("2 נקודות · 4.4 ק"מ").
- Result: elevation graph, stats, and actions are invisible exactly when the
  user has just built or loaded a route. Discovering them requires knowing the
  grip handle opens the drawer.

### P2. The playback transport teleports; at `half` it is off-screen

- The transport renders twice: on the map (`src/App.jsx:1177`,
  `--map`) and inside the Build panel (`src/App.jsx:906`, `--panel`).
- CSS swaps them by snap state (`src/react-app.css:1730-1744`): `--map` shows
  only at `peek`; at `half`/`full` the `--panel` copy shows instead.
- Measured at `half` on a 664px-tall viewport: the panel transport's top is at
  y≈720 — **below the fold**. Opening the drawer makes the play button vanish
  until the user scrolls the panel body.
- `src/App.jsx:706` auto-snaps the sheet to `half` when playback starts on
  mobile — so pressing play on the map moves the control the user just pressed
  off-screen and covers half of the animation being watched.

### P3. The planner does not own the phone screen (the "broken" look)

- The planner shell measures 586px in a 664px viewport; the marketing
  `ContentSections` begin at y≈650 and the whole document scrolls
  (scrollHeight ≈2618). Mid-planning, the map can be flung away.
- `PEEK_PX` is a fixed 164px (`src/components/frontPanel/sheetSnap.js:4`), but
  the build-mode peek content is a single ~60px row → ~90px of blank white
  sheet, floating above further white page background.
- The map transport's bottom offset uses the same fixed 164px var
  (`--front-sheet-peek-height`, `src/react-app.css:78`), so it floats above
  that dead zone too.

### P4. Hints cover the small map's center

- `src/components/PlannerHints.jsx` renders a large dark box dead-center over
  the map and persists until "הבנתי" is tapped. On a 390px-wide map it covers
  where the user needs to tap, and the "גררו את הקו…" hint hides the very
  route it describes.

### P5. Smaller issues

- Mobile CTA priority: today's useful phone action is "שיתוף" (native
  share/copy), with GPX as the navigation escape hatch. "שלחו לטלפון" is a
  desktop QR handoff; on a phone it should not be the primary action.
- Peek copy grammar: "1 נקודות" (should be "נקודה אחת").
- Elevation cursor readout mixes RTL/LTR badly ("m 79 • גובה",
  "1.4%- • ירידה") — numeric+unit runs need LTR isolation.
- Elevation grade bands use `onMouseEnter/Leave` for the map highlight
  (`src/components/frontPanel/PanelElevationGraph.jsx:48`) — no touch
  equivalent, so band→map highlighting silently doesn't exist on mobile
  (tap-to-seek does work).
- At `half`, the mobile Build sheet keeps a compact top header so users can
  return to route discovery and keep orientation while building.

## Design

### D1. Snap policy: planner opens at half

| Moment | Snap | Rationale |
|---|---|---|
| Enter Build with empty route (FAB) | `half` | The drawer opening should be predictable: every planner entry opens the usable panel, even before route points exist. |
| While actively adding/editing points | stay at current snap | Don't steal the editing surface after the user has started working. |
| Route opened into the planner from `/routes` CTAs, route-story edit/open actions, direct `?route=`, or back/forward | `half` | Show what loaded (stats + elevation) with the route still visible above. Discover cards themselves link to `/routes/<slug>` and do not open the planner. |
| Playback starts | stay at current snap; never auto-`half` | See D2. Playing should maximize the map, not cover it. |
| User drags/taps the grip | manual snaps always win | No auto-snap may fight an explicit user choice within the same route session. |

The 0→route-ready transition while hand-building keeps the drawer at `half`
unless the user has manually snapped it elsewhere in the same route session.

This design supersedes the web-specific auto-dock decision in
`plans/route-playback-dock/` Task A5. The native-app parts of that plan are not
affected.

### D2. One persistent playback transport, above the drawer

Replace the two swapping copies with a single mobile map transport anchored to
the measured top edge of the drawer:

- At `peek` and `half`, it sits just above the visible drawer.
- At `full`, it hides because there is no useful map area to scrub against.
- It never duplicates while a route is ready.
- The `--panel` copy is not rendered on mobile at all (it remains the desktop
  in-panel placement).
- Remove the play→`half` auto-snap (`src/App.jsx:706`).
- The fixed transport uses snap-specific offsets: measured peek height at
  `peek`, `50dvh` at `half`, and no transport at `full`.
- Overlay-aware camera fitting (`plannerFitRegistry`, `src/App.jsx:513`)
  keeps treating the transport and sheet as bottom overlays.

### D3. Planner owns the viewport; peek height fits its content

- In planner mode (map shown; **not** the mobile Discover home), the shell is
  full dynamic viewport height (`100dvh` minus the site header); body scroll is
  locked; `ContentSections` are not rendered under the planner on mobile.
  (Discover home keeps its current scrolling page.)
- Mobile Build renders a compact in-sheet topbar with a "מסלולים" back control
  and "בניית מסלול" title above the Build panel.
- The peek snap offset derives from the **measured** peek-content height
  (mode-switch + row(s) + handle), not the fixed `PEEK_PX = 164`. Build-mode
  peek is short; Discover-mode peek is taller; both should hug the bottom edge
  with zero dead space. `offsetsForHeight` gains a measured-peek input;
  the CSS var `--front-sheet-peek-height` is set from the same measurement.
- Rich build peek row: once a route exists, the peek shows distance + ascent
  and a small "פרטים" affordance (chevron), plus — space permitting — a tiny
  static elevation sparkline. This is still useful when the user manually
  collapses the drawer. The existing route-page link chip stays.
- Surface "שיתוף" earlier on mobile: an icon/compact button in the peek row
  once a route is ready. Use `navigator.share` where available and copy-link as
  fallback. Keep "שלחו לטלפון" for desktop QR handoff only until the app is
  published.

### D4. Hints become a bottom toast on mobile

- On ≤860px, `PlannerHints` renders as a slim single-line toast just above the
  transport/peek stack (not centered over the map), auto-hiding for the current
  session after a few seconds or on the first successful action of its stage.
  "הבנתי" remains as the persistent dismiss. Existing progress-marks-seen logic
  is kept; timer-only auto-hide must not permanently mark the hint as seen.
- Desktop presentation is unchanged.

### D5. Half-snap content order

At `half`, the target above-the-fold content is: compact one-row header
(back-to-routes + title merged), stats row, full elevation graph. The current
two-row topbar+eyebrow block is compressed to one row on mobile so the
elevation graph is not clipped at the fold.

### D6. Small fixes

- "נקודה אחת" singular in the peek row.
- Wrap numeric/unit runs in the elevation cursor readout and grade badge with
  LTR bidi isolation.
- Grade bands: add touch handling — tap highlights the band on the map (and
  seeks, as today); highlight clears on the next map/graph interaction.

## Non-goals

- No changes to desktop layout or behavior (the 408px side panel keeps its
  in-panel transport and current hints).
- No redesign of the Build panel's full-open content (it works).
- No changes to touch route-editing gestures (drag-to-edit conflicts with map
  panning — real, but separate; see `plans/mobile-map-gesture-intent/` for the
  native-side treatment of the same problem).
- No native-app changes, and no app-install / "open in app" web UI until the
  app is published.

## Acceptance criteria

1. Loading a route into the planner from `/routes`, route-story edit/open
   actions, direct `?route=`, or browser history on mobile opens the sheet at
   `half`: stats and the full elevation graph visible without scrolling, route
   still visible on the map above.
2. Completing a route by tapping points keeps the map at `peek`, and the peek
   row immediately shows distance + ascent (+ sparkline if included).
3. The playback transport is visible in a fixed screen position whenever a
   route is ready, at every snap state; pressing play never moves or hides it
   and never changes the snap.
4. At `peek`, the sheet hugs the bottom of the screen with no dead white space
   below or inside it; the page behind the planner does not scroll; no
   marketing sections are reachable from the mobile planner view.
5. Hints on mobile never cover the map center and disappear on their own.
6. Existing Playwright/desktop behavior unchanged (CSS/JS gated on the ≤860px
   sheet mode).

## Verification notes (for the implementer)

Real taps are required to add route points on the Mapbox canvas in Playwright
(`page.touchscreen.tap` with a mobile device profile; synthetic `mouse.click`
does not register). A working driver script from this review is a useful
starting point for a verification harness: iPhone-13 context → FAB →
`touchscreen.tap` on trail pixels → assert peek text / element visibility and
`getBoundingClientRect` positions per snap state.
