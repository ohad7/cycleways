# Navigation Ride-Feedback Fixes — Design

**Date:** 2026-07-10
**Source:** Rider feedback from a real long ride on the TestFlight build, plus a
code review of the navigation stack triggered by that feedback.

## Problem

A long real-world ride surfaced ten issues in iOS turn-by-turn navigation.
Code review confirmed most of them and found their root causes:

1. **Place names are never spoken.** `buildRouteCues` already produces
   `enter-segment` cues and merges segment names into nearby turn cues
   (`ontoSegmentName`), but `cuePhrase()` in `navigationVoice.js` has no
   phrase for either — the data is dropped at the voice layer.
2. **Compass directions are never spoken.**
3. **No voice on the Lock Screen.** `app.json` declares
   `UIBackgroundModes: ["location"]` only — without `"audio"`, iOS refuses to
   start `AVSpeechSynthesizer` output while the app is backgrounded (a locked
   screen backgrounds the app). `speechAdapter.js` also doesn't set
   `shouldPlayInBackground` on the audio session.
4. **Close turn pairs are worse than unannounced-combined:**
   `MIN_TURN_SPACING_M = 20` silently *drops* the second turn of a close pair,
   so the rider is never told about it at all.
5. **Riding backward says nothing.** `routeProgress.js` detects wrong-way
   riding (`progress.wrongWay`, smoothed-course vs route bearing) and shows it
   visually, but no voice event kind exists for it. Separately, when off-route
   the session computes and draws a rejoin connector but the voice only says
   "יצאת מהמסלול" once — the suggestion itself is never voiced.
6. **The map camera permanently disengages.** Any `isGestureActive` camera
   event while following flips `cameraIntent` to `"free"`
   (`BuildScreen.jsx` `handleCameraChanged`), and nothing ever re-engages it
   except the manual center button. One accidental touch (or a spurious
   gesture flag from RNMapbox) disables follow for the rest of the ride.
7. **The 'Always' location permission may be unnecessary in principle.** iOS
   continues delivering location to When-In-Use apps when the session starts
   in the foreground and `allowsBackgroundLocationUpdates` is set (this is how
   Waze/Google Maps ride through a locked screen). The app requests Always
   only because `expo-location`'s TaskManager path demands it.
8. **The bottom-right pill is unintelligible.** It is the data pill in
   `NavPanel.jsx` showing remaining distance plus two tiny mode icons (lock
   state "ממשיך כשהמסך נעול"/"מסך ער" and voice state). The voice icon
   duplicates the adjacent mute button; the lock state is not actionable.
9. **The phone becomes sluggish after a few km.** On *every GPS fix*
   (~1/sec), `dispatch()` → `persistCurrent()` → `JSON.stringify` of a record
   containing the full route geometry ~3 times over (`record.navigationRoute`,
   `sessionSnapshot.state.route`, and `state.cameraTransition.targetGeometry`
   / suggestion geometry when present), then a disk write. Hundreds of KB
   serialized per second on the JS thread, indefinitely.
10. **False turn instructions on curvy no-junction sections.** Junction-gated
    cues landed 2026-07-04 (`29e4ec6`), but **no production code path
    populates `navigationRoute.junctions`** — only the scenario snapshot
    script (`scripts/nav-scenario-route-snapshot.mjs`) bakes junctions into
    fixture routes. Real rides always take the legacy "every ≥40° corner is a
    turn" fallback. This fully explains the rider's report even on the latest
    build.

## Decisions

**D1 — Throttle persistence, slim the snapshot (fixes #9).**
Persist the active-session record on status transitions, on any cue event, and
otherwise at most every 10 s (pure policy helper so it's node-testable). Strip
the route geometry duplication from `session.snapshot()`: persisted state gets
`route: null` (restore already re-injects the live route object) and
`cameraTransition: null` (ephemeral, carries full route geometry). The single
`record.navigationRoute` copy remains — the background task needs it. Serialize
and coalesce filesystem operations so a slow older save cannot overwrite a
newer snapshot or resurrect a session after it is cleared.

**D2 — Add `audio` background mode + background audio session (fixes #3).**
`UIBackgroundModes: ["location", "audio"]` in `app.json`, and
`shouldPlayInBackground: true` in `setAudioModeAsync`. Requires a native
rebuild to take effect; real-device verification remains required.

**D3 — Auto-refollow after idle (fixes #6).**
`USER_PANNED` records a timestamp (fix-clock, not wall-clock, so the dev
journey harness stays coherent); while `cameraIntent === "free"`, a location
fix ≥ 12 s after the last pan flips intent back to `"follow"`.
`handleCameraChanged` re-dispatches (throttled to 1/s) during active gestures
so ongoing panning keeps resetting the idle clock. *Rejected alternative:* a
pan-delta gate before disengaging follow — auto-refollow makes spurious
disengagement self-healing, so the extra gesture heuristics aren't worth the
complexity.

**D4 — Voice content batch (fixes #1, #2, #4, #5).**
- Turn cues speak their merged segment name: "פנה ימינה אל &lt;name&gt;".
- `enter-segment` cues are spoken at final phase only ("ממשיכים על
  &lt;name&gt;"), with a planner-level guard against repeating the same
  segment name consecutively.
- Compound turns: turn pairs closer than 60 m produce "פנה שמאלה ומיד ימינה";
  the hard-drop spacing floor shrinks to 10 m (geometry noise only). The
  follow-up cue is silenced only if the planner actually accepted the earlier
  compound announcement.
- Wrong-way: session emits a `wrong-way` state event on the rising edge of
  `progress.wrongWay`; spoken at alert priority ("אתה רוכב נגד כיוון
  המסלול").
- Rejoin guidance: the first ready rejoin connector per off-route episode
  emits a `rejoin-ready` event; spoken with compass direction and distance
  ("המסלול צפונה מכאן, במרחק כ־50 מטר. עקוב אחרי הקו המסומן").
- Compass words (8-way) are added to the three acquisition phrases (start /
  join-route / reacquired) using `progress.bearingToNextDeg`.
  *Rejected alternative:* per-turn compass directions — cognitive load and
  utterance length for information riders rarely use mid-maneuver.

**D5 — Stop voicing bends (part of #10).**
`bend` cues stay visual + haptic; `cuePhrase` returns null for them. Sharp
open-road curves are road-following, not decisions. The 75° bend threshold
stays.

**D6 — Compute junctions for real routes (fixes #10).**
Extract the snapshot script's junction derivation (nodes referenced by 3+
distinct edges, deduped by edge id, within 50 m of the route) into a pure
`junctionsNearRoute(network, geometry)` helper with a cell-index prefilter so
it's fast enough on-device. Expose it through `ShardedRouteSession`
(ensure coverage → run helper on the indexed network) and
`useCyclewaysApp` (`computeRouteJunctions`). Attach junctions to the
effective route during ride-setup prefetch (before the nav session is created,
without delaying the confirmation tap); `buildEffectiveNavigationRoute` and
`reverseNavigationRoute` pass `junctions` through. Failure/timeout falls back
to `null` junctions (legacy behavior) — never blocks ride start. An empty list
is authoritative only after complete shard coverage; partial coverage is never
used to suppress cues.

**D7 — Verify the rider's two routes end-to-end.**
A diagnostic script decodes a shared route token, computes junctions, and
prints the cue list with/without junction data, so the two reported sections
can be checked directly (and re-checked after threshold tuning).

**D8 — Simplify the data pill (fixes #8).**
Remove the lock/voice mode icons from the NavPanel data pill; it keeps
remaining distance + speed. Voice state lives on the adjacent mute button.

**D9 — Permission spike, decision gated (addresses #7).**
Source inspection confirmed `expo-location`'s foreground watch explicitly
disables background updates. Investigate whether its TaskManager location
consumer, started by the rider in the foreground, keeps delivering under a
locked screen with When-In-Use only. Findings are recorded in this plan
directory. **Removing the Always request is explicitly out of scope** — that
is a follow-up plan, retaining TaskManager, once the spike proves it safe.

**D10 — No new chattiness.**
The conservative-cue philosophy stands: the gaps are missing *kinds* of
speech, not missing volume. Existing cooldown/dedupe/priority machinery in
`navigationVoice.js` gates everything new.

## Phases

1. Performance: persistence policy + snapshot slimming (D1).
2. Lock-screen audio (D2).
3. Camera auto-refollow (D3).
4. Voice batch (D4, D5).
5. Junctions for real routes + route verification (D6, D7).
6. Pill cleanup (D8).
7. Permission spike (D9).

See `implementation-plan.md` for the task breakdown.
