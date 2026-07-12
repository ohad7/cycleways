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
`arrivalDetectedAt` record field is superseded). Arrival is eligible only
after route acquisition and uses the tracker's bounded cursor rather than a
global nearest-to-the-finish check. This prevents a loop's shared start/end
point from ending the ride before acquisition, but the tracker is only
monotonic-ish (it permits bounded regression), so loop, short-loop, and
self-crossing fixtures are explicit regression tests rather than an assumed
invariant.

**R2 — Fast, jitter-proof end.**
Once latched, the session transitions `status: "ended"` (new
`endReason: "arrived"`) on the **second consecutive arrival fix** (~2–3 s at
1 Hz). A single non-arrival fix before confirmation clears the latch (one
noisy fix cannot end a ride). There is no timer fallback: without another
location fix the core cannot distinguish arrival from a single noisy sample,
and a nominal wall-clock fallback would require a separate timer lifecycle.
While latched, off-route/rejoin transitions are suppressed — riding past the
finish completes the arrival instead of rerouting.

**R2a — Distinct arrival preview and final messages.** *(Amended 2026-07-12.)*
The destination cue enters preview at 200 m (other maneuver previews remain at
120 m). Its card and voice say "בעוד 200 מטרים תגיע ליעד". Crossing
into the existing final window keeps the definitive "הגעת ליעד" message, so
approach and arrival are no longer presented as two identical events.

Core `ended` is a state transition, not native cleanup. Foreground automatic
arrival and manual stop share one idempotent finalizer in
`useNavigationSession`: stop the foreground watch, stop background updates,
release keep-awake, stop pending speech, and clear the persisted active
session. The headless runtime performs the equivalent clear+background-stop
path as soon as the core ends and stops processing the rest of that fix
batch. When arrival happens under a locked screen, the ride ends headlessly
after the arrival announcement and no summary is shown on unlock — accepted
for this round (a persisted "completed ride" summary is possible future
work).

**R3 — Headless voice speaks only off-screen.**
`processBackgroundNavigationFixes` keeps processing and persisting whenever it
receives fixes, but it consults an injectable app-activity probe whose
module-initialization default treats every AppState except confirmed
`"background"` as foreground-active (including launch-time `null`), and
**skips speech while the app is foreground-active** without a registered
foreground processor. The safe default exists before React mounts, so a
TaskManager callback delivered during bootstrap cannot speak a zombie cue.
Lock-screen and true-background guidance (its purpose) are unchanged.

**R4 — Launch-time resume policy: hot auto-resume, warm prompt, else clear.**
Checked once at app root on launch (not waiting for BuildScreen to mount),
based on the persisted record's `lastProcessedFixTimestamp`:

- **Hot** (≤ 10 min old): navigate straight into the Build screen and invoke a
  dedicated restored-session activation path. It restores the snapshot
  before exposing an idle session, then reattaches the foreground watch and
  either background updates or keep-awake without dispatching the normal
  `START`/`PERMISSION_GRANTED` reset path. This is the mid-ride crash case — no
  prompt while riding.
- **Warm** (≤ 60 min): alert-style prompt — continue (uses the same dedicated
  activation path) or end the ride (clears persistence and stops the orphaned
  background task; no foreground session is mounted yet).
- **Stale** (> 60 min): clear silently. The store's own staleness window
  (`STALE_AFTER_MS`) shrinks from 6 h to 60 min to match.

Active-ride classification runs before pending ride intents and before cold
deep-link resolution, regardless of whether `Linking.getInitialURL()` returns
a URL. An active ride wins: hot resumes immediately; warm asks first. Ending
a warm ride allows the deferred URL/pending intent to continue; continuing
the ride leaves that launch intent unapplied. Invalid/none/stale records also
stop any orphaned background location task after clearing. The persisted
`sessionId` and effective-route id must both match before a snapshot can be
activated; mismatch is a safe end+clear, never a silent fresh ride.

**R5 — Planner locate-me preserves the view.**
The locate button centers on the rider and keeps current zoom and pitch;
heading is untouched, including a heading the rider set by rotating the map.
One exception: when zoomed out past `LOCATE_MIN_ZOOM` (12), zoom in to 14.5 —
locating from a whole-country view must land somewhere readable.

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

Node tests (core policy plus dependency-injected mobile lifecycle modules):

- `navigationSession`: latch → two-fix confirm → `ended`/`arrived`; latch
  cleared by a non-arrival fix; off-route suppressed while latched; loop,
  short-loop, and self-crossing routes do not latch at the start; snapshot
  round-trips the latch.
- Native lifecycle coordinator: manual stop and foreground arrival invoke the
  same finalizer exactly once; every resource is released; `endReason` is not
  overwritten.
- Headless runtime policy: bootstrap-safe activity probe — speaks when
  inactive, silent when foreground-active, still persists in both cases;
  arrival breaks the batch and clears instead of persisting an ended session.
- Resume policy and activation: pure hot/warm/stale classifier; active-ride
  precedence over URL/pending intent; matching snapshot restores progress and
  reattaches services without resetting the tracker; id/route mismatch clears;
  60 min store staleness.
- `routeProgress`: earliest-candidate acquisition on straight, loop, and
  out-and-back fixtures; +200 m join; approach target switches to nearest
  below the prompt threshold.

Device/simulator: Release-sim smoke that the Build screen still opens and a
seeded restored-hot-session launch lands in navigation UI with its saved
progress and a live foreground watch; real-ride validation for arrival end and
mid-route join on the next TestFlight build.
