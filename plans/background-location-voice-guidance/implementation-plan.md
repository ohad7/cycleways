# Background Location And Voice Guidance - Implementation Plan

Date: 2026-07-04

## Phase 0 - Product And Release Decision

1. Confirm that v1 will ship lock-screen guidance, not just foreground ride
   guidance.
2. Confirm that v1 scope is voice guidance, not voice commands.
3. Confirm initial language. Recommendation: Hebrew first, matching the current
   native navigation UI. Decide the Hebrew phrasing register once, up front:
   imperative "פנה ימינה" is standard navigation Hebrew but is gendered —
   choose masculine-imperative vs. neutral phrasing before the prompt set is
   written.
4. Confirm the accepted behavior when iOS silent mode is on:
   - Preferred: voice prompts still work when the user explicitly enabled
     voice guidance.
   - Fallback only if accepted by product: voice guidance requires silent mode
     off.
5. Confirm that this feature does not record rides or upload ride tracks.
6. Confirm the scope is iOS-only; Android background location (foreground
   service, notification, separate permission model) is a separate future
   effort.
7. Until the decision is made, block App Store submission of any build with
   the current `app.json` configuration: it already declares Always location
   and `UIBackgroundModes: location` while the code is foreground-only, which
   overpromises to both users and App Review.

Acceptance:

- Release scope says either "background location + voice guidance is in v1" or
  "v1 is foreground-only and background permission declarations will be
  removed".
- Voice commands are explicitly deferred.
- Privacy posture remains on-device unless a separate feature changes it.
- No binary ships while permission declarations and shipped behavior disagree.

## Phase 1 - Physical-Device Spike

Purpose: prove the native assumptions before designing too much around the
wrong Expo adapter.

1. Install the minimum prototype dependencies in the mobile app:
   - `expo-task-manager`
   - `expo-speech`
   - `expo-audio` only if needed to test audio-session behavior
2. Create a throwaway top-level background task that:
   - requests foreground permission
   - requests background permission
   - starts `Location.startLocationUpdatesAsync(...)` with cycling-appropriate
     options: `activityType` Fitness/OtherNavigation and
     `pausesUpdatesAutomatically: false`
   - logs task invocations locally
   - speaks one short prompt on a background location update
3. Build a development client or Release-like local build. Do not rely on Expo
   Go for this validation.
4. Test on at least two physical iPhones, at least one of which has only the
   default (non-enhanced) `he-IL` voice installed, and verify how the voice
   reads numbers and units ("בעוד 200 מטר") rather than assuming:
   - unlocked foreground
   - screen locked
   - app switcher background
   - silent switch on
   - silent switch off
   - silent switch on, after configuring the audio session via expo-audio
     `setAudioModeAsync` (`playsInSilentMode: true`, duck-others) and speaking
     through `expo-speech` — the cheapest fix for the documented expo-speech
     silent-mode limitation; if this passes, the native adapter branch in
     Phase 5 is avoided
   - Bluetooth/headphones
   - music or podcast playing
   - Low Power Mode
   - stationary for 5+ minutes mid-"ride" while locked, to verify update
     delivery resumes (auto-pause behavior)
5. Decide the final audio adapter path:
   - keep `expo-speech` only if it passes the accepted matrix
   - otherwise plan a native `AVSpeechSynthesizer`/`AVAudioSession` adapter or
     packaged-audio prompt adapter

Acceptance:

- A real device receives background location task events while locked.
- A prompt can be heard in the accepted lock-screen audio conditions.
- Known limitations are written down before full implementation starts.

## Phase 2 - Core Voice Planner And Session Snapshot/Restore

1. Add a pure voice planner module under `packages/core/src/navigation/`.
2. Convert session `cueEvent` values into voice utterance plans:
   - route acquired
   - turn preview
   - turn final
   - bend final, if enabled
   - off-route
   - route reacquired
   - arrival
3. Add stable utterance ids based on cue type, cue distance, phase, and session
   transition.
4. Add dedupe and cooldown state so jittery fixes cannot repeat the same
   prompt.
5. Add priority rules:
   - final turn and off-route can interrupt lower-priority speech
   - preview prompts should not interrupt final prompts
   - arrival speaks once
6. Add Hebrew phrasing and speech-distance formatting.
7. Extend the existing navigation scenario runner to record voice events in the
   timeline, similar to haptic events.
8. Add unit tests for:
   - happy-path turn preview/final sequence
   - off-route only once per transition
   - reacquired route prompt
   - arrival prompt
   - no voice when disabled
   - no duplicate speech for duplicate fixes
9. Add snapshot/restore to `createNavigationSession`: serialize and restore the
   closure state that is not part of the returned state object — cue dedupe
   key, off-route transition flag, `lastConfirmedProgressMeters`,
   `prePauseStatus`, connector request bookkeeping.
10. Add snapshot/restore to `createRouteProgressTracker` (acquisition state,
    progress position, hysteresis state).
11. Include voice planner memory (spoken utterance ids, cooldown timestamps)
    in the same snapshot envelope.
12. Add restore tests: a session restored mid-ride does not re-fire the
    "acquired" cue, preserves `rideStartTimestamp`, preserves the off-route
    flag, and does not repeat already-spoken prompts.

Acceptance:

- Voice decision logic is testable without iOS.
- A mid-ride session can round-trip through serialize/restore with identical
  subsequent behavior to an uninterrupted session.
- Existing navigation tests still pass.
- Scenario artifacts can show expected spoken prompts without running the app.

## Phase 3 - Persistent Navigation Runtime

1. Introduce a mobile navigation runtime service outside React component
   lifecycle.
2. Move active-session ownership from `useNavigationSession` into the runtime,
   or wrap the runtime from the hook while the runtime owns start/stop and
   background-safe state.
3. Add a versioned active-session store:
   - session id
   - route id / token / slug
   - serialized navigation route
   - ride setup selections
   - voice/haptic/lock-screen settings
   - latest core state snapshot
   - voice planner memory
   - last processed fix timestamp
4. Add runtime APIs:
   - `startNavigation(route, settings)`
   - `stopNavigation()`
   - `pauseNavigation()`
   - `resumeNavigation()`
   - `processLocationFix(fix, source)`
   - `subscribe(listener)`
   - `getState()`
5. Dedupe location fixes from foreground and background sources.
6. Persist state after meaningful updates and before app background transitions
   where possible.
7. On app launch/foreground, load any active session and reconcile it with
   registered background task state.
8. Handle corrupt or stale session snapshots by stopping background updates and
   surfacing a recoverable navigation error. Define "stale" as a concrete rule
   (schema version mismatch, route material that no longer loads, or last
   processed fix older than 6 hours) so it is testable.
9. Keep the runtime a long-lived in-process singleton: restoring from the
   persisted snapshot (via the Phase 2 core restore API) is the recovery path
   after a process relaunch, never the per-fix path. When collecting session
   output, read `cueEvent` per dispatched fix — it is one-shot per dispatch,
   not accumulated in the final state.

Acceptance:

- React UI is no longer the only owner of an active navigation session.
- A background task can process a fix from persisted session data without
  mounted screens.
- Restoring a persisted mid-ride session yields no duplicate or lost cue
  events versus an uninterrupted session.
- Stop/pause reliably tears down both foreground and background location paths.

## Phase 4 - Background Location Integration

1. Add a top-level task module that calls `TaskManager.defineTask(...)` in
   global scope.
2. Ensure the task module is imported by the app entrypoint so it is registered
   in every JS launch mode.
3. Add native location adapter functions:
   - request foreground permission
   - request background permission
   - check background permission
   - start background location updates
   - stop background location updates
   - check whether the task is registered/running
4. Use `Location.startLocationUpdatesAsync(...)` only when lock-screen guidance
   is enabled for an active ride, with `activityType` set for cycling and
   `pausesUpdatesAutomatically: false` (see Phase 1 spike findings).
5. Use the existing `watchPositionAsync(...)` foreground watch for smooth UI
   while active; dedupe against background task fixes in the runtime.
6. Disable background connector/rejoin route computation for v1. If the pure
   session emits a connector request in the background, complete it as
   unavailable or leave it for foreground handling.
7. Add defensive cleanup:
   - no active session -> stop task
   - session ended -> stop task
   - permission revoked -> stop task and mark foreground-only/error state
   - arrival confirmed -> stop task after a short confirmation window. Arrival
     is a cue, not a session state, so "session ended" alone never fires from
     arrival; the runtime must stop background updates itself without waiting
     for the user to return to the app.
8. Add a dev-only status screen or log panel for background task status during
   TestFlight/internal validation.
9. In the task handler, forward fixes to the in-memory runtime singleton when
   it holds the active session (the normal iOS path); only restore from the
   persisted snapshot on a fresh JS launch.

Acceptance:

- Background updates start only after explicit active-ride intent.
- Background updates stop on pause/stop/end/error cleanup and after confirmed
  arrival, without requiring the app to be reopened.
- The app cannot leave a stale background location task running after the ride.

## Phase 5 - Speech And Audio Adapter

1. Add a thin native adapter interface:
   - `speak(utterance)`
   - `stopSpeech()`
   - `getSpeechStatus()`
   - `configureForNavigationAudio(settings)`
2. Implement an `expo-speech` adapter first if the spike allows it.
3. Use `Speech.speak(...)` with:
   - explicit language
   - explicit rate/volume defaults
   - callback/error reporting
   - queue clearing for high-priority interrupts
4. Configure the app-global audio session with `expo-audio`'s
   `setAudioModeAsync` (`playsInSilentMode: true`, duck-others interruption
   mode) before falling back to a native adapter — the expo-speech silent-mode
   limitation is an `AVAudioSession` category problem, and this combination is
   the cheapest fix if the Phase 1 spike validated it.
5. If the spike shows `expo-speech` cannot satisfy the accepted device matrix
   even with the expo-audio session configuration, implement a native iOS
   adapter around `AVSpeechSynthesizer` and `AVAudioSession`, or a
   packaged-audio prompt adapter.
6. Keep the speech adapter side-effect-only. Do not put cue selection,
   dedupe, or phrasing in native code.
7. Expose a sample-prompt entry point on the adapter so ride setup can offer
   a "test voice" affordance without going through the planner.
8. Add local diagnostic counters for prompt attempts, prompt completions, and
   prompt errors without storing coordinates.

Acceptance:

- Spoken prompts are driven by core utterance plans.
- High-priority prompts can interrupt stale lower-priority prompts.
- Silent-mode, Bluetooth, and interruption behavior matches the Phase 0
  product decision.

## Phase 6 - Ride Setup And Navigation UI

1. Add voice guidance and lock-screen guidance controls to the ride setup
   flow, named by rider benefit ("Keep guiding when the screen is locked",
   "Spoken directions"), presented as one hands-free guidance concept with
   voice as the primary switch.
2. Add a "test voice" affordance to ride setup that speaks one sample prompt
   on demand (or automatically on first enable), so silent-switch, Bluetooth
   routing, and volume problems surface before departure.
3. Make permission requests contextual:
   - foreground permission for normal ride guidance
   - background permission only when lock-screen guidance is enabled
   - show the app's own explainer card immediately before triggering the iOS
     Always dialog, at the moment the user first enables the feature — never
     at app launch; the one-shot upgrade dialog makes this pre-prompt the only
     chance to win the grant
4. Add denied/restricted states:
   - foreground denied -> cannot start CycleWays navigation
   - background denied -> start foreground-only with clear messaging, or keep
     the user in setup depending on final UX
   - distinguish "Always prompt shown and declined" from "prompt suppressed by
     iOS (one-shot upgrade dialog already used) — Always can only be enabled in
     Settings", and open the app's Settings page for the second case with
     explicit instructions to choose Location > Always
   - re-check background permission at every ride start; iOS provisional
     Always grants can be downgraded later without the app being told
5. Activate keep-awake (`expo-keep-awake`) for the duration of any
   foreground-only ride, and release it when navigation ends. Without this the
   display sleeps within seconds and the fallback mode is broken on arrival —
   this is a requirement of foreground-only mode, not polish.
6. Show active ride mode in navigation UI:
   - foreground-only
   - lock-screen guidance active
   - voice muted/active
7. Make mute a control, not just a status: a large, glove-friendly tap target
   on the navigation screen that toggles voice mid-ride. ("Repeat last
   instruction" can be deferred past v1.)
8. Add a settings affordance when the user needs to enable Always location in
   iOS Settings.
9. Ensure pause/stop UI calls the runtime and stops background updates.
10. Rehydrate UI state on foreground from the runtime snapshot, rendering
    current state directly: no flash of pre-lock state, and no replaying of
    cues that fired while locked.
11. Add a one-time reassurance after the first successful locked-screen ride
    ("guidance kept running while your screen was locked").
12. Keep existing haptics behavior, but do not rely on haptics for
    locked-screen guidance.

Acceptance:

- The user understands why Always permission is requested.
- The UI never shows lock-screen guidance as active when Always permission is
  unavailable.
- Foreground-only rides keep the screen awake until navigation ends.
- Voice can be muted mid-ride with one tap.
- Ride setup can play a sample voice prompt.
- Returning from lock screen shows current navigation state with no stale
  flash and no replayed cues.

## Phase 7 - iOS Configuration And Apple Systems

1. Keep `UIBackgroundModes: ["location"]` only if this feature ships.
2. Keep `isIosBackgroundLocationEnabled: true` only if this feature ships.
3. Keep `NSLocationAlwaysAndWhenInUseUsageDescription` only if this feature
   ships.
4. Do not add microphone or speech-recognition usage strings.
5. Do not add `audio` to `UIBackgroundModes` unless physical-device testing
   proves it is necessary and App Review justification is prepared.
6. Update generated iOS files through the repo's Expo prebuild process.
7. Update App Store review notes:
   - how to start a ride
   - why Always location is requested
   - that background location runs only during active navigation
   - that voice prompts are guidance, not voice commands
   - that no account is required, if still true
8. Update the privacy policy:
   - on-device location processing
   - no ride-track upload for this feature
   - third-party map/video/network behavior separately from ride guidance
9. Update App Store privacy labels if implementation transmits, stores, or
   collects location beyond on-device processing.
10. Add TestFlight notes asking testers to validate locked-screen prompts,
    battery, Bluetooth, silent mode, and permission fallbacks.

Acceptance:

- Native config, permission copy, App Store metadata, and privacy policy all
  describe the same behavior.
- There is no unused sensitive permission in the binary.

## Phase 8 - Automated Validation

1. Add core unit tests for the voice planner.
2. Extend navigation scenario tests to assert voice event timelines.
3. Add tests around runtime store serialization and corrupt snapshot handling.
4. Add tests for duplicate fix dedupe.
5. Add mobile-adapter unit coverage where practical with mocked Expo modules.
6. Keep existing gates passing:
   - `npm test`
   - relevant navigation test files
   - mobile lint/build gates available in the repo
7. Add a dev scenario that can simulate a ride while voice guidance is enabled,
   so cue timing can be inspected without a physical ride.

Acceptance:

- Pure navigation and voice behavior is covered by deterministic tests.
- Native behavior has at least mocked coverage for start/stop/error branches.
- No existing foreground navigation scenario regresses.

## Phase 9 - Physical Device QA

Run this matrix on TestFlight or a Release-like build, not just the simulator.

1. Permission states:
   - first install
   - Allow While Using
   - Always granted
   - Always denied
   - Always upgrade prompt suppressed (second request after a decline)
   - provisional Always grant later downgraded by iOS
   - Allow Once
   - permission revoked from Settings mid-ride
2. App lifecycle:
   - foreground ride
   - foreground-only ride (background denied): screen stays awake for the
     whole ride and keep-awake releases when navigation ends
   - lock screen for 10 minutes
   - app switcher background
   - unlock and return
   - force quit, with documented expected behavior
   - device reboot, with documented expected behavior
3. Audio:
   - speaker
   - silent switch on
   - silent switch off
   - AirPods/Bluetooth
   - music/podcast playing
   - phone call/interruption
   - volume zero/muted
   - device with only the default (non-enhanced) `he-IL` voice
   - "test voice" in ride setup routes and sounds like real ride prompts
   - mute/unmute mid-ride from the navigation screen
4. Ride behavior:
   - on-route happy path
   - missed turn/off-route
   - route reacquired
   - arrival, including background location stopping on its own after the
     confirmation window with the phone still locked
   - stationary 5+ minutes mid-ride while locked, then riding again
   - long straight section with no cue
   - dense cue area with multiple nearby turns
5. Environment:
   - low GPS accuracy
   - Low Power Mode
   - poor/no network
   - 30-60 minute battery and thermal check
6. Cleanup:
   - stop navigation and verify location indicator/task stops
   - pause navigation and verify expected location behavior
   - crash/relaunch recovery

Acceptance:

- Lock-screen prompt timing is good enough on real rides.
- Battery impact is acceptable for the target ride duration.
- No stale background task remains after navigation ends.
- Known platform limitations are documented in support/review notes.

## Phase 10 - Release Readiness

1. Re-run the broader iOS App Store release checklist in
   `plans/ios-app-store-release/implementation-plan.md`.
2. Ensure screenshots, description, and review notes do not overclaim:
   - no voice commands
   - no automatic rerouting unless separately implemented
   - no safety guarantee
3. Include lock-screen guidance in TestFlight beta instructions.
4. Collect beta feedback from real riders before App Store submission.
5. If physical QA fails the audio matrix and there is no native adapter yet,
   block the "professional navigation" release or reposition the app as
   foreground-only.

Acceptance:

- Product, QA, privacy, and App Review materials agree that background location
  plus voice guidance is shipped and validated.
- The release candidate has completed a physical ride validation pass.

## Estimate

- Prototype/spike: 2-3 engineering days with physical devices.
- MVP implementation after successful spike: 1-2 weeks.
- Production-grade polish and release validation: 3-5 weeks, mostly due to
  physical-device QA, audio edge cases, battery tuning, and App Store/privacy
  hardening.

These numbers assume `expo-speech` (with the expo-audio session configuration)
passes the device matrix. If the native `AVSpeechSynthesizer`/`AVAudioSession`
adapter is required, add at least a week for the native module or config
plugin work plus a full re-run of the audio device matrix.

Voice commands would be a separate project and should not be added to this
estimate.
