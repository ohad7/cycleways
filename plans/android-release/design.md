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

## Scope decision: background / locked-screen navigation ships in v1 (parity with iOS)

**Decision (2026-07-06):** Android launches with background / locked-screen
turn-by-turn **included**, matching the iPhone experience — a rider starts a
ride, locks the phone, and keeps getting location-based guidance (visual +
spoken) until pause/stop/arrival/permission-revoke. It is a **release-quality
requirement**, not a fast-follow.

This is affordable because the expensive part is already done and
platform-neutral. The iOS `background-location-voice-guidance/` work left the
whole navigation brain in `@cycleways/core` and shared adapters:

- Pure session/cues/haptics/presentation and **session snapshot + restore** live
  in `packages/core/src/navigation/` — platform-agnostic.
- The background task (`src/navigation/backgroundNavigationTask.js`) and runtime
  (`src/navigation/navigationRuntime.js`) are already platform-neutral.
- The **voice/TTS adapter** (`src/navigation/speechAdapter.js`, `expo-speech` +
  `expo-audio`) is already cross-platform — Android gets spoken guidance for
  free once the background updates flow runs.

So the *only* Android-specific work is the **native boundary**: a
foreground-service + persistent notification, the Android two-step background
location permission, prominent disclosure, and removing the `Platform.OS !==
"ios"` gates in `locationService.js`. That is Phases 5–5c below, and it sits on
the critical path **before** the production submission (Phase 6), not after.

**Sequencing implication:** the 14-day tester clock (Phase 3) still starts as
early as possible on a foreground-capable build, but the build that goes to
**production** (Phase 6) must already include background nav, and the
data-safety form + background-location permissions declaration are filled out
for background use from the start.

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

### Android background / locked-screen navigation (Phase 5, in v1)

Reuse the entire iOS navigation brain; build only the Android native boundary.
Four Android-specific concerns that differ from iOS:

1. **Foreground service + persistent notification.** Android requires a
   persistent notification while a background-location foreground service runs.
   Enable it via the `expo-location` plugin (`isAndroidForegroundServiceEnabled`)
   and pass a `foregroundService` block (localized title/body, color) into the
   `startLocationUpdatesAsync` options. The current
   `NAVIGATION_BACKGROUND_LOCATION_OPTIONS` in `locationService.js` is
   iOS-shaped (`showsBackgroundLocationIndicator`, `activityType`,
   `pausesUpdatesAutomatically`); merge Android-only `foregroundService` options
   at call time so each platform gets what it needs without breaking the other.
2. **Two-step background permission.** On Android 11+ the OS will not grant
   "Allow all the time" from an in-app dialog; after foreground is granted, the
   background request routes the user to Settings. The UI must handle the
   "foreground granted, background still pending" state gracefully (navigation
   still works foreground-only; a banner offers to enable background).
3. **Prominent disclosure** shown *before* the system background-permission
   dialog (Play policy), gated to Android.
4. **Remove the `Platform.OS !== "ios"` gates** in `locationService.js`
   (`startNavigationBackgroundUpdates`, `requestNavigationPermissions`,
   `getNavigationPermissionStatus`) so Android runs the real path behind a
   runtime capability check (`shouldUseBackgroundUpdates`).

Everything else — the `NAVIGATION_LOCATION_TASK` task, runtime fix processing,
session snapshot/restore across a background→foreground handoff, spoken cues,
and haptics — is inherited unchanged from the iOS work. Parity is validated with
the `nav-scenario-harness/` simulate-ride dev mode plus a real locked-screen
device ride.

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
  reason for nav apps and now applies to v1: the prominent-disclosure flow + a
  demo video showing it are required at submission. Budget review round-trips.
- **Foreground-service battery / Doze behavior** on diverse Android OEMs
  (aggressive battery killers) can silently stop background updates; validate on
  at least one non-Pixel device before production.
- **14-day clock** is unavoidable; front-loading Phases 0–4 minimizes calendar
  time to production.
