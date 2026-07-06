# Android Play Store Release — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Note:** This plan is mixed operational + code. Ops tasks (accounts, keystore, store forms) can't be TDD'd — they end with a concrete "Definition of done" instead of a passing test. Code tasks (Phase 2, Phase 5) use test-first steps. Ops tasks marked **[human]** require the account owner to act (Google/Play UI); the agent prepares everything up to that boundary.

**Goal:** Publish the existing Expo/RN app to Google Play under the Cycleways brand and close the Android-specific code gaps found in review.

**Architecture:** The `apps/mobile/android/` native project is a committed Expo prebuild that is ~80% Android-ready. Capture the package id early to start the mandatory 14-day tester clock. **Background / locked-screen navigation ships in v1** (parity with iOS): the navigation brain, voice adapter, and session snapshot/restore are already platform-neutral in `@cycleways/core`, so only the Android native boundary (foreground service + notification, two-step background permission, prominent disclosure) is new. See `design.md` for findings and decisions.

**Tech Stack:** Expo ~56 / React Native 0.85 (new arch, Hermes), `@rnmapbox/maps` (Mapbox v11), `@dr.pogodin/react-native-static-server`, `expo-location`/`expo-task-manager`, fastlane + `supply`, Google Play Console, Maestro.

## Global Constraints

- Package id / application id: `app.cycleways.mobile` — never change (permanent on Play once uploaded).
- App store title: `CycleWays`. Public developer name: `Cycleways`.
- Play account: **Personal** type, owned by Google account `cycleways.app@gmail.com`, Ohad's personal account added as Admin.
- All secrets (keystore, Play service-account JSON, ASC keys) live **outside the repo** under `~/.playstore/` / `~/.appstoreconnect/` — never committed. Mirror the iOS Fastfile pattern.
- Map/public data files are pipeline-owned — no hand edits (see repo CLAUDE.md). This plan touches none of them.
- Upload artifact for Play is an **`.aab`** (App Bundle), not APK.
- Do not run `git add -A` after any build step — builds regenerate ignored/pipeline artifacts.

---

## Phase 0 — Toolchain (prerequisite)

### Task 0: Install a minimal Android build toolchain

**Files:** none (local machine setup).

- [ ] **Step 1: Install JDK 17** (Temurin/Zulu). Verify:

Run: `java -version`
Expected: version `17.x`.

- [ ] **Step 2: Install Android command-line SDK tools** (no full Studio GUI needed). Set `ANDROID_HOME` (e.g. `~/Library/Android/sdk`) and add `platform-tools` + `cmdline-tools/latest/bin` to `PATH`. Install the required packages:

Run: `sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" "ndk;27.1.12297006"`
Expected: packages install without error. (Match the `compileSdkVersion`/`ndkVersion` Expo pins; confirm exact values with `./gradlew -q :app:dependencies` failing fast if wrong.)

- [ ] **Step 3: Connect a physical Android phone** with USB debugging enabled (Settings → Developer options → USB debugging). Verify:

Run: `adb devices`
Expected: the device listed as `device` (not `unauthorized`).

**Definition of done:** `java -version` is 17, `adb devices` shows one authorized device, `sdkmanager --list_installed` shows platform-tools + the pinned platform/build-tools/ndk.

---

## Phase 1 — Prove the debug build runs (validates the port + Mapbox token)

### Task 1: First Android debug build on device

**Files:**
- Read: `apps/mobile/.env` (must contain `EXPO_PUBLIC_MAPBOX_TOKEN=pk...`)
- Possibly modify: `~/.gradle/gradle.properties` (add `MAPBOX_DOWNLOADS_TOKEN=sk...` if the build fails to fetch the Mapbox SDK — finding 5)

**Interfaces:**
- Produces: a confirmed-runnable debug APK on device, and a known-good value for `MAPBOX_DOWNLOADS_TOKEN` (or confirmation it is not needed).

- [ ] **Step 1: Ensure the runtime Mapbox token exists.** Confirm `apps/mobile/.env` has a real `EXPO_PUBLIC_MAPBOX_TOKEN` (public `pk.` token). Without it, `BuildScreen.jsx` renders the "Set EXPO_PUBLIC_MAPBOX_TOKEN" fallback instead of a map.

Run: `grep EXPO_PUBLIC_MAPBOX_TOKEN apps/mobile/.env`
Expected: a `pk.`-prefixed token, not the placeholder.

- [ ] **Step 2: Build + install the debug app.**

Run: `cd apps/mobile && npm run android`
Expected: gradle build succeeds and the app launches on the device.

- [ ] **Step 3: If gradle fails downloading `com.mapbox.maps:android` from `api.mapbox.com`** — obtain a Mapbox **secret download token** (`sk.` with `Downloads:Read`) and add `MAPBOX_DOWNLOADS_TOKEN=sk...` to `~/.gradle/gradle.properties` (out of repo), then re-run Step 2. Record the outcome in this task's notes.

- [ ] **Step 4: Manual smoke test on device.** Verify, and note results:
  - Map tiles render (Mapbox token OK).
  - Discover list + route planning (add/move waypoints) work.
  - Start a ride → **foreground** turn-by-turn shows position + cues with screen on.
  - Open a route-detail "story" page → **expected to FAIL to load in this debug build only if** cleartext is off; debug manifest allows cleartext so it should load here. (Release-build failure is fixed in Phase 2.)

**Definition of done:** debug app runs on device; map + planner + foreground nav work; the Mapbox-token situation (needed / not needed) is recorded for Phase 4.

---

## Phase 2 — Fix the release-only cleartext localhost bug (CODE)

### Task 2: Permit cleartext to localhost so the story WebView works in release builds

**Files:**
- Create: `apps/mobile/android/app/src/main/res/xml/network_security_config.xml`
- Modify: `apps/mobile/android/app/src/main/AndroidManifest.xml` (`<application>` tag)
- Create: `apps/mobile/plugins/withAndroidCleartextLocalhost.js` (config plugin so a future `expo prebuild` reproduces it)
- Modify: `apps/mobile/app.json` (register the plugin)
- Test: `apps/mobile/.maestro/route-detail-story.yaml` (new or existing story-page flow)

**Interfaces:**
- Consumes: the local static server origin `http://localhost:PORT` from `src/webServer.js` / `src/screens/RouteDetailWeb.jsx` (unchanged).
- Produces: a release build in which the story WebView loads.

- [ ] **Step 1: Write the failing check — a release build.** Build a release variant and install it, then run the story-page Maestro flow (it opens a route detail and asserts the story content renders):

Run: `cd apps/mobile && ./android/gradlew -p android assembleRelease && adb install -r android/app/build/outputs/apk/release/app-release.apk`
Then: `maestro test .maestro/route-detail-story.yaml`
Expected: **FAIL** — the WebView shows the "לא הצלחנו לטעון" error because cleartext to `localhost` is blocked in release. (This confirms the bug before fixing.)

- [ ] **Step 2: Add the network security config.**

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Allow cleartext ONLY to the bundled on-device static server (finding 2).
     Everything else stays HTTPS-only (Android default). -->
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">localhost</domain>
    </domain-config>
</network-security-config>
```

- [ ] **Step 3: Reference it from the main manifest.** In `AndroidManifest.xml`, add to the `<application>` element:

```
android:networkSecurityConfig="@xml/network_security_config"
```

- [ ] **Step 4: Rebuild release + re-run the flow.**

Run: `cd apps/mobile && ./android/gradlew -p android assembleRelease && adb install -r android/app/build/outputs/apk/release/app-release.apk`
Then: `maestro test .maestro/route-detail-story.yaml`
Expected: **PASS** — the story page renders in the release build.

- [ ] **Step 5: Make it survive re-prebuild — add the config plugin.** Because `android/` is a committed prebuild, also capture the change as a plugin so it is regenerated if anyone runs `expo prebuild --clean`:

```js
// apps/mobile/plugins/withAndroidCleartextLocalhost.js
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const NSC = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">localhost</domain>
    </domain-config>
</network-security-config>
`;

module.exports = function withAndroidCleartextLocalhost(config) {
  config = withDangerousMod(config, [
    "android",
    (cfg) => {
      const dir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app/src/main/res/xml",
      );
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "network_security_config.xml"), NSC);
      return cfg;
    },
  ]);
  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application[0];
    app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    return cfg;
  });
  return config;
};
```

- [ ] **Step 6: Register the plugin** in `apps/mobile/app.json` `plugins` array (after `./plugins/withWebroot.js`):

```
"./plugins/withAndroidCleartextLocalhost.js"
```

- [ ] **Step 7: Commit.**

```bash
git add apps/mobile/android/app/src/main/res/xml/network_security_config.xml \
        apps/mobile/android/app/src/main/AndroidManifest.xml \
        apps/mobile/plugins/withAndroidCleartextLocalhost.js \
        apps/mobile/app.json \
        apps/mobile/.maestro/route-detail-story.yaml
git commit -m "fix(android): permit cleartext to localhost so story WebView loads in release builds"
```

---

## Phase 3 — Capture the identity + start the 14-day clock **[human]**

### Task 3: Create the Play account and reserve the package id

**Files:** none (Play Console + Google account UI).

- [ ] **Step 1:** Create/secure `cycleways.app@gmail.com` — strong password + **2FA** + recovery details you control. **[human]**
- [ ] **Step 2:** Enroll in the Google Play Console with that account, **Personal** type, pay the **$25** one-time fee, complete government-ID identity verification. Set the **public developer name** to `Cycleways`. **[human]**
- [ ] **Step 3:** Add Ohad's personal Google account as **Admin** under Users & permissions. **[human]**
- [ ] **Step 4:** Create the app: title `CycleWays`, default language, app (not game), free. **[human]**
- [ ] **Step 5:** Upload **any** signed build (from Phase 4's `build_aab`, or a throwaway signed AAB) to the **Internal testing** track. This permanently locks `app.cycleways.mobile` to this account — the real "name capture." **[human]**

**Definition of done:** Play Console shows the app with package `app.cycleways.mobile`, developer name `Cycleways`, and at least one build on a track. (Phase 4 produces the proper signed AAB; if done first, use it here.)

---

## Phase 4 — Release signing + AAB pipeline (CODE + ops)

### Task 4: Generate the upload keystore and wire release signing

**Files:**
- Create (out of repo): `~/.playstore/cycleways-upload.keystore`, `~/.gradle/gradle.properties` entries
- Modify: `apps/mobile/android/app/build.gradle` (release `signingConfig`)

**Interfaces:**
- Produces: a release build signed with the real upload key (not the debug key).

- [ ] **Step 1: Generate the upload keystore** (out of repo). Record the passwords in your password manager:

Run:
```bash
keytool -genkeypair -v -keystore ~/.playstore/cycleways-upload.keystore \
  -alias cycleways-upload -keyalg RSA -keysize 2048 -validity 10000
```
Expected: keystore file created; prompts for store/key passwords + a distinguished name.

- [ ] **Step 2: Add keystore properties to `~/.gradle/gradle.properties`** (out of repo, machine-global):

```
CYCLEWAYS_UPLOAD_STORE_FILE=/Users/<you>/.playstore/cycleways-upload.keystore
CYCLEWAYS_UPLOAD_KEY_ALIAS=cycleways-upload
CYCLEWAYS_UPLOAD_STORE_PASSWORD=****
CYCLEWAYS_UPLOAD_KEY_PASSWORD=****
```

- [ ] **Step 3: Replace the release signing config** in `apps/mobile/android/app/build.gradle`. Add a `release` signingConfig that reads the properties, and point `buildTypes.release.signingConfig` at it:

```gradle
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (project.hasProperty('CYCLEWAYS_UPLOAD_STORE_FILE')) {
                storeFile file(CYCLEWAYS_UPLOAD_STORE_FILE)
                storePassword CYCLEWAYS_UPLOAD_STORE_PASSWORD
                keyAlias CYCLEWAYS_UPLOAD_KEY_ALIAS
                keyPassword CYCLEWAYS_UPLOAD_KEY_PASSWORD
            }
        }
    }
```
Then in `buildTypes.release` change `signingConfig signingConfigs.debug` to `signingConfig signingConfigs.release`.

- [ ] **Step 4: Build a signed release AAB and verify the signer.**

Run: `cd apps/mobile && ./android/gradlew -p android bundleRelease`
Then: `jarsigner -verify -verbose -certs android/app/build/outputs/bundle/release/app-release.aab | head`
Expected: build succeeds; signer CN is `cycleways-upload`, **not** `androiddebugkey`.

- [ ] **Step 5: Commit** (only the gradle change — never the keystore or passwords):

```bash
git add apps/mobile/android/app/build.gradle
git commit -m "build(android): sign release with the out-of-repo upload keystore"
```

### Task 5: Add a fastlane `android` platform for build + upload

**Files:**
- Modify: `apps/mobile/fastlane/Fastfile` (add `platform :android`)
- Create (out of repo): `~/.playstore/cycleways-play.json` (Play service-account key)

**Interfaces:**
- Consumes: the release signing config from Task 4.
- Produces: `fastlane android build_aab` and `fastlane android upload_internal` lanes.

- [ ] **Step 1: Create a Play service account** in Google Cloud, grant it release permissions in Play Console, download the JSON to `~/.playstore/cycleways-play.json` (out of repo). **[human]**

- [ ] **Step 2: Add the android platform to `Fastfile`** mirroring the iOS out-of-repo-secrets pattern:

```ruby
platform :android do
  ANDROID_DIR = File.expand_path("../android", __dir__)
  PLAY_JSON = File.expand_path("~/.playstore/cycleways-play.json")
  AAB = File.join(ANDROID_DIR, "app/build/outputs/bundle/release/app-release.aab")

  desc "Build a signed release AAB"
  lane :build_aab do
    gradle(project_dir: ANDROID_DIR, task: "bundle", build_type: "Release")
  end

  desc "Upload the latest AAB to the internal testing track"
  lane :upload_internal do
    upload_to_play_store(
      package_name: "app.cycleways.mobile",
      json_key: PLAY_JSON,
      track: "internal",
      aab: AAB,
      skip_upload_metadata: true,
      skip_upload_images: true,
      skip_upload_screenshots: true,
      release_status: "draft"
    )
  end
end
```

- [ ] **Step 3: Verify the build lane.**

Run: `cd apps/mobile && bundle exec fastlane android build_aab`
Expected: a signed `app-release.aab` at the path above.

- [ ] **Step 4: Commit** (Fastfile only):

```bash
git add apps/mobile/fastlane/Fastfile
git commit -m "build(android): add fastlane build_aab + upload_internal lanes"
```

---

## Phase 5 — Android background / locked-screen navigation (CODE, in v1)

> **Scope note:** Background nav ships in v1 (decision 2026-07-06), on the critical path **before** the Phase 6 production submission. The expensive parts — pure session/cues/haptics/presentation, session snapshot/restore, and the `expo-speech`/`expo-audio` voice adapter — are already built and platform-neutral from the iOS `background-location-voice-guidance/` work. Only the Android native boundary below is new. The 14-day tester clock (Phase 3) may still start on an earlier build, but the AAB promoted to production must include these tasks.

### Task 6: Add Android background-location permissions + foreground service

**Files:**
- Modify: `apps/mobile/app.json` (`expo-location` plugin + android permissions)
- Modify: `apps/mobile/android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Extend the `expo-location` plugin config** in `app.json` with the Android foreground-service option and add the Android permission block:

```json
[
  "expo-location",
  {
    "locationWhenInUsePermission": "Show your current location on the map while planning and following rides.",
    "locationAlwaysAndWhenInUsePermission": "Keep following turn-by-turn navigation while your screen is locked during a ride.",
    "isIosBackgroundLocationEnabled": true,
    "isAndroidBackgroundLocationEnabled": true,
    "isAndroidForegroundServiceEnabled": true
  }
]
```

- [ ] **Step 2: Add the permissions to the main manifest** (`<manifest>` level):

```xml
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION"/>
```

- [ ] **Step 3: Rebuild and verify** the permissions are present in the merged manifest:

Run: `cd apps/mobile && ./android/gradlew -p android :app:processReleaseManifest && grep -i "ACCESS_BACKGROUND_LOCATION" android/app/build/intermediates/merged_manifests/release/AndroidManifest.xml`
Expected: the permission appears.

- [ ] **Step 4: Commit.**

```bash
git add apps/mobile/app.json apps/mobile/android/app/src/main/AndroidManifest.xml
git commit -m "feat(android): declare background-location + foreground-service permissions"
```

### Task 7: Enable the background-updates code path on Android

**Files:**
- Modify: `apps/mobile/src/navigation/locationService.js`
- Test: `apps/mobile/tests/test-location-service-platform.mjs` (new)

**Interfaces:**
- Consumes: `NAVIGATION_LOCATION_TASK` (unchanged), `expo-location` (now Android-capable).
- Produces: `startNavigationBackgroundUpdates`, `requestNavigationPermissions`, `getNavigationPermissionStatus` running the real path on Android behind a runtime capability check instead of a hard `Platform.OS !== "ios"` gate.

- [ ] **Step 1: Write the failing test.** Inject a fake `Platform` + `expo-location`/`expo-task-manager` and assert the Android path requests background permission and starts updates (currently it early-returns). Add to `apps/mobile/tests/test-location-service-platform.mjs`:

```js
// Asserts Android is no longer hard-gated out of background updates.
import assert from "node:assert/strict";
import test from "node:test";
// NOTE: locationService imports native modules; extract the platform-branch
// decision into a pure helper `shouldUseBackgroundUpdates(platformOS, taskDefined, available)`
// in locationService.js and test THAT, to keep this a node test.
import { shouldUseBackgroundUpdates } from "../src/navigation/locationService.js";

test("android with task+availability uses background updates", () => {
  assert.equal(shouldUseBackgroundUpdates("android", true, true), true);
});
test("ios still uses background updates", () => {
  assert.equal(shouldUseBackgroundUpdates("ios", true, true), true);
});
test("no task defined disables background updates", () => {
  assert.equal(shouldUseBackgroundUpdates("android", false, true), false);
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `cd apps/mobile && node --test tests/test-location-service-platform.mjs`
Expected: FAIL — `shouldUseBackgroundUpdates` is not exported yet.

- [ ] **Step 3: Extract the pure decision + drop the iOS-only gates.** In `locationService.js`:

```js
// Pure, unit-testable: background updates need a defined task and an
// available TaskManager on any platform (was previously iOS-only).
export function shouldUseBackgroundUpdates(platformOS, taskDefined, available) {
  return Boolean(taskDefined) && Boolean(available);
}
```
Then in `startNavigationBackgroundUpdates`, replace `if (Platform.OS !== "ios") return false;` + the inline checks with:
```js
  const taskDefined = TaskManager.isTaskDefined(NAVIGATION_LOCATION_TASK);
  const available = await TaskManager.isAvailableAsync();
  if (!shouldUseBackgroundUpdates(Platform.OS, taskDefined, available)) return false;
```
In `requestNavigationPermissions`, change `if (!background || Platform.OS !== "ios")` to `if (!background)` so Android also requests background permission.
In `getNavigationPermissionStatus`, request background permission on all platforms (remove the `Platform.OS === "ios" ? ... : {undetermined}` branch).
Also add the Android **foreground-service notification** options so the persistent notification has real copy (Android requires it while the location foreground service runs). Merge them only on Android when starting updates:
```js
const ANDROID_FOREGROUND_SERVICE = {
  foregroundService: {
    notificationTitle: "CycleWays ניווט פעיל",
    notificationBody: "עוקב אחרי המסלול שלך",
    notificationColor: "#1B5E20",
  },
};
// ...in startNavigationBackgroundUpdates, when calling startLocationUpdatesAsync:
await Location.startLocationUpdatesAsync(NAVIGATION_LOCATION_TASK, {
  ...NAVIGATION_BACKGROUND_LOCATION_OPTIONS,
  ...(Platform.OS === "android" ? ANDROID_FOREGROUND_SERVICE : {}),
  ...options,
});
```

- [ ] **Step 4: Run the test to confirm it passes.**

Run: `cd apps/mobile && node --test tests/test-location-service-platform.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full node suite** to confirm no regression in the existing location-fix tests:

Run: `cd apps/mobile && npm test`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/mobile/src/navigation/locationService.js apps/mobile/tests/test-location-service-platform.mjs
git commit -m "feat(android): enable background navigation updates on Android"
```

### Task 8: Android prominent-disclosure priming before background permission

**Files:**
- Modify: the ride-setup / permission-priming UI (locate the component that calls `requestNavigationPermissions({ background: true })` — likely `src/planner/RideSetupSheet.jsx`)
- Test: extend a Maestro flow `.maestro/nav-background-permission.yaml`

- [ ] **Step 1:** Before the first background-permission request on Android, show a prominent disclosure explaining that location is used in the background for turn-by-turn while the screen is locked, with explicit continue/deny. (Play policy requires this **before** the system dialog.) Gate it with `Platform.OS === "android"`.
- [ ] **Step 2: Handle the two-step Android grant.** On Android 11+ "Allow all the time" cannot be granted from the in-app dialog — after foreground is granted, `requestBackgroundPermissionsAsync` sends the user to system Settings. Handle the intermediate state cleanly: navigation must still run **foreground-only** when background is pending, and a non-blocking banner ("Enable all-the-time location for locked-screen guidance") offers to re-request / open Settings. Use the existing `getNavigationPermissionStatus().canUseBackground` to drive the banner.
- [ ] **Step 3:** Add a Maestro flow that starts a ride, asserts the disclosure appears, accepts it, and asserts the system permission dialog follows.
- [ ] **Step 4:** Device test with screen locked: start a ride, grant "all the time", lock the screen, confirm position keeps updating, spoken cues fire, and the foreground-service notification is present. Then background→foreground and confirm the session restored from snapshot (no re-fired "route acquired" cue).
- [ ] **Step 5: Commit.**

```bash
git add apps/mobile/src/planner/RideSetupSheet.jsx apps/mobile/.maestro/nav-background-permission.yaml
git commit -m "feat(android): prominent-disclosure priming before background location"
```

---

## Phase 6 — Store listing, compliance, and go-live **[human, mostly]**

### Task 9: Complete the Play Console listing + policy forms

**Files:** store assets under `apps/mobile/fastlane/metadata/android/` (optional, if managing via `supply`).

- [ ] **Step 1:** Store listing: short description (≤80 chars), full description, app icon (512×512), **feature graphic (1024×500)**, phone screenshots (≥2), 7-inch/10-inch tablet screenshots if `supportsTablet`. **[human]**
- [ ] **Step 2:** **Data safety** form — declare location collection/usage/sharing to match actual behavior: precise location, foreground **and background** (used for turn-by-turn while the screen is locked). **[human]**
- [ ] **Step 3:** **Content rating** questionnaire. **[human]**
- [ ] **Step 4:** Target audience, privacy policy URL (reuse the iOS one), ads declaration (none), news/COVID declarations as applicable. **[human]**
- [ ] **Step 5 (required — background nav is in v1):** Background-location **permissions declaration** — the core-functionality justification, the prominent-disclosure description, and a **demo video** showing the in-app disclosure and locked-screen guidance. This is the most common nav-app rejection point; the production AAB must already contain the Phase 5 code. **[human]**

**Definition of done:** Play Console "Dashboard" shows all release-readiness tasks green except the production track.

### Task 10: Closed testing → the 14-day gate → production

**Files:** none.

- [ ] **Step 1:** Promote the internal build to a **Closed testing** track; add ≥20 testers (email list or Google Group) and get them to **opt in and install**. **[human]**
- [ ] **Step 2:** Keep ≥20 testers opted in for **14 continuous days**. Track the start date here: `____-__-__`. **[human]**
- [ ] **Step 3:** After 14 days, apply for **production access** (personal-account requirement). **[human]**
- [ ] **Step 4:** Create the **Production** release using an AAB that **includes the Phase 5 background-nav code** (upload via `fastlane android upload_internal` retargeted to `production`, or in the console), submit for review. **[human]**

**Definition of done:** app is live (or in review) on the Production track under `app.cycleways.mobile` / `Cycleways`.

---

## Self-review notes

- **Spec coverage:** all five design findings map to tasks — toolchain→T0, Mapbox token→T1, cleartext→T2, keystore→T4, background location→T6–T8. Account/identity→T3, listing/compliance→T9–T10.
- **Critical path:** T3 (identity capture) + one signed build (T4) start the 14-day clock; do them as early as possible. Phase 2 (cleartext), Phase 5 (background nav), and Phase 6 listing run in parallel during the 14-day wait — but the AAB promoted to **production** (T10) must already include Phase 5.
- **Background nav in v1:** Phase 5 (T6–T8) is on the critical path before production submission. It reuses the platform-neutral iOS navigation brain + voice adapter + session snapshot/restore; only the Android native boundary is new. The data-safety form (T9.2) and background-location declaration (T9.5) are filled out for background use accordingly.
- **Verify-first assumptions:** exact `compileSdkVersion`/`ndkVersion`/`android-XX` values in T0 must be read from the Expo pins at execution time (`android/build.gradle` ext or `./gradlew` output) rather than trusted from this plan; the Mapbox download-token need (T1 Step 3) is confirmed empirically on first build.
