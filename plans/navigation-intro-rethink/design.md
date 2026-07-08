# Navigation Intro Rethink: One Honest "Getting to the Route" State

**Date:** 2026-07-07
**Status:** Approved design and implementation plan
**Supersedes (partially):** `plans/navigation-ride-setup/design.md` — the ride-setup
sheet as a blocking step and the near-tier connector suggestion are replaced; the
ride-plan core layer (direction, start mode, effective route) is retained.

## Problem

Riders who tap נווט while away from the route do not understand that they are
not on the route yet and must first travel to its starting point. Observed
causes in the current implementation:

1. The distance-to-route fact — the one thing the rider must understand — is
   rendered as a caption under a radio option and a muted summary box, inside a
   full-screen setup sheet that hides the map.
2. The setup sheet presents ~8 decisions (direction, three start modes,
   haptics, voice, lock-screen guidance) when the defaults are right for almost
   every ride. The rider's actual situation (far from the route) must be
   inferred from captions and button phrasing.
3. The at/near/far distinction is carried entirely by the wording of the
   primary button (`התחל ניווט במסלול` / `התחל והראה דרך למסלול` /
   `בחר אפליקציית ניווט`).
4. The approach state is dressed in full navigation chrome (data pill, pause,
   mute, stop) but produces no cues and no voice — it looks like navigation
   has started when it has not.
5. The dashed routed connector suggestion is built from uncurated base-graph
   data and has been observed suggesting inaccessible roads. It is
   "almost navigation" — a third thing between navigating and not navigating —
   and it fails exactly where trust is built, minutes before the ride starts.

## Product decision

Replace the situation-classifying setup sheet and the tiered approach UI with
**one honest model** stated in a single sentence:

> Until you reach the route start, CycleWays shows you where the start is;
> from the start, CycleWays navigates.

Concretely:

1. **A slim mini-confirm card** replaces the full-screen setup sheet as the
   blocking step. The map stays visible. The card leads with the situation
   ("the start is X km away"), has one primary button, and tucks all options
   behind a secondary `הגדרות רכיבה` screen. While the card/settings flow is
   open, the map may still be panned/zoomed, but route edits and marker
   add-to-route actions are locked.
2. **One live approach state for every distance.** After confirming, the rider
   always lands in the same on-map waiting state: direct line to the start,
   start marker, bearing arrow, live distance, and the persistent message that
   route navigation will begin on arrival. No near/far tiers in the UI.
3. **The routed connector suggestion is removed from this flow.** The
   suggestion machinery stays in the codebase but is not invoked for the
   pre-route approach. General-purpose approach routing is delegated to
   external apps (Google Maps / Waze), which are better at it.
4. **External handoff is available at every distance**, softened by persisting
   the pending ride plan and re-evaluating on return.

## Non-goals

- Extending or improving the base-graph connector routing (data quality is not
  trusted for approach suggestions today; the machinery may return later as a
  deliberate feature).
- Embedding Waze or Google Maps navigation in-app. iOS does not allow
  embedding another app's UI; Waze has no third-party SDK; Google's embeddable
  Navigation SDK is a paid enterprise product disproportionate to this need.
- Changing off-route / rejoin behavior after the route has been acquired.
  This design covers the pre-route intro only.
- Changing the ride-plan core (`createRidePlan`,
  `buildEffectiveNavigationRoute`), reverse traversal semantics, or
  alternate-start semantics. Those remain as designed in
  `plans/navigation-ride-setup/design.md`.
- Background tracking during the approach. Tracking is foreground-only until
  route guidance starts (lock-screen guidance behavior after acquisition is
  unchanged).

## The flow

```text
route page / planner
        |
        | נווט
        v
mini-confirm card (map visible, framed to rider + route start)
        |
        | primary button
        v
live approach state ------ rider reaches effective start ------> route guidance
        |     ^                                                  (existing
        |     | return to app: re-evaluate distance               acquisition
        v     |                                                   banner+haptic)
external nav app (Google Maps / Waze deep link)
```

## 1. Mini-confirm card

Opens as a **slim bottom card** over the route map when the rider taps נווט.
The map remains visible and is framed to show both the rider's location (when
available) and the effective route start.

The setup map renders an explicit current-location marker from the one-shot
setup fix, independent of Mapbox's native `UserLocation` stream. When the fix
includes a finite heading, the marker includes a small heading indicator;
otherwise it falls back to a dot. This avoids a blank "where am I?" map before
the continuous navigation watcher starts.

The camera fit must reserve the actual measured height of the intro card, plus
marker clearance, so the current-location marker and the effective start marker
remain visible above the card on every supported screen size and copy state.
When both markers are available and the rider is meaningfully away from the
start, the fit should use a pitched, start-facing camera: heading from rider to
effective start and a high enough pitch that the start reads as "ahead" near
the horizon. This pitched shot should use an explicit camera center and zoom
for the two marker slots, not a generic bounds fit: the start marker gets a
top-center slot with enough room to keep the flag fully visible, while the rider
marker gets a bottom-center slot just above the intro card. If location is
unavailable or the rider is already at the start, fall back to the flat fit.
The top-center start slot must account for the device safe-area top inset, so
iOS status/dynamic-island controls above the map cannot overlap the flag.

Content, in order:

- **Situation headline** — the distance fact in words:
  - Away from the start: `תחילת המסלול במרחק 12 ק״מ`
  - At the start: `אתה בנקודת ההתחלה`
  - Location unavailable/denied/stale: `לא הצלחנו לקבל מיקום עדכני` with a
    retry action; the card still allows starting.
- **Expectation line** (away from start only):
  `הניווט במסלול יתחיל כשתגיע לנקודת ההתחלה.`
- **Primary button:**
  - At the start: `התחל ניווט במסלול`
  - Otherwise: `צא לדרך`
- **External navigation button** (secondary prominence, always present when
  away from the start): opens the app chooser / preferred app with the start
  coordinates.
- **`הגדרות רכיבה` link** (quiet, secondary): opens the options screen.
- **Optional nearest-join hint** (one line, only when the existing
  `nearestIsMeaningful` recommendation logic fires with fresh location):
  `אתה קרוב לנקודה על המסלול — אפשר להתחיל ממנה בהגדרות רכיבה.`
  The card never auto-selects a start that skips route distance; it only
  points at the settings screen.

Defaults applied without asking: published direction, official start, current
persisted preferences for voice/haptics/lock-screen guidance.

The card requests a one-shot location fix (existing one-shot service). It does
not start the continuous watcher; that begins only after the primary button.
Canceling the card before starting must restore the normal map camera
orientation: top-down pitch and north-up heading.

## 2. Options screen (`הגדרות רכיבה`)

The current `RideSetupSheet` content survives here as a secondary, opt-in
screen reachable from the mini-card and from the approach state:

- Direction (רגיל / הפוך), with the existing one-way disable rule.
- Start point (official / nearest / custom map point), with the existing
  consequence summary (distance, skipped meters, guided length, endpoints).
- Voice, haptics, lock-screen guidance toggles and the voice test.

Changing options from the approach state stops the watcher, returns through
the settings screen with the current plan preselected, and re-enters the
approach state on confirm (same rule as the previous design). During active
route guidance the existing stop-and-restart confirmation still applies.

## 3. Live approach state

After the primary button, the rider lands in the same on-map state at every
distance. It must read as **waiting**, not as active navigation:

- **Map:** rider puck, route line, prominent start marker, and a thin direct
  line from the rider to the effective start. No routed/dashed connector.
- **Banner:** heading `בדרך למסלול`; bearing arrow (compass-relative when
  available, course-relative otherwise); live distance
  (`תחילת המסלול · 3.4 ק״מ`); persistent support line
  `הניווט במסלול יתחיל כשתגיע`.
- **Controls:** exactly three — `אפליקציית ניווט` (external handoff),
  `הגדרות רכיבה`, and `סיום` (exit to the route page). **No** pause, mute,
  data pill, or other navigation chrome.
- **Tracking:** foreground-only. Location polling frequency may be reduced
  while distant and tightened when close (implementation freedom, not a UX
  state). On foreground return, re-evaluate distance and re-render.

There are no UI tiers. `CONNECTOR_NEAR_RADIUS_M` no longer drives any
presentation in this flow. The only meaningful threshold is the existing
acquisition window around effective progress zero.

### Transition to route guidance

Unchanged from the previous design: acquisition requires the effective start
(small window around progress zero — passing another leg of the route must not
acquire), then shows `הגעת למסלול` briefly with one confirmation haptic, swaps
to route cue styling, and starts the continuous session from progress zero.
While route guidance is active, the follow camera uses the same tilted
start-facing angle as the intro shot. When the rider stops or completes
navigation and returns to the route page, the map must reset to the normal
top-down overhead view rather than keeping the navigation pitch.

## 4. External handoff

- Deep links carry the effective start coordinates. Google Maps uses
  `travelmode=bicycling`; Waze has no cycling mode — order/annotate the
  chooser accordingly. Apple Maps remains the always-available iOS fallback.
  The existing installed-app registry is reused.
- The pending ride plan (route token/slug, direction, start mode, selected
  point, and selected start progress) persists across the handoff, including
  app kill. Persisting progress matters for nearest/custom starts: returning
  must restore the same rider-approved effective start, not silently recompute
  a different nearest join. On return, validate the plan against the reloaded
  route, obtain a fresh fix, and resume the same approach state — or route
  guidance if the rider is already at the start.
- External handoff can be opened from either the mini-card or the live approach
  state. Both paths must record enough pending-plan state before launching the
  external app so app-return/app-kill behavior is identical.
- The travel-mode caveat stays explicit: the external app owns the approach
  leg.

## 5. Removal of the connector suggestion

- The pre-route approach never computes or renders the routed suggested
  connector. The thin direct line replaces it at all distances.
- Connector computation code, shard plumbing, and rendering remain in the
  codebase (used nowhere in this flow) so the capability can return if base
  data quality improves. If it is dead code after this change everywhere,
  removal is an implementation-plan decision, not a product one.
- Copy must not promise a path: the direct line is a pointer, not a route.

## Failure and edge cases

- **Location permission denied:** card explains, allows manual start via
  `הגדרות רכיבה`, retry, or starting anyway. If foreground permission is still
  denied when the rider confirms, CycleWays cannot start the continuous
  approach watcher; keep the rider in the visible-map intro/settings flow and
  prompt for permission instead of showing active navigation chrome. Once
  permission is granted, the same confirmed plan enters the approach state.
- **Stale/inaccurate fix:** show the fact; do not fire the nearest-join hint;
  distance line carries an accuracy caveat.
- **Rider at the start from the beginning:** card headline says so; primary
  button starts guidance directly — no approach state detour.
- **Rider passes the selected start without acquiring:** existing rule — offer
  a fresh nearest-point choice, never silently change the plan.
- **Route metadata changed under a persisted plan:** discard and return to the
  mini-card.

## Analytics

Keep the existing coarse events, adjusted: setup(card) opened / confirmed /
cancelled; settings screen opened; chosen vs default start mode and direction;
external handoff app; approach started / abandoned / acquired; persisted plan
restored / discarded. Distance-tier events collapse to a coarse
distance-at-confirm bucket. No precise coordinates.

## Accessibility and copy

- The card headline is real text, VoiceOver-first, not color or iconography.
- All controls are normal accessible buttons; the settings screen retains the
  existing radio semantics.
- Consistent vocabulary: `תחילת המסלול`, `בדרך למסלול`, `הניווט במסלול יתחיל
  כשתגיע`, `הגדרות רכיבה`. Avoid `יעד` as a primary label.

## Acceptance criteria

- Tapping נווט shows the distance-to-start fact in words, over a visible map,
  before anything else happens.
- One tap (primary button) is the entire mandatory flow; no option must be
  understood or chosen to start.
- The approach state contains no navigation chrome (no pause/mute/data pill)
  and no routed connector line at any distance.
- The same approach screen serves 300 m and 30 km; only the numbers differ.
- External handoff is reachable from the card and from the approach state
  whenever the rider is away from the start, and returning from the external
  app resumes the flow at the correct point, including after app kill.
- Reaching the start produces the existing explicit acquisition transition.
- Direction, alternate start, and guidance preferences remain fully available
  behind `הגדרות רכיבה` with unchanged semantics.
- The source route/token/draft remains unchanged by any of this.
