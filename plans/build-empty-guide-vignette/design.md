# Build panel empty state — animated guidance vignette

Date: 2026-07-02

> **Alternative designs — pick one.** This is one of two competing designs for
> the same empty-panel space. The other is
> `plans/build-empty-actions/design.md` (action-oriented empty state). They
> replace the same `build-panel__empty` paragraph and MUST NOT both be
> implemented. This variant is **guidance-only**: it teaches the planning
> gesture with an animated illustration and step list.

## Problem

When the Build panel opens with no route points, it shows only the header
("מסלול חדש" + undo/redo/clear tools) and a single line of text —
`סמנו נקודות על המפה כדי לבנות מסלול.` in `src/components/frontPanel/BuildPanel.jsx`
(the `build-panel__empty` paragraph). The rest of the panel is blank. New
users get no demonstration of *how* route planning works (tap near a trail,
tap again, the route computes along trails, drag to refine).

## Current context (verified 2026-07-02)

- `src/components/frontPanel/BuildPanel.jsx` — renders the Build panel;
  `getPlannerBuildModel(routeState)` provides `hasRoute`; when `!hasRoute` the
  single-line empty paragraph shows.
- `src/components/PlannerHints.jsx` — three **one-time on-map hints**
  ("לחצו על המפה ליד שביל…", "הוסיפו נקודה נוספת…", "גררו את הקו…") that fire
  progressively off real user progress and are dismissed forever once seen.
  **These stay untouched** — they cover the contextual mid-flow moments and
  mobile-peek states this vignette cannot.
- Mobile: Build lives in the bottom sheet. Entering Build snaps the sheet to
  `half` (`handlePeekBuild` in `src/App.jsx` calls `setSheetSnap("half")`), so
  the panel body **is** visible at that moment; once the user starts tapping
  the map the sheet typically drops to peek. Mobile breakpoint used by the
  planner: `max-width: 860px`.
- The app is Hebrew / RTL.

## Decisions already made (with the user)

1. **Persistent empty state** — shows every time the panel has 0 points. No
   seen-state, no dismiss button, no storage.
2. **Medium: hand-built SVG + CSS animation** — not a recorded GIF/video
   (heavy, blurry on retina, not RTL/theme aware, goes stale on UI changes),
   not a live scripted demo on the real map (complex, fights user
   interaction).
3. **Mobile gets a compact variant** of the same vignette, not steps-only and
   not the full desktop layout.
4. **PlannerHints are kept as-is** alongside this feature.

## Design

### 1. Component & placement

- New component `src/components/frontPanel/BuildEmptyGuide.jsx`; styles added
  to `src/components/frontPanel/front-panel.css`.
- Rendered by `BuildPanel.jsx` **when `routeState.points.length === 0`**,
  replacing the `build-panel__empty` paragraph.
- With exactly 1 point (started but no route yet) the existing plain one-line
  text remains — at that stage the user has clearly begun and the on-map hint
  ("הוסיפו נקודה נוספת…") takes over. Do not show the vignette then.
- A loaded catalog route always has points, so the guide never covers
  recommended-route content.

### 2. The vignette (pure SVG + CSS keyframes — no image assets, no JS timers)

A stylized mini-map illustration, clearly *not* the real map (soft flat
background, abstract dashed trail lines in the app's bike-road colors), so
users don't try to interact with it.

Loop (~7s, CSS keyframes on SVG elements):

1. A pointer glyph slides in and "taps" → point **①** drops with a small
   pulse ring.
2. Pointer moves, taps again → point **②** drops.
3. The route line draws itself along the trail between the points
   (`stroke-dashoffset` animation).
4. Short hold on the finished frame → loop restarts.

Constraints:

- `prefers-reduced-motion: reduce` → all animation disabled; the final frame
  (two numbered points + drawn route) shows as a static illustration.
- No text inside the SVG except the point numbers ① ②. All readable text is
  HTML below, so Hebrew/RTL and theming stay native.
- The SVG is decorative: `aria-hidden="true"`; the steps list carries the
  meaning for screen readers.

### 3. Steps text (HTML, RTL, below the vignette)

1. לחצו על המפה ליד שביל כדי להתחיל
2. הוסיפו נקודה נוספת — המסלול יחושב לאורך השבילים
3. גררו את הקו או הנקודות כדי לדייק, ואז הורידו GPX או שתפו

Ordered list markup (`<ol>`), small leading icons optional.

### 4. Responsive behavior (CSS only)

- **Desktop:** vignette at panel width, roughly 16:10 aspect; steps as a
  comfortably spaced list below.
- **Mobile (`max-width: 860px`):** vignette height capped at ~130px, steps
  condensed to single tight lines, so the whole guide fits the half-height
  sheet without scrolling.

### 5. Testing

- Component test: `BuildPanel` with an empty `routeState`
  (`points: []`) renders the guide; with 1 point renders the plain empty
  text and no guide; with a computed route renders stats and no guide.
- Reduced-motion behavior is CSS-only — verify manually.
- Manual visual check in the running app: desktop viewport and a ~390px
  mobile viewport (Build tab → sheet at half).

## Out of scope

- Any change to `PlannerHints.jsx`.
- Dismiss/seen-state logic.
- Actionable shortcuts in the empty state (search, locate-me, draft resume,
  start-from-recommended) — that is the competing
  `plans/build-empty-actions/design.md` design.
