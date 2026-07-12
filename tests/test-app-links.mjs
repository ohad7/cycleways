import assert from "node:assert/strict";
import {
  ACCESSIBILITY_URL,
  FEEDBACK_FORM_URL,
  PRIVACY_URL,
  SITE_ORIGIN,
  SITE_OPERATOR_DESCRIPTION,
  SUPPORT_EMAIL,
  SUPPORT_URL,
  TERMS_URL,
} from "@cycleways/core/config/appLinks.js";

assert.equal(SITE_ORIGIN, "https://www.cycleways.app");
assert.equal(PRIVACY_URL, "https://www.cycleways.app/privacy");
assert.equal(TERMS_URL, "https://www.cycleways.app/terms");
assert.equal(ACCESSIBILITY_URL, "https://www.cycleways.app/accessibility");
assert.equal(SUPPORT_URL, "https://www.cycleways.app/support");
assert.match(SITE_OPERATOR_DESCRIPTION, /CycleWays/);
assert.match(SITE_OPERATOR_DESCRIPTION, /אדם יחיד/);
assert.match(SUPPORT_EMAIL, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
assert.ok(FEEDBACK_FORM_URL.startsWith("https://forms.gle/"));

console.log("test-app-links: ok");
