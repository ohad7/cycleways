# iOS When-In-Use Lock-Screen Navigation Spike

**Date:** 2026-07-10  
**Status:** Native-source analysis complete; lock-screen device case **passed
2026-07-11** (see "Device results" below). Home-screen and repeat-run cases
still pending before the Always-removal follow-up plan.

## Question

Can CycleWays keep navigation progress and spoken cues working after the
screen locks (or the app moves to the background) when the rider grants only
**While Using the App**, without requiring **Always** location permission?

This spike does not remove the Always-permission flow or the TaskManager
background-location path. Those changes remain out of scope until a real-device
test establishes that the proposed permission model is reliable.

## Version and evidence

The repository resolves `expo-location` **56.0.18** and `expo-audio`
**56.0.12**. The installed `node_modules` tree was not present, so the exact
`expo-location-56.0.18.tgz` referenced by `package-lock.json` was downloaded to
`/tmp` and inspected. Its SHA-256 was
`898ddc98992432cc80339dcc03699b9b889f39cb533d1c6e6271d2d43c5e8153` and its
package metadata reports Expo repository commit
`812dc007aefed0c432c0439fdfe05ee2f4f21da2`.

Relevant upstream references:

- [Expo Location SDK 56 documentation](https://docs.expo.dev/versions/v56.0.0/sdk/location/)
- [Expo SDK 56 `LocationModule.swift`](https://github.com/expo/expo/blob/sdk-56/packages/expo-location/ios/LocationModule.swift)
- [Expo SDK 56 `BaseLocationProvider.swift`](https://github.com/expo/expo/blob/sdk-56/packages/expo-location/ios/Providers/BaseLocationProvider.swift)
- [Expo SDK 56 `EXLocationTaskConsumer.m`](https://github.com/expo/expo/blob/sdk-56/packages/expo-location/ios/TaskConsumers/EXLocationTaskConsumer.m)
- [Expo Audio SDK 56 background-playback configuration](https://docs.expo.dev/versions/v56.0.0/sdk/audio/#playing-audio-in-the-background)

## Native-source findings

### `watchPositionAsync` is foreground-only in 56.0.18

`watchPositionImplAsync` checks foreground permission and creates a
`LocationsStreamer`. The streamer's base provider explicitly sets:

```swift
manager.allowsBackgroundLocationUpdates = false
```

It does not inspect the app's `location` background mode and does not switch
that value to `true`. Therefore the implementation-plan hypothesis that the
ordinary foreground watch might itself continue under lock is not supported by
the shipped module source. A device experiment must not disable TaskManager and
then rely on `watchPositionAsync`; that would test a path Expo explicitly
configures as foreground-only.

### `startLocationUpdatesAsync` does not hard-require Always in 56.0.18

The SDK 56 implementation checks that location services are enabled, that
**foreground** location permission is granted, and that the native `location`
background mode exists. It does not call the background-permission guard and it
does not merely log a warning. Its own source comment says it intentionally
checks only foreground permission because a user-initiated foreground service
does not require background permission, while Expo cannot distinguish that case
from a conventional background service.

After registration, `EXLocationTaskConsumer` creates a separate
`CLLocationManager` and sets:

```objc
locationManager.allowsBackgroundLocationUpdates = YES;
```

It also applies `showsBackgroundLocationIndicator` from the supplied options;
CycleWays currently supplies `true`. This TaskManager-backed manager, not the
foreground watch, is the only shipped Expo Location path that is configured to
continue standard location updates in the background.

There is a meaningful source/docs mismatch: the Expo SDK 56 documentation says
iOS background tracking should use Always permission, while the 56.0.18 native
entry point accepts foreground permission and explicitly describes a
user-initiated exception. Source inspection shows that a When-In-Use experiment
is technically reachable; it does not prove iOS will keep delivering reliably
on the target OS/device or that App Review expectations are satisfied.

### Current CycleWays wiring cannot perform the experiment unchanged

`requestNavigationPermissions({ background: true })` requests background
permission, and `useNavigationSession` starts background updates only when that
request reports `background: true`. Consequently, denying Always prevents
CycleWays from registering the TaskManager location consumer even though Expo
56.0.18 itself only checks foreground permission.

The device build now includes a development-only experiment flag,
`EXPO_PUBLIC_NAV_WHEN_IN_USE_SPIKE=1`, that:

1. requests foreground permission only;
2. still calls `startNavigationBackgroundUpdates()` while the ride is started
   in the foreground; and
3. leaves the TaskManager consumer enabled.

The flag is additionally guarded by `__DEV__`, so it cannot alter a production
build. Remove it after results are recorded.

## Physical-device protocol — not run

Task 4 now declares both `location` and `audio` native background modes,
configures Expo Audio background playback, and sets the runtime audio session's
`shouldPlayInBackground` option. These changes still require a fresh native
development/TestFlight build before this protocol is valid.

Run on a real iPhone, recording the iOS version, device model, build identifier,
and timestamps for each transition:

1. Install fresh and grant **While Using the App** (not Allow Once); decline or
   skip Always.
2. Enable the dev-only foreground-permission experiment described above.
3. Start a ride and confirm the TaskManager background update registration
   succeeds before leaving the foreground.
4. Lock the phone for at least two minutes and travel past a known cue. Record
   whether speech occurs, whether the blue location indicator appears, and
   whether route progress advances after unlocking.
5. Repeat by pressing Home instead of locking the device.
6. Repeat both cases after a second fresh launch to expose one-session-only or
   stale-registration behavior.
7. As a control, repeat with Always permission on the same build and route.

Also capture any native/JS errors from `startLocationUpdatesAsync`; the current
wrapper converts them to `false`, so the experiment build should log the error
without changing production behavior.

## Device results — 2026-07-11 (lock-screen voice soak test)

Run on a physical iPhone (dev build via `scripts/run-on-device.sh`), using the
Task 20 lock-screen soak test (`lockScreenVoiceTest.js`: ride-style
`startNavigationBackgroundUpdates` keep-alive + a numbered spoken prompt every
10 s for ~2 minutes), after the D11 audio-session-activation fix landed:

- **Run A (control, Always granted):** phone locked for the full run — all
  numbered prompts audible. Confirms D11 lock-screen audio under the current
  permission model.
- **Run B (spike, `EXPO_PUBLIC_NAV_WHEN_IN_USE_SPIKE=1`, While-Using only):**
  no Always prompt (spike path skips it), TaskManager consumer registered from
  the foreground, phone locked — **all 13 prompts (intro + 12) audible**.
  When-In-Use + foreground-initiated `startLocationUpdatesAsync` kept the app
  running and speaking under lock, exactly the Waze/Google-Maps pattern the
  source analysis predicted.
- Caveat from the first (invalid) run B attempt: the `EXPO_PUBLIC_*` flag is
  baked in when Metro starts — a stale bundler silently runs without the
  spike. The soak-test status line shows "מצב ניסוי: בלי הרשאת תמיד" when the
  spike is actually active; treat its absence as an invalid run.

Still pending per the original protocol before a final go: the Home-screen
(backgrounded, not locked) case, a repeat run after a fresh app launch
(stale-registration behavior), and recording the device model / iOS version.
All are runnable indoors with the same soak test.

## Recommendation

**Lock-screen case: go.** The 2026-07-11 device results remove the main
uncertainty. Complete the two remaining soak-test cases above, then create the
follow-up design/plan to drop the Always request while retaining the
TaskManager registration path and adding startup-failure telemetry (per D9,
that removal stays out of this plan's scope).

Original (2026-07-10) recommendation, superseded by the above:
**Do not remove the Always request yet.** Source analysis corrects the proposed
mechanism: a When-In-Use design, if viable, must retain the TaskManager-backed
`startLocationUpdatesAsync` path and initiate it while the app is foregrounded;
the ordinary `watchPositionAsync` path cannot replace it in Expo Location
56.0.18.

The evidence is strong enough to proceed with the narrowly scoped device test,
but there is no go decision until both lock-screen and Home-screen cases pass
repeatedly on a physical device. If they pass, create a follow-up design/plan to
remove the Always request while preserving TaskManager registration and adding
explicit startup-failure telemetry. If they fail, retain Always and record the
specific OS behavior or native error as the reason.
