# Navigation Ride Setup and Approach UX

**Date:** 2026-07-01  
**Status:** Implemented in code; physical-device ride acceptance pending  
**Builds on:** `plans/rn-turn-by-turn-navigation/`,
`plans/turn-by-turn-rejoin-routing/`, and
`plans/approach-destination-picker/`.

## Problem

The app currently starts a navigation session as soon as the rider presses the
featured-route navigation action. Only after the first location fix does it
become clear whether the rider is on the route or approaching it. Choices such
as the official start, the nearest point, and a point selected on the map are
hidden behind the small `יעד` action inside the active navigation UI.

The underlying capabilities are useful, but the interaction implies that route
guidance has already started before the rider has made the decisions required
to define the ride. In particular, the current UI does not clearly answer:

- Is the rider going to the official start or joining somewhere else?
- How much of a linear route will be skipped by joining midway?
- Will a circular route still be completed as a full loop?
- Is the route being ridden in its published direction or in reverse?
- Is CycleWays guiding the curated route, or merely suggesting a way to reach
  it?
- What should happen when the rider is several kilometres away?

Reverse traversal is not currently available. Alternate approach targets exist,
but they do not produce an explicit, reviewable ride plan before navigation.

## Product decision

Introduce a **ride setup** step between selecting `נווט` and starting an active
navigation session. The setup defines two independent choices:

1. **Direction:** published direction or reverse.
2. **Start:** official start, nearest point, or a point selected on the map.

The app recommends a configuration using the rider's location, shows its
consequences, and asks for confirmation before starting. The saved route,
featured-route token, and planner draft are never mutated; setup produces a
derived navigation route used only for that session.

Keep the existing nearby suggested connector. It remains a non-narrated,
visually subordinate **approach suggestion**, not CycleWays turn-by-turn
navigation.

## Goals

- Make the decisions required to begin a ride visible before guidance starts.
- Preserve a fast path when the rider is already on or very near the route.
- Keep the useful suggested connector for nearby riders.
- Promote external navigation when the rider is far away.
- Support alternate starting points with honest distance/skip consequences.
- Support reverse traversal with correct geometry, cues, POIs, segment context,
  elevation totals, and endpoints.
- Make transitions between setup, approach, on-route navigation, and off-route
  recovery explicit.
- Use the same behavior for routes opened from Discover, featured pages, shared
  links, and the native planner.

## Non-goals

- Turn-by-turn narration on an improvised connector outside the curated route.
- Editing or republishing the source route when ride setup changes.
- Recalculating a new arbitrary route from the chosen start to the published
  finish.
- Automatically claiming that a reversed route is legally or physically
  suitable. Routes explicitly marked one-way or direction-sensitive must not
  offer reverse traversal.
- Background navigation to a distant trailhead in the first release.
- Solving car parking, public transport, or transport-mode planning.

## Terminology

- **Source route:** the immutable route loaded from the catalog, share token, or
  planner.
- **Ride plan:** direction and start choice confirmed by the rider.
- **Effective route:** the navigation-only geometry and metadata derived from
  the source route and ride plan.
- **Approach:** travel from the rider's current position to the effective route
  start.
- **Route guidance:** turn-by-turn guidance on the effective, curated route.
- **Rejoin:** recovery after the effective route has already been acquired and
  the rider subsequently leaves it.

## Journey and state model

```text
route page / planner
        |
        | נווט
        v
ride setup -- location unavailable --> manual setup / retry / cancel
        |
        | confirm
        +---- already at effective start ----> route guidance
        |
        +---- near (<= 1 km) ----------------> nearby approach
        |
        +---- far (> 1 km) ------------------> external handoff recommended
                                                   |
                                                   | return / check location
                                                   v
                                            nearby approach or route guidance

route guidance -- confirmed departure --> off-route rejoin
```

Ride setup is not an active navigation status. It may request a foreground
location permission and obtain one fix, but it does not start the continuous
high-accuracy watcher until the rider confirms a near/on-route ride plan.

## Ride setup interface

The setup opens as a native bottom sheet over the route map.

### Required controls

**Direction (`כיוון המסלול`)**

- `רגיל`
- `הפוך`

**Start (`נקודת התחלה`)**

- `תחילת המסלול`
- `הנקודה הקרובה אליי`
- `בחירת נקודה על המפה`

The direction is applied first. Therefore, `תחילת המסלול` always means the
start of the selected direction; after reversing it refers to the original
route end.

### Recommendation

The app may preselect a recommendation, but never silently commits a choice
that materially skips the route.

- If the rider is at the effective start, recommend the official start.
- If the rider is near another route point and joining would skip no more than
  50 m, treat it as equivalent to the start.
- If joining would skip more than 50 m, expose the nearest option and its
  consequence.
- If joining would skip at least `JOIN_SKIP_PROMPT_M` (currently 1.5 km), require
  explicit confirmation rather than silently selecting it.
- If location is missing or too inaccurate, default to the official start and
  say that distance-based recommendations are unavailable.

Location used for recommendations should be reasonably current and accurate.
Initial implementation constants should be explicit and testable (proposed:
at most 30 seconds old and reported accuracy no worse than 100 m). An older or
less accurate fix may be displayed but must not drive automatic selection.

### Consequence summary

Before confirmation, show concrete results rather than internal terminology:

- `תחילת המסלול נמצאת במרחק 650 מ׳`
- `הצטרפות כאן תדלג על 3.1 ק״מ`
- `המסלול לרכיבה: 24.6 ק״מ`
- `סיום: חניון הבניאס`

For reverse direction, show the new start and finish. For a custom point, update
the summary immediately after the map selection.

### Primary action

The action reflects the next state:

- At the route: `התחל ניווט במסלול`
- Near the route: `התחל והראה דרך למסלול`
- Far from the route: `נווט לנקודת ההתחלה`

The far action opens the external-app chooser or the selected preferred app.
`הישאר ב-CycleWays` may remain a secondary action, but the first release should
not imply full approach navigation when only a direct bearing is available.

## Alternate-start semantics

### Linear route

Selecting a point after the effective start creates a shorter effective route
from that projected point to the selected direction's finish. The setup must
show the skipped distance and new guided distance. POIs and cues before the
selected point are omitted. This is a navigation-only transformation.

The user is not offered a point behind the selected direction's start or beyond
its finish because all choices are snapped onto the source geometry.

### Circular route

Selecting another start rotates the effective geometry at the projected point
and preserves the full loop. It must not discard the prefix as it would on a
linear route. POIs and segment spans rotate with the geometry, and the chosen
point becomes both the effective start and finish.

Use catalog `routeShape.type === "circular"` as the product classification, but
also validate that the geometry has a safe navigable seam. A circular label is
not permission to invent a straight segment between disconnected endpoints.
For routes without metadata, infer a loop only conservatively when the first
and last geometry points are within a small documented closure tolerance. If
classification or seam validation remains uncertain, use linear semantics and
communicate the shortened distance rather than unexpectedly constructing a
loop.

### Projection ambiguities

Loops and out-and-back routes can pass close to themselves. A map-tap selection
must prefer the tapped leg using the existing continuous projection helpers.
The UI should place a visible marker and show the resulting remaining distance
so the rider can detect and correct a wrong leg before confirming.

## Reverse traversal semantics

Reverse is a derived effective route, not `array.reverse()` applied only to the
displayed line. The transformation must update every progress-indexed field:

- geometry order, indexes, and cumulative distance;
- source waypoints;
- start/end metadata;
- elevation gain and loss;
- segment spans and their start/end distances;
- POI/hazard `routeProgressMeters` values;
- navigation route identity, so changing direction recreates the session;
- turn cues, which are regenerated from transformed geometry and therefore
  naturally swap left/right where appropriate.

The source route remains unchanged and can still be edited or shared in its
original direction.

Reverse must be disabled with an explanation when route metadata marks a route
as one-way/direction-sensitive, or when the effective route cannot be built
consistently.

## Approach behavior

Approach always targets the **effective route start** produced by setup.

The selected start is a contract, not a visual hint. Initial acquisition must
be restricted to a small window around effective progress zero. Merely passing
close to another leg of the route on the way to the selected start must not
start guidance. After the start is acquired, the normal forward-window progress
tracker takes over. This also prevents a circular route's colocated finish from
being mistaken for immediate completion at startup.

### Nearby approach: at most 1 km

Preserve the current behavior:

- Always show a thin direct line from the rider to the effective start.
- When connector computation succeeds within coverage, show a heavier dashed
  road-preferring suggested connector.
- Do not generate turn cues, voice instructions, or authoritative follow-route
  behavior for the connector.
- Use an explicit heading: `בדרך למסלול`.
- Show `דרך מוצעת לתחילת המסלול · 650 מ׳` and
  `הניווט במסלול יתחיל כשתגיע`.
- Keep `פתח באפליקציית ניווט` and `שנה הגדרות רכיבה` available.
- Automatically and visibly transition to route guidance only after route
  acquisition succeeds.

The current `CONNECTOR_NEAR_RADIUS_M = 1000` remains the initial threshold. It
is a named policy constant and should be tuned later from device/ride evidence,
not scattered through UI code.

### Far approach: more than 1 km or no connector coverage

- Keep direction and distance to the effective start visible.
- Do not show the dashed connector when it cannot be supported confidently.
- Promote external navigation as the primary action.
- Explain: `המסלול רחוק. מומלץ לנווט לנקודת ההתחלה באפליקציית ניווט.`
- Do not leave a continuous high-accuracy CycleWays watcher running merely to
  cover a long approach.
- Preserve the pending ride plan while handing off. On return, obtain a fresh
  fix and re-evaluate: far, near, or at route.

Apple Maps remains the always-available iOS fallback; installed Google Maps,
Waze, and Moovit options continue to come from the existing app registry. The
travel-mode limitation remains explicit: an external app may provide cycling,
walking, or driving directions and is responsible for that approach leg.

### Transition to route guidance

Do not switch silently. On acquisition:

- show `הגעת למסלול` / `הניווט במסלול התחיל` briefly;
- fire one confirmation haptic;
- replace approach styling with route cue styling;
- start remaining-distance and maneuver-cue presentation from the effective
  route's zero point.

## Changing a ride plan

During setup, choices update freely. During approach, `שנה הגדרות רכיבה` stops
the approach watcher and returns to setup with the current plan preselected.
During active route guidance, changing direction or start requires an explicit
stop-and-restart confirmation; geometry must never change under a live progress
tracker.

## Failure and edge cases

- **Permission denied:** explain why location is useful; allow manual start and
  direction selection, retry, or cancel. Do not pretend to know near/far.
- **Poor/stale GPS:** show accuracy state; do not auto-recommend nearest join.
- **Connector failure:** retain direct line and distance, promote external app.
- **No network/shard coverage:** same far/fallback presentation; source route
  guidance remains available if its offline assets are loaded.
- **Wrong projection at a crossing:** marker plus consequence summary lets the
  user correct the selected point.
- **Rider passes the selected start:** offer a fresh nearest-point choice rather
  than silently changing the ride plan.
- **Wrong-way travel after acquisition:** keep the existing warning; do not
  silently reverse the route.
- **App backgrounded or killed during external handoff:** persist enough of the
  pending ride plan to restore the route token/slug, direction, and selected
  progress point. Validate the point against the reloaded route before use.
- **Route metadata changes:** discard an incompatible persisted ride plan and
  return to setup.

## Architecture

### Pure core

Add a navigation-only ride-plan layer in `@cycleways/core`:

- `createRidePlan(sourceRoute, selection, location)` validates choices and
  derives presentation consequences.
- `buildEffectiveNavigationRoute(sourceRoute, ridePlan)` performs reverse,
  truncate, or loop-rotation transformations and returns a normal
  `NavigationRoute` consumed by the existing session.
- Pure policy helpers classify at/near/far states from the selected target,
  location quality, acquisition thresholds, and
  `CONNECTOR_NEAR_RADIUS_M`.
- Route-transform helpers are deterministic, non-mutating, and node-tested.

The existing navigation session continues to own active GPS fixes, acquisition,
cues, progress, off-route detection, and rejoin. It receives the effective
route only after setup confirmation. Its initial acquisition policy is extended
to require the effective start and seed progress at zero before normal tracking.
The approach target is therefore always effective-route progress zero; the
session no longer needs to act as the primary pre-ride destination picker.

### Native app

- Both the featured-route bridge and Build's `התחל ניווט` open ride setup.
- Build owns the source route, setup state, effective route, active session, and
  setup/approach overlays.
- A one-shot native location service supplies setup recommendations without
  starting the active navigation watcher.
- Existing `DestinationSheet` app detection can be reused for external handoff,
  but destination choice moves into the richer ride setup sheet.
- The map renders the source route faintly and the prospective effective route
  prominently while setup is open.

## Analytics and observability

No precise coordinates are logged. Record coarse product events locally or in
the existing analytics system when available:

- setup opened, confirmed, or cancelled;
- recommended versus chosen start mode;
- forward versus reverse;
- coarse approach tier (`at`, `near`, `far`, `unknown`);
- external handoff app;
- connector ready/failed;
- route acquired after approach;
- persisted ride plan restored/discarded.

These events are needed to tune the 1 km threshold and understand whether
alternate-start/reverse choices are discoverable.

## Accessibility and copy

- All choices are normal accessible controls, not map-only gestures.
- Direction and start choices expose selected state to VoiceOver.
- Consequences are text, not color alone.
- Custom map selection always has a non-map cancel/confirm path.
- Hebrew copy uses `התחלה`, `כיוון`, `בדרך למסלול`, and `ניווט במסלול`
  consistently; avoid the ambiguous single-word `יעד` as the primary label.

## Acceptance criteria

- Pressing `נווט` never begins continuous route guidance before setup is
  confirmed.
- A nearby rider can keep using the current dashed connector suggestion.
- A far rider sees external navigation promoted and CycleWays does not maintain
  an unnecessary high-accuracy approach watch.
- The confirmed start, direction, skipped distance, guided distance, and finish
  are visible before starting.
- A linear alternate start shortens the effective route correctly.
- A circular alternate start preserves one complete loop.
- Passing another nearby/crossing leg does not acquire the route before the
  confirmed start, and a loop does not immediately complete at its start seam.
- Reverse traversal produces correct progress, turn directions, segment
  context, POIs, endpoints, and elevation totals.
- The source route/token/draft remains byte-for-byte unchanged.
- Reaching the effective start produces an explicit approach-to-route
  transition.
- Permission, connector, coverage, and stale-location failures have usable
  fallbacks.
