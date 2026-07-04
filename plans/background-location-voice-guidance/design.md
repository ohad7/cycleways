# Background Location And Voice Guidance - Design

Date: 2026-07-04

## Goal

Implement lock-screen ride guidance for the iOS app so a rider can start
CycleWays navigation, lock the phone, and continue receiving location-based
turn guidance until they pause, stop, arrive, or revoke permission.

This design covers the product behavior, iOS permission posture, background
runtime shape, voice guidance architecture, and App Store implications. It is a
focused follow-up to `plans/ios-app-store-release/`.

Scope note: this plan is iOS-only. Android background location is a different
platform problem (foreground service, persistent notification, separate
permission model) and is explicitly out of scope here.

## Product Position

For a professional cycling navigation v1, background location plus voice
guidance should be treated as a release-quality requirement. A cycling user will
often lock the screen for battery, safety, weather, gloves, or pocket use. If
the app claims turn-by-turn navigation but only works while the screen is awake,
the product will feel incomplete and the current Always/background permission
copy will overpromise behavior the runtime does not provide.

If the product decision is to defer this feature, the app should instead ship as
foreground-only route guidance and remove Always/background location
declarations before App Store submission.

## Terminology

- Voice guidance means the app speaks navigation prompts such as "turn right",
  "return to the route", and "you have arrived".
- Voice commands means the rider speaks commands such as "pause", "stop", or
  "reroute".
- Lock-screen guidance means location updates and essential prompts continue
  while the app is backgrounded because the phone is locked or the user briefly
  switches apps.

Voice commands are not part of this v1 scope. They require speech recognition,
microphone permission, noisier privacy review, outdoor reliability work,
localization, and more battery risk. The v1 feature should be hands-free
guidance, not conversational control.

## Current State

- `apps/mobile/src/navigation/locationService.js` starts a foreground
  `Location.watchPositionAsync(...)` watch using `Accuracy.BestForNavigation`,
  `timeInterval: 1000`, and `distanceInterval: 3`.
- `apps/mobile/src/navigation/useNavigationSession.js` defaults
  `background = false`, requests foreground location for normal navigation, and
  owns the foreground watch lifecycle from React.
- The same files explicitly document that first release navigation is
  foreground-only and that lock-screen behavior needs `expo-task-manager` plus
  physical-device validation.
- `apps/mobile/app.json` already declares
  `NSLocationAlwaysAndWhenInUseUsageDescription`,
  `UIBackgroundModes: ["location"]`, and `isIosBackgroundLocationEnabled: true`.
  That configuration is ahead of the implementation.
- `packages/core/src/navigation/navigationSession.js` is a pure navigation
  session controller. It accepts location fixes, updates progress/off-route
  state, and emits `cueEvent` values.
- `packages/core/src/navigation/navigationCues.js` already builds and selects
  route cues for turns, bends, route entry, hazards/POIs, and arrival.
- `packages/core/src/navigation/cueHaptics.js` already converts cue events to a
  deduped haptic plan.
- `packages/core/src/navigation/navigationPresentation.js` already converts
  session state into Hebrew visual guidance copy for `NavPanel`.
- The mobile app has `expo-location` and `expo-haptics`, but does not currently
  depend on `expo-task-manager`, `expo-speech`, or `expo-audio`.

The important architectural advantage is that most navigation logic is already
pure and testable. The missing work is the native runtime boundary: background
task registration, persisted active-session state, foreground/background
synchronization, and an audio adapter.

One core gap must be closed first: `createNavigationSession` and
`createRouteProgressTracker` keep behavioral state in closure variables that
are not part of the returned state — the cue dedupe key (`mainCueKey`), the
off-route transition flag (`wasOffRoute`), `lastConfirmedProgressMeters`,
`prePauseStatus`, and the tracker's acquisition/progress state. Neither module
has a serialize/restore API today. Rebuilding a "fresh" session from just the
route after a relaunch would silently re-fire the "acquired" cue, reset
`rideStartTimestamp`, forget the off-route transition, and re-speak prompts.
See "Core Session Snapshot And Restore" below.

## User Experience

### Ride Setup

The ride setup sheet should expose two separate controls, named by rider
benefit, not by mechanism ("lock-screen guidance" is engineering language):

- Keep guiding when the screen is locked: enables background location for this
  ride.
- Spoken directions: enables voice prompts for this ride.

The two combinations are asymmetric, and the UI should reflect that:

- Voice without background is genuinely useful: handlebar mount, screen awake,
  spoken prompts.
- Background without voice buys almost nothing the rider can perceive: haptics
  do not fire from a locked phone in a pocket, so its only benefit is accurate
  state on unlock.

Because of this, present the pair as one "hands-free guidance" concept with
voice as the primary switch, and request Always permission only when the
locked-screen half is enabled.

Recommended default for a professional navigation release:

- Lock-screen guidance on by default after the user has seen the explanation.
- Voice guidance on by default when lock-screen guidance is on.
- Haptics remain a separate setting, useful when the screen is awake but not a
  substitute for locked-screen prompts.

When voice guidance is enabled, ride setup should offer a "test voice"
affordance that plays one sample prompt on demand (or automatically on first
enable). It surfaces silent-switch, Bluetooth routing, and volume problems
before departure instead of at the first missed turn — otherwise "voice
guidance doesn't work" becomes the most likely support complaint.

The app should request foreground location first. It should request Always
location only when the user starts or enables lock-screen guidance, with
in-product copy that explains the direct benefit:

- Keep navigation and spoken ride prompts working when the screen is locked.

The priming sequence matters and must be pinned down: show the app's own
explainer card immediately before triggering the iOS Always dialog, at the
moment the user first enables the feature — never at app launch. Because the
While Using -> Always upgrade dialog is one-shot, this pre-prompt is
effectively the only chance to win the grant.

If Always permission is denied, restricted, or silently unavailable because the
user chose "Allow Once", the app should fall back to foreground-only navigation
and show a clear state. It should not keep promising lock-screen guidance.

Foreground-only rides must activate keep-awake (`expo-keep-awake`) for the
duration of navigation. Without it, iOS sleeps the display within seconds and
guidance dies exactly the way this feature is meant to prevent — the fallback
mode the permission flow routes people into would be broken on arrival. This
is a requirement of foreground-only mode, not polish.

Two iOS-specific behaviors the permission UX must handle explicitly:

- The While Using -> Always upgrade dialog is effectively one-shot. After the
  user declines it once, later `requestBackgroundPermissionsAsync` calls return
  denied silently with no dialog. The denied state must therefore distinguish
  "prompt shown and declined" from "prompt suppressed — Always can only be
  enabled in iOS Settings", and route the second case to a Settings deep link.
- iOS can grant provisional Always authorization: the API reports granted while
  the real confirmation prompt is deferred and shown later, and the grant may
  be downgraded afterwards. The app must re-check background permission at ride
  start rather than caching a past grant.

### During Navigation

When the screen is awake, the existing map, banner, haptics, pause, stop,
recenter, and route approach UI remain the primary interface.

When voice guidance is on, mute must be a control, not just a status: a large,
glove-friendly tap target on the navigation screen. Muting mid-ride is the
most common voice interaction there is. A "tap to repeat last instruction"
gesture is the natural companion and a common navigation pattern, but can be
deferred past v1.

When the phone is locked or the app is backgrounded:

- Location updates continue through the background task.
- Essential cue events are processed by the same core session logic.
- Spoken prompts are emitted for the selected voice guidance events.
- The current session snapshot is persisted after each processed update.
- When the app returns to the foreground, the visual UI rehydrates from the
  latest persisted runtime state rather than pretending no time passed.

The return-from-lock moment should render current state directly: no flash of
pre-lock state, no loading spinner where avoidable, and no replaying of cues
that fired while locked — current state only. On the first successful
locked-screen ride, a small one-time reassurance ("guidance kept running while
your screen was locked") is worth adding, because users do not trust
background behavior until they have seen it work.

Pause and stop must stop background location updates.

Arrival must not depend on the user returning to the app. The session's states
today are idle/requesting-permission/approaching/navigating/off-route/paused/
ended/error — arrival is only a cue, not a state transition, so a cleanup rule
keyed on "session ended" will never fire from arrival alone. The decided
behavior: the runtime announces arrival once, then stops background location
updates on its own after a short confirmation window (for example, the rider
remains within the arrival radius for 1-2 minutes, or immediately if a stricter
policy tests well). Without this, a rider who arrives and pockets a locked
phone leaves background GPS running until they next open the app.

### Spoken Prompt Set

V1 should be deliberately conservative:

- Route acquired: "You are on the route. Navigation started."
- Turn preview: spoken once when a maneuver enters the preview window.
- Turn final: spoken once when the rider is near the maneuver.
- Bend final: optional short heads-up only for sharp bends.
- Off route: spoken once on transition into off-route.
- Route reacquired: spoken when the rider returns to the route.
- Arrival: spoken once.

Do not speak every POI, segment entry, or repeated distance update in v1. Chatty
guidance is worse than sparse reliable guidance during a ride.

The initial voice language should match the app chrome, Hebrew (`he-IL`), with
the prompt planner designed so English or other locales can be added later.

Hebrew TTS specifics to settle early:

- Voice quality for `he-IL` varies a lot by device depending on whether the
  enhanced Siri voice is installed; the device spike matrix must include a
  device with only the default voice.
- Phrasing needs a deliberate register decision made once, up front:
  imperative "פנה ימינה" is standard navigation Hebrew but is gendered —
  decide masculine-imperative vs. neutral phrasing before writing the prompt
  set.
- Test how the chosen voice actually reads numbers and units
  ("בעוד 200 מטר") rather than assuming.
- Keeping street names out of v1 sidesteps the worst TTS problems; keep it
  that way.

## Architecture

```text
Foreground watch / background task
        |
        v
navigation runtime service
        |
        v
@cycleways/core navigation session
        |
        +--> visual presentation -> React UI
        +--> haptic planner -> expo-haptics
        +--> voice planner -> speech/audio adapter
        |
        v
persisted active navigation snapshot
```

### Core Voice Planner

Add a pure planner in `packages/core/src/navigation/`, likely
`navigationVoice.js`.

Inputs:

- `cueEvent`
- current session state
- current time
- user voice settings
- locale

Output:

- `utteranceId`
- `text`
- `priority`
- `language`
- `interruptsCurrentSpeech`
- optional debug reason when no utterance should be spoken

The planner should be deterministic and independently tested. It should own:

- Deduping by cue identity and phase.
- Cooldowns so off-route or jittery fixes do not spam speech.
- Priority rules, such as final turn and off-route being allowed to interrupt a
  lower-priority prompt.
- Distance formatting for speech, separate from display formatting if needed.
- Locale-specific phrasing.

The existing `cueHaptics` planner is a good local pattern: keep decision logic
in core, keep native side effects in a thin adapter.

### Core Session Snapshot And Restore

Prerequisite core work, to land before the mobile runtime is built:

- Add `serialize()` / restore-from-snapshot support to
  `createNavigationSession`, covering the closure state that is not in the
  returned state object: cue dedupe key, off-route transition flag,
  `lastConfirmedProgressMeters`, `prePauseStatus`, and connector request
  bookkeeping.
- Add the same to `createRouteProgressTracker` (acquisition state, progress
  position, any hysteresis state).
- Include voice planner memory (spoken utterance ids, cooldown timestamps) in
  the same snapshot envelope.
- Test that a session restored mid-ride does not re-fire the "acquired" cue,
  preserves `rideStartTimestamp`, preserves the off-route flag, and does not
  repeat already-spoken prompts.

This is the piece that makes "resume guidance after a relaunch" honest; without
it the background task can only rebuild an amnesiac session.

### Navigation Runtime Service

Introduce a mobile runtime layer that becomes the single owner of an active
navigation session.

Responsibilities:

- Start a new session from a serializable navigation route and ride settings.
- Request permissions through the native location adapter.
- Start and stop foreground location watches.
- Register and stop background location updates when lock-screen guidance is
  enabled.
- Dispatch location fixes to `createNavigationSession(...)`.
- Run haptic and voice planners against emitted cue events.
- Persist a snapshot after meaningful state changes.
- Expose subscription/getState APIs for React UI.
- Dedupe location fixes that may arrive from both foreground and background
  sources.

The current `useNavigationSession` hook can either wrap this runtime or be
reduced to a React subscription over it. React should no longer be the only
owner of the navigation lifecycle once background mode is enabled.

### Background Task

Add a top-level task module, likely under
`apps/mobile/src/navigation/backgroundNavigationTask.js`, that calls
`TaskManager.defineTask(NAVIGATION_LOCATION_TASK, ...)` in global scope.

The task must not depend on React hooks, mounted screens, refs, or context. Expo
TaskManager can run the task by spinning up JavaScript without mounting views.

Runtime model: on iOS, `UIBackgroundModes: location` keeps the JS process alive
while updates are flowing, so the task handler fires into the same runtime
where the navigation runtime singleton already lives. The normal path is
therefore cheap: the task forwards fixes to the in-memory runtime. Loading and
restoring the persisted snapshot is the exceptional recovery path (process was
killed and relaunched), not the per-invocation path. Rebuilding cues and the
progress tracker from disk on every 1-3 second location batch would be wasteful
and would turn snapshot fidelity into a per-fix correctness problem.

Task flow:

1. Receive one or more raw locations from Expo Location.
2. Convert each raw location through the existing `toNavigationFix(...)` mapper.
3. If the runtime singleton holds the active session (normal path), forward the
   fixes to it.
4. Otherwise (fresh JS launch), load the persisted active session snapshot and
   restore the pure core session via the core restore API.
5. Dispatch each fix in timestamp order. `cueEvent` is one-shot per dispatch —
   collect cue events per dispatched fix, not from the final state only.
6. Run the voice planner and audio adapter for new cue events.
7. Persist the updated snapshot.
8. If no active session exists, stop the background location task defensively.

The task should process only the active CycleWays route for v1. Background
connector/rejoin route computation should be disabled or treated as
`no-router`, because approach/rejoin suggestions are visual-only today and can
wait until foreground. Off-route voice can still tell the rider to return to
the route without computing a new connector.

### Persistence Model

Persist only what is needed to continue guidance:

- schema version
- session id
- route id / slug / token
- serialized `navigationRoute` or enough route material to rebuild it
- ride settings: direction, start mode, selected start point, haptics, voice,
  lock-screen guidance
- last core state snapshot needed for UI restore
- voice planner memory, such as spoken cue ids and cooldown timestamps
- last processed fix timestamp for dedupe
- started-at timestamp

Do not persist a full raw GPS track by default. That would change the privacy
posture and should be a separate recording feature decision.

Use the existing file-system persistence style where it is sufficient, but keep
the store schema explicit and versioned. Corrupt or stale snapshots should fail
closed: stop background location and show a recoverable error on next launch.
"Stale" must be a concrete, testable rule — for example: schema version
mismatch, route material that no longer loads, or last processed fix older
than 6 hours. A stale snapshot is discarded, the background task is stopped,
and the app returns to a clean non-navigating state.

### Location Strategy

Foreground-only mode can keep the existing `watchPositionAsync(...)` path.

Lock-screen mode should register `Location.startLocationUpdatesAsync(...)` with
the navigation task. While the app is active, the app may also keep a foreground
watch for smoother UI and map behavior. The runtime must dedupe fixes by
timestamp and coordinate so duplicate foreground/background updates do not emit
duplicate prompts.

Recommended initial iOS options for physical-device testing:

- high accuracy while actively navigating
- distance interval around 3-10 meters
- time interval around 1-3 seconds where supported
- `activityType` set for cycling (Fitness or OtherNavigation)
- `pausesUpdatesAutomatically: false` — with the default auto-pause, iOS can
  stop delivering updates after the rider is stationary for a few minutes
  (coffee stop, long light) and may not resume them until the app is
  foregrounded, which presents exactly like "background guidance silently died"
- background location indicator visible during TestFlight
- deferred updates disabled for the first correctness pass

After correctness is proven, battery tuning can add lower update frequency when
the next cue is far away, and deferred updates can be evaluated for long
straight sections.

Important iOS behavior to document in support and QA:

- If the user force-quits the app, continuous background ride guidance should
  not be promised.
- If the user revokes Always permission, the app must fall back to foreground
  mode.
- If Low Power Mode or poor GPS conditions reduce update quality, prompts may
  be late; the UI should expose degraded state where possible.

### Audio Strategy

Prototype with `expo-speech` first because it is the fastest way to validate
the prompt model and locked-screen flow.

However, Expo documents that `expo-speech` does not produce sound on iOS
physical devices when silent mode is enabled. For a professional navigation app,
silent-switch behavior is a release blocker unless the product deliberately
documents that voice guidance requires silent mode off.

The silent-mode failure is really an `AVAudioSession` category problem, and the
audio session is app-global. The cheapest possible fix — and the first thing
the device spike should test — is configuring the session via expo-audio's
`setAudioModeAsync` (`playsInSilentMode: true`, duck-others interruption mode)
and then speaking through `expo-speech`. If that combination passes the device
matrix, the native adapter branch below is avoided entirely.

The implementation should therefore plan for two adapters:

1. `expo-speech` adapter for prototype and possibly v1 if it passes the
   accepted device matrix.
2. Native iOS adapter around `AVSpeechSynthesizer` and `AVAudioSession`, or a
   packaged-audio prompt adapter using `expo-audio`, if `expo-speech` cannot
   satisfy locked-screen, silent-mode, Bluetooth, and interruption behavior.

Do not add `audio` to `UIBackgroundModes` by default. The app should first prove
that location background mode plus one-shot prompts is sufficient. Add audio
background mode only if physical-device testing proves it is required and App
Review notes can clearly justify it.

### Apple And App Store Posture

This feature justifies:

- `NSLocationWhenInUseUsageDescription`
- `NSLocationAlwaysAndWhenInUseUsageDescription`
- `UIBackgroundModes` containing `location`

It does not justify:

- microphone permission
- speech recognition permission
- background audio mode unless testing proves it is required
- collecting or uploading ride tracks

App Store Connect and App Review work:

- Update the privacy policy to describe on-device background location use.
- Update App Store privacy labels only if location is transmitted off-device or
  retained/collected by first-party or third-party services.
- Add App Review notes explaining that Always location is used only during an
  active ride to keep lock-screen guidance and spoken prompts working.
- Ensure screenshots/description do not imply voice commands or automatic
  rerouting if those are not shipped.
- Keep permission strings tightly tied to the active ride use case.

### Observability

Release builds should not upload precise coordinates unless a separate privacy
decision is made. Local diagnostic state is still useful:

- last background task start/stop reason
- last location permission state
- last task error category
- last speech adapter error category
- count of spoken prompts in current session
- last processed fix age

Any future crash or analytics provider must scrub coordinates, route tokens, and
user-entered locations unless the privacy policy and labels are updated.

## Future Direction: Lock-Screen Visual Guidance

A Live Activity / Dynamic Island turn card is the canonical iOS lock-screen
navigation pattern. It is deliberately out of scope for v1, but it is the
intended follow-on: it changes what "lock-screen guidance" means long-term
(visual next-turn state plus voice, and pause/stop without unlocking). Nothing
in this design should preclude adding it later; the runtime-owned session and
persisted snapshot are exactly the state a Live Activity would render.

## Risks

- Expo Speech may be insufficient for locked-screen/silent-mode navigation.
- Background tasks cannot depend on React lifecycle; importing the wrong module
  shape can make the feature appear to work foreground-only while failing
  locked.
- Duplicate foreground/background location sources can double-speak unless the
  runtime dedupes.
- Persisting enough route/session state to restart in a background task is more
  complex than the current hook-owned session.
- Always location permission has higher App Review and user-trust cost.
- Background GPS can materially affect battery life.
- Physical-device behavior is the real source of truth; simulator testing is
  not enough.

## Acceptance Criteria

- Starting a ride with lock-screen guidance enabled requests the right
  permission sequence and starts background location only for the active ride.
- Locking the phone during navigation does not stop progress processing.
- The rider hears the expected prompt near a turn while the screen is locked.
- Returning to the app shows current progress and cue state, not stale pre-lock
  state.
- Stopping or pausing navigation stops background location updates.
- Confirmed arrival stops background location updates on its own, without
  requiring the user to return to the app.
- A session restored after a process relaunch mid-ride does not re-announce
  route acquisition, does not reset the ride start timestamp, and does not
  repeat already-spoken prompts.
- Denying Always permission produces a foreground-only ride with no false
  lock-screen promise.
- Foreground-only rides keep the screen awake for the duration of navigation.
- Voice can be muted mid-ride from the navigation screen with one tap.
- Ride setup can play a sample voice prompt so audio problems surface before
  departure.
- The app does not request microphone permission.
- The app does not persist or upload a raw ride track as part of this feature.
- App Store metadata, permission strings, privacy policy, and review notes match
  the shipped behavior.

## Sources Checked

Official references checked on 2026-07-04:

- https://docs.expo.dev/versions/latest/sdk/location/
- https://docs.expo.dev/versions/latest/sdk/task-manager/
- https://docs.expo.dev/versions/latest/sdk/speech/
- https://docs.expo.dev/versions/latest/sdk/audio/
- https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background
- https://developer.apple.com/documentation/bundleresources/information-property-list/uibackgroundmodes
- https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer
- https://developer.apple.com/documentation/avfaudio/avaudiosession
