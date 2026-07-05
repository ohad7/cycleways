# iOS App Store Release Readiness - Design

Date: 2026-07-04 (reconciled 2026-07-05 with the implemented
background-location-voice-guidance work and a repo audit)

## Goal

Prepare the CycleWays iOS application for a professional App Store release.
This plan covers both the repository work and the required Apple Developer /
App Store Connect work outside the codebase.

The release is not just a signed binary. It must be a supportable product with
accurate metadata, a defensible privacy posture, review-ready permissions,
repeatable builds, TestFlight validation, support channels, and launch
operations.

## Current State

- The mobile app lives under `apps/mobile` and uses Expo / React Native,
  native Mapbox, Expo Location, React Navigation, a bundled offline data set,
  GPX sharing, app URL schemes, and a local static server for embedded route
  detail WebViews.
- The App Store bundle identifier is currently `app.cycleways.mobile`.
- `apps/mobile/app.json` declares location permissions, background location,
  URL schemes, iPad support, Mapbox, and the splash/icon configuration.
- `apps/mobile/ios/CycleWays/PrivacyInfo.xcprivacy` exists and currently
  declares required-reason API use and no collected data.
- `apps/mobile/fastlane/Fastfile` has development certificate/profile lanes
  only. It does not yet have App Store distribution, TestFlight upload, or App
  Store submission lanes.
- Release signing in the generated Xcode project is still configured with an
  Apple Development identity/profile.
- Background / lock-screen navigation IS implemented (see
  `plans/background-location-voice-guidance/`): `useNavigationSession` takes a
  `background` option, `BuildScreen` wires it to a user-facing lock-screen
  guidance toggle in the ride setup sheet (default on), a background location
  task is registered via `expo-task-manager`, and voice cues play through
  `expo-speech`. Permission flow is correct: foreground first, Always requested
  only when the toggle asks. The Always/background declarations in
  `apps/mobile/app.json` are therefore justified — the release risk is now
  proving the feature works (physical rides, battery, locked-screen voice), not
  removing it.
- There is useful automated coverage: shared Node/Python tests, Playwright web
  tests, and Maestro native smoke flows. The release process still needs
  release-build, physical-device, TestFlight, privacy, accessibility, and App
  Store metadata gates.
- Repo audit (2026-07-05) found these product gaps, all owned by
  `implementation-plan.md`:
  - No privacy policy, terms of use, or support page exists anywhere — the
    website (`www.cycleways.app`) has only route pages plus a Google-Form
    contact link, and the app has no legal or about surface.
  - No in-app About screen: no visible app version/build, no privacy/terms
    links, no OSM/Mapbox data attribution for the OSM-derived routing graph
    (ODbL), no support contact.
  - iOS permission strings are English while the entire app UI and voice
    guidance are Hebrew.
  - Mapbox SDK telemetry is on by default, which contradicts the
    "no collected data" declaration in `PrivacyInfo.xcprivacy`.
  - `ITSAppUsesNonExemptEncryption` is not declared, and `app.json` has no
    `ios.buildNumber`.
  - No user-visible cycling safety language exists in the ride flow.

## Release Posture

For v1, ship route discovery, planning, route detail, GPX sharing, deep-link
restore, external navigation handoff, and turn-by-turn ride guidance
**including lock-screen (background) guidance with voice cues** — this is
implemented and user-facing.

The background feature carries release obligations instead of removal:

- Physical-ride validation on real routes: locked screen, voice cues, battery
  drain, permission upgrade flow (When-In-Use → Always), and revocation
  mid-ride.
- Verify voice playback while locked on a release build. `UIBackgroundModes`
  declares only `location` (no `audio`); speech is expected to work because
  the location task keeps the app alive, but this exact combination must be a
  named physical-device test gate.
- App Review notes must explain when Always permission is requested (only at
  ride start, only if the lock-screen toggle is on) and what the user gets for
  it. The current usage strings already match this behavior.
- App Store description may claim turn-by-turn and lock-screen guidance only
  as validated.

## Product Decisions

- Keep the native app as the App Store product, not a beta wrapper around the
  website.
- Keep embedded route-detail WebViews because they preserve route-story parity,
  but document them clearly in App Review notes. The local `localhost` server is
  an implementation detail for bundled offline content, not an open browsing
  surface.
- Keep Mapbox as the map provider, but restrict the public token by bundle ID
  and domain where Mapbox supports it, and document any SDK telemetry or
  network behavior in the privacy audit.
- Treat app metadata, screenshots, privacy labels, review notes, support URLs,
  and TestFlight information as release artifacts with owners and review.
- Prefer a clean, repeatable release build from a clean checkout. Generated
  folders, local `dist`, `.expo`, and stale `ios/webroot` content must not be
  trusted as source of truth.

## Permission And Privacy Decisions

- Location: foreground location is justified for "near me", route setup, and
  ride guidance. Background (Always) location is justified because the shipped
  product keeps guidance and voice cues active while the screen is locked; it
  is requested only at ride start and only when the user keeps the lock-screen
  guidance toggle on.
- Mapbox telemetry: disable it in the app (`Mapbox.setTelemetryEnabled(false)`
  next to the existing `setAccessToken` call) so the "no collected data"
  posture in `PrivacyInfo.xcprivacy` and the App Store privacy labels stays
  true. If it is ever re-enabled, privacy labels and policy must change first.
- Permission strings: localize the iOS usage strings to Hebrew (the app's
  actual language) via Expo `locales`, keeping English as the base fallback.
- Motion: if `NSMotionUsageDescription` is not backed by a shipped feature,
  remove it; if Mapbox or another dependency requires it, document why it
  appears and verify whether the prompt can surface.
- Local networking: keep only for the embedded static server; explain in App
  Review notes that it serves bundled route content from the app.
- External navigation apps: keep `LSApplicationQueriesSchemes` only for apps
  actually presented in the handoff sheet.
- Privacy labels: answer App Store Connect based on actual data collection,
  including third-party SDKs and embedded web traffic. On-device location alone
  is not "collected" by Apple privacy-label definitions, but data transmitted
  to Mapbox, YouTube, crash tools, analytics, or backend services may be.
- Tracking: the target posture is no cross-app tracking and no IDFA. If any SDK
  changes this, it becomes a release blocker until ATT, labels, and policy are
  updated.

## Work Split

The release work is split into two tracks:

1. **Agent-executable repository work** — everything a coding agent can build
   and verify inside this repo: legal/support pages on the website, the in-app
   About screen, permission-string localization, compliance config, telemetry
   opt-out, and the safety notice. This is fully specified, task by task, in
   `implementation-plan.md`.
2. **Owner + assistant work (Apple side)** — everything requiring the Apple
   Developer account or human judgment: account/agreements/DSA checks,
   reserving the app name by creating the App Store Connect record (do this
   EARLY — the name "CycleWays" may be contested), distribution signing and
   Fastlane release/TestFlight lanes (the current Fastfile has development
   lanes only), privacy labels, metadata/screenshots, TestFlight rollout,
   physical-ride validation of lock-screen guidance, and submission. The
   checklists for this track are the sections below and the External Apple
   Checklist Summary at the end of `implementation-plan.md`.

## External Apple Systems To Prepare

### Apple Developer Account

- Confirm the account holder and legal entity are appropriate for publishing
  CycleWays. Apps should be submitted by the person or legal entity that owns or
  has licensed the relevant rights.
- Assign at least two people operational access where possible: Account Holder
  or Admin for legal/account tasks, App Manager or Developer for releases.
- Complete current agreements. If the app will be paid or use in-app purchases,
  complete banking and tax. For a free app, still verify agreements and contact
  details.
- If distributing in the EU, complete Digital Services Act trader status before
  the app or updates are exposed there.

### Certificates, Identifiers & Profiles

- Create or confirm the explicit App ID / Bundle ID: `app.cycleways.mobile`.
- Enable only required capabilities:
  - Associated Domains only if universal links are added.
  - Background Modes only if background location is actually shipped.
  - Push Notifications only if notification features are added.
  - No Game Center, HealthKit, iCloud, Sign in with Apple, or IAP unless product
    scope changes.
- Create Apple Distribution certificate(s) and an App Store provisioning profile
  for the bundle ID, or move signing to Fastlane `match` / Xcode managed signing
  with documented ownership.
- Create an App Store Connect API key for CI/Fastlane upload. Store the `.p8`
  key and issuer/key IDs outside the repo.

### App Store Connect App Record

- Create the iOS app record with bundle ID `app.cycleways.mobile`, SKU, primary
  language, and app name.
- Choose the store name and subtitle within Apple limits:
  - Name: 2-30 characters.
  - Subtitle: up to 30 characters.
- Choose category. Likely primary category is Navigation or Travel; choose based
  on the final positioning.
- Set age rating under the 2026 rating system. Consider cycling/safety context,
  unrestricted web content from YouTube/WebView if applicable, and external
  links.
- Set pricing and availability. If launching only in Israel first, restrict
  territories intentionally; otherwise prepare global support and compliance.
- Provide required URLs:
  - Privacy Policy URL.
  - Support URL with a real contact path.
  - Marketing URL if available.
  - Optional privacy choices URL if any privacy controls exist.
- Provide content rights confirmation for Mapbox, OpenStreetMap or other map
  data, route imagery, route videos, YouTube embeds, POI photos, icons, and any
  branding.
- Decide iPhone/iPad availability. The current config supports iPad; either
  validate and provide iPad screenshots or disable tablet support before first
  release.
- Decide Mac with Apple silicon and Apple Vision Pro availability. Default
  availability should be reviewed, because a touch/map/navigation app may not
  be appropriate without dedicated QA.

### App Privacy

- Publish a privacy policy before submission. It must match the app and App
  Store privacy labels.
- Complete App Store privacy labels after auditing:
  - Precise/coarse location, if transmitted or retained by first-party or
    third-party services.
  - Product interaction, crash data, performance data, and diagnostics if crash
    reporting or analytics are added.
  - Search history if search queries are transmitted or retained.
  - User content if GPX/routes/photos/feedback are uploaded or shared with a
    service beyond user-selected share sheets.
  - WebView traffic, including route detail pages, Mapbox tiles, and YouTube.
- Keep `PrivacyInfo.xcprivacy` aligned with required-reason API usage by first
  and third-party SDKs.

### TestFlight

- Provide beta app description, beta review information, feedback email, and
  test notes.
- Start with internal testers, then external testers after Beta App Review.
- Define tester groups: internal engineering, local riders, route/content
  reviewers, and accessibility/RTL testers.
- Monitor TestFlight feedback, screenshots, crashes, hangs, and install issues.

### App Review Submission

- Prepare review notes that explain:
  - No account is required, if true.
  - How to exercise route discovery, route detail, route planning, GPX share,
    deep-link restore, and navigation handoff.
  - Why location is requested and when.
  - Whether the app is foreground-only or supports background navigation.
  - Why local networking / localhost is used for bundled route detail content.
  - Which features require network: Mapbox tiles, YouTube playback, external
    app handoff, and any crash/analytics service.
  - A sample route/deep link and expected behavior.
- Submit only a final, non-placeholder build with live backend/network services
  and complete metadata.

## Sources

Official Apple references checked on 2026-07-04:

- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/app-store/app-privacy-details/
- https://developer.apple.com/news/upcoming-requirements/
- https://developer.apple.com/testflight/
- https://developer.apple.com/help/app-store-connect/reference/app-information/app-information
- https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications

