import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appJson = JSON.parse(
  await readFile(new URL("../apps/mobile/app.json", import.meta.url), "utf8"),
);
const ios = appJson.expo.ios;

// Build number must exist and be numeric so release uploads can bump it.
assert.match(ios.buildNumber, /^\d+$/);

// Standard-encryption-only declaration: skips the export-compliance prompt
// on every App Store Connect upload.
assert.equal(ios.infoPlist.ITSAppUsesNonExemptEncryption, false);

// Hebrew InfoPlist localization must be wired.
assert.equal(ios.infoPlist.CFBundleAllowMixedLocalizations, true);
assert.equal(appJson.expo.locales?.he, "./locales/he.json");

const usageKeys = [
  "NSLocationWhenInUseUsageDescription",
  "NSLocationAlwaysAndWhenInUseUsageDescription",
];
for (const key of usageKeys) {
  assert.ok(
    typeof ios.infoPlist[key] === "string" && ios.infoPlist[key].length > 10,
    `base usage string ${key}`,
  );
}

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

// Mapbox telemetry must stay disabled: PrivacyInfo.xcprivacy and the App
// Store privacy labels declare no collected data.
const buildScreen = await readFile(
  new URL("../apps/mobile/src/screens/BuildScreen.jsx", import.meta.url),
  "utf8",
);
assert.ok(
  buildScreen.includes("setTelemetryEnabled(false)"),
  "Mapbox.setTelemetryEnabled(false) missing from BuildScreen.jsx",
);

console.log("test-ios-release-config: ok");
