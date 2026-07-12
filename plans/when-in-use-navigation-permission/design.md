# When-In-Use Navigation Permission — Design

**Date:** 2026-07-11
**Source:** Follow-up reserved by `plans/navigation-ride-feedback/` D9 and its
`permission-spike-findings.md`. The owner accepted the 2026-07-11 device
evidence (lock-screen soak test passed with While-Using only under
`EXPO_PUBLIC_NAV_WHEN_IN_USE_SPIKE=1`) and waived the remaining protocol cases
(Home-screen, fresh-relaunch repeat) in favor of shipping the When-In-Use
model and validating on real rides.

## Problem

CycleWays requests **Always** location permission to enable lock-screen
guidance, even though the spike proved the shipped mechanism doesn't need it:
expo-location 56's `startLocationUpdatesAsync` native path only checks
*foreground* permission, and its TaskManager consumer sets
`allowsBackgroundLocationUpdates = YES`. A ride started in the foreground with
While-Using permission keeps delivering fixes (and, with D11's audio-session
activation, spoken cues) under a locked screen — the Waze/Google-Maps pattern.
The Always prompt is scary, unnecessary, and adds a Settings round-trip for
riders who decline it.

## Decisions

**W1 — Foreground-only permission flow.**
`requestNavigationPermissions({ background: true })` requests only foreground
permission and, on iOS, reports `background: true` when foreground is granted
— the TaskManager registration path needs nothing more. The
`WHEN_IN_USE_BACKGROUND_SPIKE` dev flag is deleted: the spike behavior *is*
the production behavior now (minus the flag's skip — the Always request is
gone entirely). Android continues to report `background: false` (locked-screen
Android navigation is the android-release plan's scope).

**W2 — Remove the Always strings and plugin permission.**
`NSLocationAlwaysAndWhenInUseUsageDescription` is dropped from
`app.json`'s `infoPlist` and from `locales/he.json`;
`locationAlwaysAndWhenInUsePermission: false` in the expo-location plugin
config excludes the plugin's default string. `isIosBackgroundLocationEnabled`
and `UIBackgroundModes: ["location", "audio"]` stay — background *modes* are
still required; only the Always *permission* goes. Requires
`npx expo prebuild -p ios` / a fresh native build.

**W3 — Lock-screen guidance UI loses its permission plumbing.**
The ride-setup toggle no longer depends on a separate permission:
`lockScreenGuidanceHasAlwaysPermission`, `lockScreenGuidanceNeedsSettings`,
the "מיקום תמיד" settings notice, and `getNavigationPermissionStatus` are
removed. The toggle's helper copy states that lock-screen guidance works with
the regular While-Using permission. Fully-denied location is already handled
by the existing start-flow `PERMISSION_DENIED` path and the ride-setup
location notice.

**W4 — Startup-failure telemetry (the findings' condition).**
`startNavigationBackgroundUpdates` stops silently swallowing errors: failures
are captured (`lastError` in a diagnostics getter) and emitted as a
`background_updates_start_failed` navigation-telemetry event. The existing
foreground-only fallback in `BuildScreen` (flips the toggle off and keeps
keep-awake navigation) remains the runtime safety net, now with an observable
reason.

**W5 — Expected UX change to document, not fix.**
With When-In-Use + background updates, iOS shows the blue location-indicator
pill while the screen is on and the app is backgrounded. That is the honest
Waze-style signal and is accepted.

*Rejected alternative:* keeping an optional Always upgrade path ("request
Always, fall back to When-In-Use"). It preserves the scary prompt for no
functional gain the device evidence supports.

## Risk

The waived protocol cases (Home-screen backgrounding, fresh-relaunch
re-registration) and long-duration behavior are now validated implicitly by
real rides. If iOS proves less reliable over hours than in the 2-minute soak,
the fallback is W4's telemetry plus re-introducing the Always request — a
one-file revert in `locationService.js` plus restored strings.

See `implementation-plan.md` for the task breakdown.
