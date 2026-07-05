import assert from "node:assert/strict";
import { aboutModel } from "../apps/mobile/src/screens/aboutModel.js";
import {
  PRIVACY_URL,
  SUPPORT_URL,
  TERMS_URL,
} from "@cycleways/core/config/appLinks.js";

// Version line composes marketing version + build number.
{
  const model = aboutModel({ appVersion: "1.0.0", buildNumber: "7" });
  assert.equal(model.versionLine, "גרסה 1.0.0 (בנייה 7)");
}

// Links point at the canonical site URLs, in privacy/terms/support order.
{
  const model = aboutModel({ appVersion: "1.0.0", buildNumber: "7" });
  assert.deepEqual(
    model.links.map((link) => link.url),
    [PRIVACY_URL, TERMS_URL, SUPPORT_URL],
  );
  for (const link of model.links) {
    assert.ok(link.key.length > 0);
    assert.ok(/[א-ת]/.test(link.label), `Hebrew label for ${link.key}`);
  }
}

// Missing native version info falls back to a dash, never "undefined".
{
  const model = aboutModel({});
  assert.ok(!model.versionLine.includes("undefined"), model.versionLine);
  assert.ok(model.versionLine.includes("—"), model.versionLine);
}

// Attribution covers the map providers and the ODbL-derived routing data.
{
  const model = aboutModel({});
  assert.ok(model.attribution.some((line) => line.includes("Mapbox")));
  assert.ok(model.attribution.some((line) => line.includes("OpenStreetMap")));
  assert.ok(model.attribution.some((line) => line.includes("ODbL")));
  assert.ok(model.safetyNotice.length > 20);
}

console.log("test-about-model: ok");
