# Navigation UI Redesign — Design

**Date:** 2026-07-04. **Status:** approved in brainstorming (visual companion
session; direction "A — classic light", controls "A — minimal row", five-stage
camera storyboard approved). Review additions captured: full-screen ride setup,
cue text model split, arrival/off-route precedence, and camera-fit semantics.

Active turn-by-turn navigation becomes its own visual mode: a Waze-like light
UI with one top cue card, on-map segment chips, a minimal control row, a
full-screen pre-ride setup gate, and a stage-aware camera. The UX layer
underneath (session, cues, wrong-way, puck anchoring, camera heading governor)
is already built and regression-tested by the nav-scenario harness; this design
is the presentation of that UX.

## Goals

- A more compelling, engaging ride screen — the map is the hero, the chrome is
  calm and legible at cycling speed.
- Surface the data we already compute per fix: current segment name + road
  class, next segment + distance, cue type/direction/distance, remaining
  distance, speed.
- Camera behavior tailored to what the rider is doing in each navigation
  stage, not one fixed zoom/pitch.
- Treat `הכנת הרכיבה` as the focused entry point into navigation, not a
  temporary settings sheet with the map peeking underneath.
- Everything decision-shaped lives in `@cycleways/core`, node-tested, and
  observable through the scenario harness timeline.

## Non-goals

- OSM road names/refs on base-network connector roads ("כביש 99 דפנה דרום").
  The shard pipeline does not carry names today (`edges` have
  routeClass/highway/roadType only). The chip design accommodates longer name
  strings, so this becomes a pure data-pipeline follow-up.
- Dark map style / night mode (rejected in favor of the light direction).
- Voice guidance.

## 1. Structure — the cue card (direction A)

One white rounded card at the top (safe-area aware), replacing the current
banner. Contents by state:

- **Cue upcoming** (turn / bend / arrive / hazard within the 120 m preview
  window): big direction icon on the right, primary text (`פנה שמאלה`,
  `עיקול ימינה`, `הגעת ליעד`), secondary line = destination segment
  (`אל שביל אופניים חצבאני`, from the cue's `ontoSegmentName`; for bends and
  cues without a name — the next-segment context line if within 300 m,
  otherwise empty). Distance to cue on the left, large, blue; updates live.
  The presentation model exposes these as separate `cuePrimaryText` and
  `cueSecondaryText` fields; the renderer must not reconstruct the split by
  parsing the existing `cueText`.
- **No cue near**: the card collapses to a slim status pill — current segment
  name (or `המשך במסלול`), so the top of the screen is mostly map.
- **Acquisition moment**: the existing green strip (`הגעת למסלול · הניווט
  התחיל`) rides on top of the card for its brief display, as today.
- **Wrong-way**: the existing red strip on top of the card, unchanged
  semantics (smoothed course + dwell + grace, already shipped).
- **Approaching**: card shows `בדרך למסלול` heading, target label + distance
  (connector distance when a calculated suggestion exists, beeline otherwise —
  existing `approachDistanceSource`), the phone-relative direction arrow, and
  the two existing actions (external nav, ride settings).
- **Off-route**: card repaints red — `חזרה למסלול` + distance; guidance arrow
  as today.

RTL/Hebrew throughout, matching `navigationPresentation.js` strings exactly.

## 2. On-map chips

- **Current-segment chip** — floats just below the puck (MarkerView anchored
  to the puck position, offset down; screen-aligned). Content: named CW
  segment → `דרך נוף הירדן · דרך עפר` (name · road-class label); unnamed
  connector → road-class label only. Chip labels are the bare noun form
  (`שביל אופניים`, `דרך עפר`, `שביל`, `כביש`, `רחוב`) — a new small helper
  beside `routeClassLabel()`, which keeps returning the prefixed form
  (`בדרך עפר`) for the context sentence. It must cover the route classes that
  already appear in navigation spans (`cycleway`, `path`, `track`,
  `path_track`, `footway`, `local_road`, `road`, `residential`) with a
  conservative fallback. Hidden while the collapsed status pill already shows
  the same name AND the map is at riding zoom (avoid duplication); shown
  whenever the cue card is in cue mode. Debounced: the chip text changes only
  when `currentSpanIndex` changes (no flicker at span boundaries).
- **Approach line chip** — small `המסלול המוצע` chip at the midpoint of the
  dashed calculated connector while approaching.
- **Rejoin line chip** — `חזרה למסלול` chip on the dashed rejoin suggestion
  while off-route.
- **Next segment** stays in the cue card secondary line (no second floating
  chip — screen space over trail maps is scarce).

## 3. Pre-ride setup — full-screen gate

`הכנת הרכיבה` becomes a full-screen or near-full-screen modal with an opaque
background. The current bottom sheet makes the setup feel like incidental
settings, and the map peeking underneath is visually wrong for a decision gate
that controls direction, start point, location quality, haptics, and external
handoff.

Structure:

- Safe-area aware full-screen surface with a compact header: close button,
  `הכנת הרכיבה`, route name/summary when available.
- Clear sections: `כיוון המסלול`, `נקודת התחלה`, `התראות רטט`, `סיכום`.
- Primary action pinned at the bottom. Copy follows the existing ride-plan
  result (`התחל ניווט במסלול`, `התחל והראה דרך למסלול`,
  `בחר אפליקציית ניווט`).
- The map is hidden while choosing ordinary setup options. `בחירת נקודה על
  המפה` intentionally exits the setup surface into map-pick mode, then returns
  to the full-screen setup after the point is chosen.
- For far/unknown approach tiers, external-app handoff is the primary next
  step, not a surprising secondary sheet.

This can still be implemented in `RideSetupSheet.jsx`; no new navigation
screen is required.

## 4. Controls

Bottom row (safe-area aware), right-to-left:

- **Data pill** (flex): `נותרו 4.2 ק״מ` + current speed `17.5 קמ״ש` (speed
  from `latestFix.speed`, smoothed over ~3 s, hidden when unavailable/standing).
- **Pause/Resume** round button.
- **Stop** round red button — always one tap, with the existing confirm.
- **Recenter** appears (floating, above the row's left edge) only while
  `cameraIntent === "free"` (user panned); disappears after recentering.
- **Haptics toggle** moves into the full-screen ride setup / ride-settings
  surface.
- **Arrival**: the control row and cue card are replaced by the summary card —
  only when the route has been acquired, remaining distance is <=15 m, and the
  rider is not off-route. The summary shows `הגעת ליעד 🎉`, distance ridden,
  elapsed time, average speed, and a `סיום` button (dismisses navigation).
  Data comes from session progress + fix timestamps. If the rider is physically
  off-route near the end, the off-route state wins until recovery.

## 5. Camera — the five stages (approved storyboard)

A pure **camera director** in core decides, per fix: `{ stage, mode, pitch,
zoom?, centerBias?, focusKind?, fitKind? }`. The existing heading governor keeps
deciding orientation; the director adds the rest. `mode: "follow"` means the
app centers on the rider or a rider→focus interpolation. `mode: "fit"` means
the app resolves declarative fit points and calls the existing Mapbox fit helper
with established padding semantics.

| Stage | Trigger | Pitch | Zoom / framing | Center / heading |
|---|---|---|---|---|
| 1 Approaching | status approaching | 20° | fit rider + route start (+ suggestion line) with padding | toward route start (guidance bearing target, governed) |
| 2 Riding | navigating, no near cue | 50° | speed-breathing: 16.8 at ≤2 m/s ↔ 15.8 at ≥8 m/s, smoothed ~2 s | rider; route-up (governor) |
| 3 Pre-turn | turn/bend cue active (current 120 m preview window) | 35° | 17.2 | midpoint rider↔junction; route-up |
| 4 Off-route | status off-route | 20° | fit rider + rejoin target + suggestion | rider; heading frozen (existing) |
| 5 Arrival | arrive cue ≤150 m; then arrived | 35°→0° | 17.2 toward flag; on arrival: fit whole route | flag; on arrival north-up fit |

Transitions ease over ~800 ms (reuse `CAMERA_ROTATE_MS`-style lerp for
pitch/zoom). Stage changes are edge-triggered and hysteretic. The director must
track a candidate stage and adopt it only after the dwell window, except for
immediate safety/terminal transitions (`off-route`, `arrived`); checking only
"time since previous accepted stage" is not enough.

## 6. Architecture

New/changed units, all in `@cycleways/core` unless noted:

- `navigation/cameraDirector.js` — `createCameraDirector()` →
  `update({ status, progress, activeCue, latestFix }, nowMs) -> shot`. Pure +
  stateful (candidate-stage hysteresis, breathing-zoom smoothing). Shot is
  declarative: follow shots carry `zoom`, `centerBias`, and `focusKind`; fit
  shots carry `fitKind`. The app resolves points and uses its existing fit
  helper/padding. Consumes the heading governor's output unchanged.
- `navigationPresentation.js` additions — `chip` model (`{ text, kind:
  "segment" | "approach" | "rejoin" } | null`), `cardMode`
  (`"cue" | "status" | "approach" | "off-route" | "arrived"`), `speedText`,
  `cuePrimaryText`, `cueSecondaryText`, `arrivalSummary` (`{ distanceText,
  elapsedText, avgSpeedText }`). All derived from session state; strings stay
  here. `arrived` requires `!offRoute`.
- `scenarioRunner.js` — timeline entries gain `cameraStage`, `chipText`,
  `cardMode` so scenarios can assert them; new expectation types as needed
  (e.g. `{ type: "camera-stage", value, betweenMeters }`).
- `apps/mobile/src/planner/NavPanel.jsx` — restructured renderer for the cue
  card + controls + arrival card. Pure over presentation output.
- `apps/mobile/src/planner/RideSetupSheet.jsx` — restyled as the full-screen
  pre-ride setup gate, including the haptics toggle.
- `apps/mobile/src/screens/BuildScreen.jsx` — RAF loop consumes the camera
  director (replacing the fixed NAV_FOLLOW_ZOOM/PITCH); renders the chips
  (MarkerViews) from presentation output.

## 7. Testing

- Unit: camera director (candidate-stage hysteresis, immediate off-route/arrived
  transitions, breathing zoom bounds, fit-vs-follow shot types), presentation
  additions (chip content per span/route-class, cue primary/secondary fields,
  card modes including off-route-before-arrived, arrival summary formatting).
- Scenario harness: per-scenario expectations — approach-calculated-route
  asserts stage approaching→riding and the approach chip; sovev asserts
  segment chip names appear at their span meters; missed-turn-reroute asserts
  stage off-route with frozen heading and rejoin chip; happy-path asserts
  pre-turn stage before the corner and arrival stage at the end.
- Visual acceptance: the dev scenario picker states double as the manual
  checklist (one scenario per state), plus full-screen ride setup at small and
  tall phone sizes with no unintended map peek.

## Implementation Notes

- Camera fit shots use the existing `BuildScreen` `fitCameraToPoints` helper:
  approach/rejoin fit padding is 150 px and arrived whole-route fit padding is
  84 px. Candidate stage dwell is 2000 ms; `off-route` and `arrived` still
  adopt immediately.
- Segment-chip scenario assertions use the synthetic L-turn routes because the
  current snapshot catalog scenarios do not carry `segmentSpans`.
- Unknown route classes produce no chip label (`null`). The implemented covered
  classes are `cycleway`, `path`, `track`, `path_track`, `footway`,
  `local_road`, `road`, and `residential`.
- `RideSetupSheet.jsx` now implements the setup gate as a full-screen opaque
  modal. Custom map-point selection remains the explicit exit from the setup
  surface into map-pick mode.

## Phasing

1. Core models + tests (camera director, presentation additions, harness
   exposure + expectations).
2. NavPanel restructure + chips + controls + full-screen ride setup (visual,
   verified via scenarios on the simulator/phone).
3. Camera director wiring in BuildScreen.
4. Follow-ups (separate efforts): OSM names/refs in shard pipeline for
   connector-road chips; junction annotation in the app's route decode paths
   (already noted in the cue work).
