import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appJson = JSON.parse(
  await readFile(new URL("../apps/mobile/app.json", import.meta.url), "utf8"),
);
const ios = appJson.expo.ios;

assert.deepEqual(
  ios.associatedDomains,
  ["applinks:www.cycleways.app"],
  "the signed app must claim the canonical Universal Link host",
);

const aasa = JSON.parse(
  await readFile(
    new URL(
      "../public/.well-known/apple-app-site-association",
      import.meta.url,
    ),
    "utf8",
  ),
);
const universalLinkDetails = aasa.applinks?.details?.[0];
assert.deepEqual(
  universalLinkDetails?.appIDs,
  ["9K5YBKH2UN.app.cycleways.mobile"],
  "AASA identity must match the Apple team and iOS bundle identifier",
);
assert.deepEqual(
  universalLinkDetails?.components?.map((component) => component["/"]),
  ["/", "/routes/*", "/featured/*"],
  "AASA must claim only shared and catalog route content",
);
assert.equal(
  universalLinkDetails?.components?.[0]?.["?"]?.route,
  "?*",
  "the root Universal Link must require a non-empty route query item",
);

// Build number must exist and be numeric so release uploads can bump it.
assert.match(ios.buildNumber, /^\d+$/);

// Standard-encryption-only declaration: skips the export-compliance prompt
// on every App Store Connect upload.
assert.equal(ios.infoPlist.ITSAppUsesNonExemptEncryption, false);

// Hebrew InfoPlist localization must be wired.
assert.equal(ios.infoPlist.CFBundleAllowMixedLocalizations, true);
assert.equal(appJson.expo.locales?.he, "./locales/he.json");

const usageKeys = ["NSLocationWhenInUseUsageDescription"];
for (const key of usageKeys) {
  assert.ok(
    typeof ios.infoPlist[key] === "string" && ios.infoPlist[key].length > 10,
    `base usage string ${key}`,
  );
}

// When-In-Use permission model (plans/when-in-use-navigation-permission):
// the app must never declare or request Always location.
assert.equal(
  ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription,
  undefined,
  "Always usage string must be absent - lock-screen guidance runs on While-Using",
);
const locationPlugin = appJson.expo.plugins.find(
  (p) => Array.isArray(p) && p[0] === "expo-location",
);
assert.ok(locationPlugin, "expo-location plugin config present");
assert.equal(
  locationPlugin[1].locationAlwaysAndWhenInUsePermission,
  false,
  "expo-location plugin must exclude the Always permission string",
);
assert.equal(
  locationPlugin[1].isIosBackgroundLocationEnabled,
  true,
  "background location updates still require the plugin flag",
);
const locationService = await readFile(
  new URL(
    "../apps/mobile/src/navigation/locationService.js",
    import.meta.url,
  ),
  "utf8",
);
assert.doesNotMatch(
  locationService,
  /requestBackgroundPermissionsAsync/,
  "navigation must not request Always location permission",
);

assert.deepEqual(
  ios.infoPlist.UIBackgroundModes,
  ["location", "audio"],
  "navigation needs background location AND background audio (lock-screen voice)",
);

const speechAdapter = await readFile(
  new URL(
    "../apps/mobile/src/navigation/speechAdapter.js",
    import.meta.url,
  ),
  "utf8",
);
assert.match(
  speechAdapter,
  /shouldPlayInBackground\s*:\s*true/,
  "navigation speech audio session must allow background playback",
);

const he = JSON.parse(
  await readFile(
    new URL("../apps/mobile/locales/he.json", import.meta.url),
    "utf8",
  ),
);
for (const key of usageKeys) {
  assert.ok(
    typeof he[key] === "string" && /[א-ת]/.test(he[key]),
    `Hebrew usage string ${key}`,
  );
}
assert.equal(
  he.NSLocationAlwaysAndWhenInUseUsageDescription,
  undefined,
  "Hebrew Always usage string must be absent",
);

// Mapbox telemetry must stay disabled: PrivacyInfo.xcprivacy and the App
// Store privacy labels declare no collected data.
const buildScreen = await readFile(
  new URL("../apps/mobile/src/screens/BuildScreen.jsx", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  buildScreen,
  /הכוונה כשהמסך נעול|יבקש הרשאת מיקום תמיד/,
  "ride confirmation must not show the obsolete Always-location explainer",
);
assert.ok(
  buildScreen.includes("setTelemetryEnabled(false)"),
  "Mapbox.setTelemetryEnabled(false) missing from BuildScreen.jsx",
);

console.log("test-ios-release-config: ok");
