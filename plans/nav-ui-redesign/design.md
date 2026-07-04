# Navigation UI Redesign — Design

**Date:** 2026-07-05. **Status:** approved in brainstorming (visual companion
session; direction "A — classic light", controls "A — minimal row", five-stage
camera storyboard approved).

Active turn-by-turn navigation becomes its own visual mode: a Waze-like light
UI with one top cue card, on-map segment chips, a minimal control row, and a
stage-aware camera. The UX layer underneath (session, cues, wrong-way, puck
anchoring, camera heading governor) is already built and regression-tested by
the nav-scenario harness; this design is the presentation of that UX.

## Goals

- A more compelling, engaging ride screen — the map is the hero, the chrome is
  calm and legible at cycling speed.
- Surface the data we already compute per fix: current segment name + road
  class, next segment + distance, cue type/direction/distance, remaining
  distance, speed.
- Camera behavior tailored to what the rider is doing in each navigation
  stage, not one fixed zoom/pitch.
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
  (`דרך עפר`, `שביל`, `כביש`) — a new small helper beside `routeClassLabel()`,
  which keeps returning the prefixed form (`בדרך עפר`) for the context
  sentence. Hidden while the collapsed status pill already shows
  the same name AND the map is at riding zoom (avoid duplication); shown
  whenever the cue card is in cue mode. Debounced: the chip text changes only
  when `currentSpanIndex` changes (no flicker at span boundaries).
- **Approach line chip** — small `המסלול המוצע` chip at the midpoint of the
  dashed calculated connector while approaching.
- **Rejoin line chip** — `חזרה למסלול` chip on the dashed rejoin suggestion
  while off-route.
- **Next segment** stays in the cue card secondary line (no second floating
  chip — screen space over trail maps is scarce).

## 3. Controls

Bottom row (safe-area aware), right-to-left:

- **Data pill** (flex): `נותרו 4.2 ק״מ` + current speed `17.5 קמ״ש` (speed
  from `latestFix.speed`, smoothed over ~3 s, hidden when unavailable/standing).
- **Pause/Resume** round button.
- **Stop** round red button — always one tap, with the existing confirm.
- **Recenter** appears (floating, above the row's left edge) only while
  `cameraIntent === "free"` (user panned); disappears after recentering.
- **Haptics toggle** moves into the ride-settings sheet.
- **Arrival**: the control row and cue card are replaced by the summary card —
  `הגעת ליעד 🎉`, distance ridden, elapsed time, average speed, and a `סיום`
  button (dismisses navigation). Data from session progress + fix timestamps.

## 4. Camera — the five stages (approved storyboard)

A pure **camera director** in core decides, per fix:
`{ stage, pitch, zoom | framing, center }`. The existing heading governor
keeps deciding orientation; the director adds the rest.

| Stage | Trigger | Pitch | Zoom / framing | Center / heading |
|---|---|---|---|---|
| 1 Approaching | status approaching | 20° | fit rider + route start (+ suggestion line) with padding | toward route start (guidance bearing target, governed) |
| 2 Riding | navigating, no near cue | 50° | speed-breathing: 16.8 at ≤2 m/s ↔ 15.8 at ≥8 m/s, smoothed ~2 s | rider; route-up (governor) |
| 3 Pre-turn | turn/bend cue ≤200 m | 35° | 17.2 | midpoint rider↔junction; route-up |
| 4 Off-route | status off-route | 20° | fit rider + rejoin target + suggestion | rider; heading frozen (existing) |
| 5 Arrival | arrive cue ≤150 m; then arrived | 35°→0° | 17.2 toward flag; on arrival: fit whole route | flag; on arrival north-up fit |

Transitions ease over ~800 ms (reuse `CAMERA_ROTATE_MS`-style lerp for
pitch/zoom). Stage changes are edge-triggered and hysteretic (e.g. pre-turn
exits 30 m after the junction, not instantly) so the camera never oscillates
between stages.

## 5. Architecture

New/changed units, all in `@cycleways/core` unless noted:

- `navigation/cameraDirector.js` — `createCameraDirector()` →
  `update({ status, progress, activeCue, latestFix }, nowMs) -> { stage,
  pitch, zoom | fitPoints, center }`. Pure + stateful (stage hysteresis,
  breathing-zoom smoothing). Consumes the heading governor's output unchanged.
- `navigationPresentation.js` additions — `chip` model (`{ text, kind:
  "segment" | "approach" | "rejoin" } | null`), `cardMode`
  (`"cue" | "status" | "approach" | "off-route" | "arrived"`), `speedText`,
  `arrivalSummary` (`{ distanceText, elapsedText, avgSpeedText }`).
  All derived from session state; strings stay here.
- `scenarioRunner.js` — timeline entries gain `cameraStage`, `chipText`,
  `cardMode` so scenarios can assert them; new expectation types as needed
  (e.g. `{ type: "camera-stage", value, betweenMeters }`).
- `apps/mobile/src/planner/NavPanel.jsx` — restructured renderer for the cue
  card + controls + arrival card. Pure over presentation output.
- `apps/mobile/src/screens/BuildScreen.jsx` — RAF loop consumes the camera
  director (replacing the fixed NAV_FOLLOW_ZOOM/PITCH); renders the chips
  (MarkerViews) from presentation output.

## 6. Testing

- Unit: camera director (stage transitions incl. hysteresis, breathing zoom
  bounds), presentation additions (chip content per span/route-class, card
  modes, arrival summary formatting).
- Scenario harness: per-scenario expectations — approach-calculated-route
  asserts stage approaching→riding and the approach chip; sovev asserts
  segment chip names appear at their span meters; missed-turn-reroute asserts
  stage off-route with frozen heading and rejoin chip; happy-path asserts
  pre-turn stage before the corner and arrival stage at the end.
- Visual acceptance: the dev scenario picker states double as the manual
  checklist (one scenario per state).

## Phasing

1. Core models + tests (camera director, presentation additions, harness
   exposure + expectations).
2. NavPanel restructure + chips + controls (visual, verified via scenarios on
   the simulator/phone).
3. Camera director wiring in BuildScreen.
4. Follow-ups (separate efforts): OSM names/refs in shard pipeline for
   connector-road chips; junction annotation in the app's route decode paths
   (already noted in the cue work).
