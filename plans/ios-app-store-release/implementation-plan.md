# iOS App Store Release Readiness - Implementation Plan

Date: 2026-07-04

## Phase 0 - Release Scope Decision

1. Decide whether v1 is foreground-only or includes background / lock-screen
   navigation.
2. If foreground-only, remove Always/background location declarations from
   `apps/mobile/app.json` and regenerated iOS files.
3. If background navigation is in scope, implement it with the correct native
   background task model, clear in-app disclosure, and physical-device ride
   validation before submission.
4. Decide whether v1 supports iPad. If yes, QA and screenshot iPad. If no,
   disable tablet support before submission.
5. Decide initial territories, price/free status, and whether EU distribution is
   included.

Acceptance:

- Product scope is written down.
- App permissions match only shipped behavior.
- App Store metadata and screenshots match selected devices and territories.

## Phase 1 - Release Configuration And Signing

1. Set up App Store distribution signing:
   - Apple Distribution certificate.
   - App Store provisioning profile for `app.cycleways.mobile`.
   - Document whether signing is Fastlane `match`, Xcode managed, or manually
     managed via App Store Connect API credentials.
2. Update Release signing so it does not use Apple Development identity or a
   development profile.
3. Add Fastlane lanes for:
   - App Store certificate/profile setup or sync.
   - Clean archive/export.
   - Upload to TestFlight.
   - Optional submit-for-review step gated behind a manual flag.
4. Add build-number/version policy:
   - `CFBundleShortVersionString` / Expo `version` for marketing version.
   - `CFBundleVersion` for monotonically increasing build number.
5. Ensure release builds inject the Mapbox token from the release environment,
   not committed source.
6. Confirm release builds use Xcode 26 or later and an iOS 26 SDK, matching
   Apple's current upload requirement as of 2026-07-04.

Acceptance:

- A clean App Store archive can be produced from a clean checkout.
- The archive validates locally in Xcode Organizer or equivalent Fastlane
  validation.
- The binary can be uploaded to App Store Connect processing without signing
  errors.

## Phase 2 - Privacy, Permissions, And Compliance

1. Audit runtime data flows:
   - Expo Location foreground and any background path.
   - Mapbox SDK, tiles, and any telemetry.
   - Embedded WebView traffic and the local static server.
   - YouTube embedded playback.
   - GPX sharing and route sharing.
   - External app handoff to Apple Maps, Google Maps, Waze, and Moovit.
   - Crash reporting / analytics if added.
2. Update `PrivacyInfo.xcprivacy` for required-reason APIs used by first-party
   code and third-party SDKs.
3. Update iOS permission strings so they are specific, user-facing, and match
   the real moment the prompt appears.
4. Remove unused sensitive usage strings, permissions, entitlements, and URL
   query schemes.
5. Publish a privacy policy that covers:
   - What stays on device.
   - What goes to third parties.
   - Location handling.
   - Map/video providers.
   - Crash/diagnostic data.
   - Contact/support data.
   - Data deletion or privacy contact path.
6. Fill App Store Connect privacy labels from the audit.
7. Complete export compliance. If the app only uses standard HTTPS/TLS and no
   custom cryptography, record that answer consistently in App Store Connect.
8. Complete DSA trader status if distributing in the EU.

Acceptance:

- App Store privacy labels, privacy policy, and privacy manifest agree.
- No permission prompt appears without a visible user benefit.
- App Review notes include the local server and location rationale.

## Phase 3 - Product Hardening

1. Add or deliberately defer production crash reporting. If added, update
   privacy labels and policy.
2. Add a production-safe diagnostics posture:
   - No verbose dev telemetry in release.
   - No route tokens, coordinates, or personal data in logs sent off-device.
   - Crash grouping and release version tagging if using a crash provider.
3. Verify failure states:
   - No Mapbox token / token rejected.
   - Offline or poor network.
   - YouTube blocked/unavailable.
   - Location denied/restricted.
   - External app not installed.
   - GPX share failure.
   - Local WebView server start failure.
4. Add user-visible safety language for cycling/navigation. Make clear the app
   is guidance for planned rides, not a guarantee of road/path safety.
5. Review App Store content and rights for all route images, videos, map data,
   names, and marks.

Acceptance:

- A release build handles expected failure modes without blank screens or
  dead-end states.
- Support can identify app version/build and common failure class from a user
  report.

## Phase 4 - QA And Validation Gates

1. Keep existing shared tests as a release gate:
   - `npm test`
   - `npm run build`
   - targeted Playwright smoke tests
2. Add release-specific mobile gates:
   - Expo config validation.
   - iOS Release simulator build.
   - iOS Release physical-device build.
   - App Store archive validation.
3. Expand Maestro or manual QA for release/TestFlight builds:
   - First launch.
   - Discover route.
   - Route detail WebView.
   - Plan route from scratch.
   - Restore route from deep link.
   - Start foreground ride guidance.
   - Deny and grant location.
   - GPX share sheet.
   - External navigation handoff.
   - Offline/poor network.
   - iPad if supported.
4. Run accessibility validation:
   - VoiceOver labels and order.
   - Dynamic Type.
   - Sufficient contrast.
   - Reduce Motion.
   - RTL Hebrew layout.
   - Touch target sizes.
5. Capture screenshots for App Store sizes and selected localizations. Because
   the app currently supports iPad, include iPad screenshots unless tablet
   support is removed.

Acceptance:

- QA has a signed-off release matrix with device, OS version, build number, and
  result.
- Every App Store screenshot is from the release candidate or an equivalent
  build with matching UI.

## Phase 5 - Apple Developer And App Store Connect Setup

1. Apple Developer account:
   - Confirm legal owner/publisher.
   - Confirm agreements.
   - Confirm tax/banking if monetized.
   - Confirm DSA trader status if EU distribution is included.
   - Confirm team roles and backup access.
2. Certificates, Identifiers & Profiles:
   - Explicit App ID for `app.cycleways.mobile`.
   - Only required capabilities enabled.
   - Distribution certificate and App Store provisioning profile.
   - App Store Connect API key stored outside the repo.
3. App Store Connect app record:
   - Name, subtitle, SKU, primary language.
   - Bundle ID.
   - Category.
   - Age rating.
   - Pricing and availability.
   - Privacy Policy URL and Support URL.
   - Content rights answer.
   - Export compliance answer.
   - Privacy labels.
   - Screenshots and optional preview video.
   - Review contact and notes.
4. TestFlight setup:
   - Internal tester group.
   - External tester group.
   - Beta app description.
   - Beta review notes.
   - Feedback email.

Acceptance:

- App Store Connect has no missing required metadata.
- The first TestFlight build is processed and available to internal testers.

## Phase 6 - TestFlight Rollout

1. Upload the first release candidate to TestFlight.
2. Internal test pass:
   - Install on clean devices.
   - Verify first-run permissions.
   - Verify core flows.
   - Review crash/hang reports.
3. External beta:
   - Submit to Beta App Review.
   - Invite a small external rider group.
   - Collect route quality, safety, UX, battery, and location feedback.
4. Fix release blockers and repeat with a new build number.
5. Freeze the final release candidate after the last blocker fix.

Acceptance:

- No known crashers.
- No privacy/permission mismatch.
- No unresolved severe UX issue in core route planning or foreground guidance.

## Phase 7 - App Review Submission

1. Select the final TestFlight build for App Store review.
2. Confirm metadata one last time:
   - Screenshots match build.
   - Description does not overclaim background navigation or safety.
   - Privacy labels match shipped SDKs and features.
   - Review notes are complete.
3. Submit for review.
4. Monitor App Review messages and respond with specific, reproducible
   explanations.
5. If rejected, fix the root cause, update notes/metadata if needed, upload a
   new build, and resubmit.

Acceptance:

- App is approved for release.
- Release option is chosen: manual release, scheduled release, or phased
  release.

## Phase 8 - Launch And Operations

1. Launch with manual or phased release.
2. Monitor:
   - Crash reports.
   - TestFlight/App Store feedback.
   - Support inbox.
   - Mapbox token/service errors.
   - App Store reviews.
3. Keep a rollback/mitigation plan:
   - Pause phased release if severe issue appears.
   - Prepare expedited bugfix build path.
   - Update metadata or review notes for any discovered mismatch.
4. Start a post-launch backlog:
   - Background navigation, if still desired.
   - Universal links.
   - Better diagnostics.
   - Route/content updates.
   - Additional localization.

Acceptance:

- Support channel is live.
- Release owner can produce a hotfix build without rediscovering signing or
  App Store steps.
- The privacy policy and App Store labels remain accurate after launch.

## External Apple Checklist Summary

- Apple Developer Program membership active.
- Publisher/legal entity confirmed.
- Agreements accepted.
- Tax/banking complete if monetized.
- DSA trader status complete if distributing in the EU.
- Bundle ID `app.cycleways.mobile` created.
- Capabilities reviewed and minimized.
- Distribution signing ready.
- App Store Connect API key ready.
- App Store app record created.
- App name/subtitle/category/age rating set.
- Privacy Policy URL and Support URL live.
- App privacy labels complete.
- Export compliance answered.
- Content rights confirmed.
- Screenshots uploaded for all supported devices.
- TestFlight beta info complete.
- Review notes written.
- Final build uploaded, processed, tested, and selected for review.

