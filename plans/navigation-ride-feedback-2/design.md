# Navigation Ride Feedback Round 2 — Design

**Date:** 2026-07-12
**Source:** Owner test-ride feedback on TestFlight build 5 (2026-07-11), items
1, 3, 4, 5 of six. Item 2 (out-of-route experience rethink) and item 6
(roundabout detection and cues) are deferred to their own future topics.

## Problem

Four ride-tested gaps in turn-by-turn navigation:

1. **Arrival never ends the ride.** The `arrive` cue announces the
   destination, but the session stays active until the rider presses end.
   Riding past the finish flags `offRoute` and the rejoin logic routes the
   rider *back* to the destination they just left.
2. **Crashed rides resume as a zombie.** iOS revives the TaskManager location
   task on relaunch; `processBackgroundNavigationFixes` rebuilds the persisted
   session (fresh for up to 6 h) headlessly and speaks cues while the rider is
   foregrounded on Discover with no navigation UI, no prompt, and no way to
   see what is talking.
3. **Planner locate-me clobbers the view.** The locate button always jams
   `zoomLevel: 14.5` and passes no pitch, discarding the rider's current
   zoom/pitch.
4. **No mid-route join.** Every built route sets `requiresStartAcquisition`,
   gating acquisition to within 150 m along the route of the chosen start.
   A rider standing +200 m from the start never acquires and is told to go
   back; the `approachTargetChoices` start-vs-nearest machinery exists in core
   but nothing consumes the nearest option for small skips.

## Decisions

**R1 — Arrival latches in the core session and auto-ends the ride.**
`navigationSession` owns arrival (today only the background runtime
approximates it). While acquired, a fix with progress-based
`remainingMeters <= ARRIVAL_LATCH_M` (15) latches `arrivalDetectedAt` into
session state (persisted via snapshot; the runtime's parallel
`arrivalDetectedAt` record field is superseded). Remaining distance derives
from the monotonic progress cursor, so loops and self-crossing routes cannot
false-latch at the start — that is the structural premature-end protection.

**R2 — Fast, jitter-proof end.**
Once latched, the session transitions `status: "ended"` (new
`endReason: "arrived"`) on the **second consecutive arrival fix** (~2–3 s at
1 Hz); a 30 s wall-clock fallback after the latch covers sparse fixes. A
single non-arrival fix before confirmation clears the latch (one noisy fix
cannot end a ride). While latched, off-route/rejoin transitions are
suppressed — riding past the finish completes the arrival instead of
rerouting. Auto-end reuses the existing `ended` status so the current
end-of-ride UI (summary/feedback flow), persisted-session clear, and
background-updates stop all apply unchanged. The background runtime replaces
its "stop location updates after 60 s" arrival behavior with the same
end+clear path. When arrival happens under a locked screen, the ride ends
headlessly after the voice announcement and no summary is shown on unlock —
accepted for this round (a persisted "completed ride" summary is possible
future work).

**R3 — Headless voice speaks only off-screen.**
`processBackgroundNavigationFixes` keeps processing and persisting whenever it
receives fixes, but it consults an injectable app-activity probe (default:
`AppState.currentState === "active"`) and **skips speech while the app is
foreground-active** without a registered foreground processor. Lock-screen and
true-background guidance (its purpose) are unchanged.

**R4 — Launch-time resume policy: hot auto-resume, warm prompt, else clear.**
Checked once at app root on launch (not waiting for BuildScreen to mount),
based on the persisted record's `lastProcessedFixTimestamp`:

- **Hot** (≤ 10 min old): navigate straight into the Build screen; the
  existing `useNavigationSession` mount-restore continues the ride. This is
  the mid-ride crash case — no prompt while riding.
- **Warm** (≤ 60 min): alert-style prompt — continue (navigates as above) or
  end the ride (clears the store, stops background updates).
- **Stale** (> 60 min): clear silently. The store's own staleness window
  (`STALE_AFTER_MS`) shrinks from 6 h to 60 min to match.

**R5 — Planner locate-me preserves the view.**
The locate button centers on the rider and keeps current zoom and pitch;
heading is untouched (the planner stays north-up because nothing ever sets
it). One exception: when zoomed out past `LOCATE_MIN_ZOOM` (12), zoom in to
14.5 — locating from a whole-country view must land somewhere readable.

**R6 — Mid-route join: earliest on-route candidate acquires.**
`routeProgress` acquisition (the `requiresStartAcquisition` branch) changes
from "within 150 m of the chosen start" to **earliest-candidate**: among
projections within the enter threshold, acquire at the smallest
`progressMeters`. Standing at a loop's shared start/end picks progress 0; on
an out-and-back's shared corridor it picks the outbound leg; +200 m from the
start acquires at 200 m immediately. In the session's approach phase, the
guidance target for small skips becomes `choices.nearest` (voice guides to the
join point, not back to the start) when the skip is below
`JOIN_SKIP_PROMPT_M` (1500 m); at or beyond it, today's guide-to-start
behavior is kept and the start-vs-join *prompt UI* remains deferred future
work (the core `shouldPrompt` signal already exists).

## Non-goals

- Out-of-route camera/guidance rethink (feedback item 2) — separate topic.
- Roundabout classification and cues (feedback item 6) — separate topic,
  needs the OSM pipeline.
- A start-vs-join prompt UI for ≥ 1500 m skips.
- Android parity work (android-release plan owns it).

## Testing

Node tests (all decision logic is pure core):

- `navigationSession`: latch → two-fix confirm → `ended`/`arrived`; latch
  cleared by a non-arrival fix; 30 s fallback; off-route suppressed while
  latched; loop route does not latch at start; snapshot round-trips the latch.
- `navigationRuntime`: injectable activity probe — speaks when inactive,
  silent when foreground-active, still persists in both cases; arrival path
  ends and clears instead of only stopping updates.
- Resume policy: pure hot/warm/stale classifier unit-tested; 60 min store
  staleness.
- `routeProgress`: earliest-candidate acquisition on straight, loop, and
  out-and-back fixtures; +200 m join; approach target switches to nearest
  below the prompt threshold.

Device/simulator: Release-sim smoke that the Build screen still opens and a
restored-hot-session launch lands in navigation UI; real-ride validation for
arrival end and mid-route join on the next TestFlight build.
