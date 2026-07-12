# Off-Route Experience Rethink — Design

**Date:** 2026-07-12
**Source:** Owner test-ride feedback on TestFlight build 5 (2026-07-11), item 2
of six ("when the user goes out of the route during navigation, the map zooms
out and the user loses focus on his position and how to come back"). Deferred
from `plans/navigation-ride-feedback-2/` as its own topic.

## Problem

Going off-route today flips the camera stage to an **overview fit** framing
the rider + the rejoin target + the suggested connector
(`cameraViewportIntent.js` `case "off-route"`: `viewportMode: "overview"`,
`minZoom: 12`, pitch 20, `transition: { kind: "immediate", durationMs: 0 }`).
Mid-ride, at riding zoom (~16–17) and pitch (~55°), that is a hard cut from an
intimate follow view to a wide overhead map — the rider loses their own
position and has to map-read while moving. Voice fires one "off-route" alert
and a later "rejoin-ready", but nothing guides the rider along the way back.

The underlying *data* is sound and is kept: the rejoin target is the nearest
on-route projection ahead of confirmed progress (never backward, ≤ 1.5 km,
`selectConnectorTarget` mode `"rejoin"`), a connector back is auto-requested
and drawn, and re-acquisition hands back to normal guidance.

## Decisions

**O1 — Off-route is a follow stage, not an overview.**
`cameraViewportIntent`'s `off-route` case changes to follow mode:
rider-centered, `bearingPolicy` course-up, pitch in the riding range
(target 38, range 35–40), and `zoomPolicy` **corridor-fit with the rejoin
connector geometry as the corridor** — the way back is framed ahead of the
rider exactly like an upcoming maneuver. Zoom is floored at 14.5; when the
connector does not fit at the floor, its far end stays off-screen — the rider
is following guidance, not reading a map. While the connector has not arrived
yet, the corridor is the straight rider→rejoin-target line.

**O2 — Eased transition, never a cut.**
The stage transition into (and out of) off-route is eased, ~600 ms, replacing
`immediate`/0 ms. Re-acquisition returns to the normal follow stage through
the existing reacquire transition.

**O3 — Manual override unchanged.**
Panning/pinching during off-route flips `cameraIntent` to `"free"` and the
recenter button re-engages, identical to normal follow. A rider who wants the
overhead picture zooms out themselves; the app never forces it.

**O4 — Guided rejoin: the connector is a guided leg.**
When the rejoin connector arrives, it is treated like the pre-ride approach
leg in ownership tier `"guide"` (`approachLeg.js` machinery): turn cues are
built along the connector and voiced ("פנו ימינה בעוד 80 מטר"), ending with
the existing reacquire/"back on route" announcement. The off-route alert
remains the entry announcement. While no connector is available (routing
failed or still requesting), voice stays as today: the single alert, then the
rejoin-ready announcement when a connector lands.

**O5 — Live off-route banner.**
The navigation card shows an off-route state with live distance back
("יצאתם מהמסלול · 120 מ׳ לחזרה"), replacing the generic state text, so the
screen answers "how far back?" at a glance. The distance is the remaining
meters *along the guided rejoin leg* (`approach.approachProgress.remainingMeters`)
when a leg is active — monotonic while the rider follows guidance — falling
back to the straight-line `approach.distanceToRouteMeters` before a connector
arrives or when routing failed. *(Amended 2026-07-12: straight-line distance
can rise while the rider correctly follows the connector around a block.)*

**O6 — Rejoin target logic unchanged.**
Target selection (nearest-ahead, forward window 1.5 km, slides forward as the
rider moves) and connector request/refresh throttling stay as they are.

## Non-goals

- A deliberate-detour affordance ("stop guiding me back" / reroute from here).
  The forward-sliding rejoin target absorbs mild shortcuts; an explicit
  detour mode is future work.
- Changing off-route *detection* thresholds (enter/confirm/recover dwell in
  `routeProgress.js`) — no ride evidence against them.
- Any change to rejoin connector routing/cost model.

## Testing

Camera intent, cue building, and session transitions are pure core:

- `cameraViewportIntent`: `off-route` returns follow mode, corridor-fit with
  rejoin geometry, pitch 35–40, zoom floor 14.5, eased ~600 ms transition;
  fallback corridor is the rider→target line before the connector arrives.
- Session/approach: rejoin connector in `"guide"` tier produces approach-leg
  cues; cue events voice along the connector; reacquire hands back with the
  existing acquired announcement; no guided cues when the connector request
  fails.
- Presentation: off-route card state carries the live distance.
- Device validation: deliberately leave a route on a ride; confirm the camera
  stays rider-centered, instructions guide back turn-by-turn, and rejoin
  hands back cleanly. Under a locked screen the guided-rejoin voice must keep
  speaking (same headless path as normal cues).
