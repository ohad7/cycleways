# Android Play Store Release — Design

**Date:** 2026-07-06
**Status:** Design (approved conversationally; see implementation-plan.md for the plan)
**Related:** `ios-app-store-release/`, `background-location-voice-guidance/` (iOS background nav — the Android parallel of this is Phase 5 here)

## Goal

Take the existing Expo/React Native app (`apps/mobile`, already prebuilt for
Android under `apps/mobile/android/`) from "configured but never launched" to a
published Google Play app under the **Cycleways** brand, and close the
Android-specific code gaps found during review.

## Context / findings

The app is **not** an iOS-only project. Static review found it is ~80% ready
for Android:

- Native project exists: package `app.cycleways.mobile`, adaptive icons, app
  name `CycleWays`, deep-link scheme `cycleways`, Hermes + new architecture.
- JS is cross-platform. Only three `Platform.OS` guards exist, all in
  `src/navigation/locationService.js`, all deliberately gating iOS-only
  background location.
- Mapbox, the bundled static web server, the route-detail WebView, TTS, audio,
  haptics, keep-awake are all cross-platform.

Gaps found (evidence in the review; carried into tasks below):

1. **Toolchain.** No Android SDK/JDK/device is set up, so nothing can build or
   run today. Lightest path: JDK 17 + command-line SDK tools + a physical
   Android phone (no full Android Studio GUI required).
2. **Release-only cleartext bug.** The route-detail "story" WebView loads the
   bundled site over `http://localhost:PORT` (`src/screens/RouteDetailWeb.jsx`,
   `src/webServer.js`). Only the **debug** manifest variants set
   `usesCleartextTraffic="true"`; the `main`/release manifest does not, and
   there is no network-security-config. Result: works in debug, **silently
   broken in a Play release build**.
3. **Android background / locked-screen turn-by-turn is unimplemented.**
   `startNavigationBackgroundUpdates()` and permission requests early-return on
   `Platform.OS !== "ios"`, and the manifest lacks `ACCESS_BACKGROUND_LOCATION`
   + foreground-service permissions. Foreground nav (screen on) works;
   background/locked-screen tracking does not. This mirrors what
   `background-location-voice-guidance/` did for iOS.
4. **Release signs with the debug keystore.** `android/app/build.gradle`
   release buildType points at `signingConfigs.debug`. Fine for local runs,
   unacceptable for Play — needs a real upload keystore + Play App Signing.
5. **Mapbox gradle download token.** Root `build.gradle` treats
   `MAPBOX_DOWNLOADS_TOKEN` as optional; if the first native build fails
   fetching the Maps SDK, this is why. Verify early.

## Key decisions (settled in discussion)

- **Google Play account:** created under a dedicated brand Google account
  `cycleways.app@gmail.com` (owner), with Ohad's personal Google account added
  as **Admin**. Secure the brand Gmail with 2FA before attaching billing.
- **Account type: Personal** (Cycleways is not a legal entity), verified
  against Ohad's government ID — matching the Apple Developer setup. Public
  developer display name set to **"Cycleways"**.
- **Consequence — the 14-day tester gate is the critical path.** Personal
  accounts must have **20 testers opted in on a closed testing track for 14
  continuous days** before applying for production. Nothing shortens those 14
  days except starting them, so identity capture + a closed-track build happen
  first and everything else runs in parallel.
- **"Capturing the name"** on Play = claiming the **package id**
  `app.cycleways.mobile` (permanent, global) by uploading one build. The store
  **title** is not globally unique; true brand protection is a trademark, out
  of scope here.

## Scope decision: foreground-first launch, background nav as fast-follow

Building the Android background-location layer (Phase 5) is a real
sub-project comparable to the iOS `background-location-voice-guidance/` work.
To avoid it blocking the 14-day clock:

- **v1 (this plan, Phases 0–4, 6):** ship with **foreground navigation only**
  (works today once built) plus a clear in-app note that Android locked-screen
  guidance is coming. This is enough to capture the identity, start the tester
  clock, and get to production.
- **Phase 5 (background nav):** sequenced in parallel during/after the 14-day
  window; may be promoted to its own spec + plan if it grows. Recommendation is
  to land it before *wide* public promotion, since locked-screen guidance is
  core to a cycling nav app — but it does not gate the initial release.

If the user decides locked-screen nav must ship in v1, Phase 5 moves ahead of
Phase 6's production submission.

## Architecture — the code changes

### Cleartext localhost (Phase 2)

Add `android/app/src/main/res/xml/network_security_config.xml` permitting
cleartext **only** to `127.0.0.1` and `localhost`, and reference it from the
`main` manifest's `<application>` via `android:networkSecurityConfig`. Keep the
rest of the app cleartext-blocked (default). This makes the release WebView
load the bundled server while preserving HTTPS-only for real network traffic.
Because `apps/mobile/android/` is a committed prebuild, the change is made
directly in the native manifest/res; if the app is ever re-prebuilt from
`app.json`, the same config is reproduced via an Expo config plugin
(`plugins/withAndroidCleartextLocalhost.js`) so it is not lost.

### Android background location (Phase 5)

Mirror the iOS background nav design:

- Extend `expo-location` plugin config in `app.json` with Android
  foreground-service + background-permission options; add
  `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_LOCATION` to the manifest.
- Remove the `Platform.OS !== "ios"` early-returns in
  `src/navigation/locationService.js` so `startNavigationBackgroundUpdates`,
  `requestNavigationPermissions({ background: true })`, and
  `getNavigationPermissionStatus` run the real path on Android, guarded by a
  runtime capability check rather than a hard platform gate.
- Reuse the existing `NAVIGATION_LOCATION_TASK` background task
  (`src/navigation/backgroundNavigationTask.js`) — it is already
  platform-neutral.
- Add the Android **prominent-disclosure** permission-priming UI required by
  Play before requesting background location.

### Release build pipeline (Phase 4)

Add an `android` platform to `apps/mobile/fastlane/Fastfile` mirroring the iOS
lanes' out-of-repo-secrets pattern: keystore + Play service-account JSON live
under `~/.playstore/`, never committed. A `build_aab` lane produces a signed
`.aab`; an `upload_internal` lane pushes to the closed testing track via
`supply`. Release `signingConfig` in `build.gradle` reads keystore properties
from `~/.gradle/gradle.properties` (or an out-of-repo file), never hardcoded.

## Testing

- **Device smoke (Phase 1):** debug build on a physical Android phone; verify
  map render, route planning, foreground navigation, and — after Phase 2 — the
  route-detail story WebView.
- **Maestro:** the existing `.maestro/` flows run on Android via
  `maestro test` against the connected device; use them to guard the WebView
  and nav-start flows.
- **Release WebView regression (Phase 2):** the story page must load in a
  **release** build (not just debug) — the whole point of the cleartext fix.
- **Background nav (Phase 5):** use the `nav-scenario-harness/` simulate-ride
  dev mode plus a real locked-screen device test.

## Risks

- **Mapbox download token** may block the first build (finding 5) — verified in
  Phase 1 before anything else is invested.
- **Background-location Play review** (Phase 6) is the most common rejection
  reason for nav apps; the prominent-disclosure flow + a demo video are
  required. Only relevant once Phase 5 ships.
- **14-day clock** is unavoidable; front-loading Phases 0–4 minimizes calendar
  time to production.
