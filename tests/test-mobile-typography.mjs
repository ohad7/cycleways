import assert from "node:assert/strict";

import { text, fontSizes, fontWeights } from "../apps/mobile/src/theme/typography.js";
import { textVariants } from "../packages/core/src/ui/typography.js";

assert.deepEqual(Object.keys(text).sort(), Object.keys(textVariants).sort());
assert.deepEqual(text.heading, { fontSize: 24, fontWeight: "700", lineHeight: 29 });
assert.deepEqual(text.body, { fontSize: 15, fontWeight: "400", lineHeight: 22 });
assert.deepEqual(text.display, { fontSize: 30, fontWeight: "800", lineHeight: 33 });

for (const style of Object.values(text)) {
  assert.equal(typeof style.fontWeight, "string");
  assert.equal(style.lineHeight, Math.round(style.lineHeight), "integer px line height");
}

assert.equal(fontSizes.sm, 13);
assert.equal(fontWeights.bold, 700);

console.log("test-mobile-typography: OK");
