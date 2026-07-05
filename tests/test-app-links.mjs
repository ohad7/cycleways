import assert from "node:assert/strict";
import {
  FEEDBACK_FORM_URL,
  PRIVACY_URL,
  SITE_ORIGIN,
  SUPPORT_EMAIL,
  SUPPORT_URL,
  TERMS_URL,
} from "@cycleways/core/config/appLinks.js";

assert.equal(SITE_ORIGIN, "https://www.cycleways.app");
assert.equal(PRIVACY_URL, "https://www.cycleways.app/privacy");
assert.equal(TERMS_URL, "https://www.cycleways.app/terms");
assert.equal(SUPPORT_URL, "https://www.cycleways.app/support");
assert.match(SUPPORT_EMAIL, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
assert.ok(FEEDBACK_FORM_URL.startsWith("https://forms.gle/"));

console.log("test-app-links: ok");
