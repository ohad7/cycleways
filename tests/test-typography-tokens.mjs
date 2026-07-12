import assert from "node:assert/strict";

import {
  fontSizes,
  fontWeights,
  lineHeights,
  webFontStack,
  textVariants,
} from "../packages/core/src/ui/typography.js";

assert.deepEqual(fontSizes, {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
});

assert.deepEqual(fontWeights, {
  regular: 400,
  semibold: 600,
  bold: 700,
  heavy: 800,
});

assert.ok(webFontStack.includes("Assistant"));

assert.deepEqual(
  Object.keys(textVariants).sort(),
  [
    "body",
    "bodyStrong",
    "caption",
    "captionStrong",
    "display",
    "heading",
    "label",
    "navBody",
    "navCaption",
    "navTitle",
    "subheading",
  ],
);

const scaleValues = Object.values(fontSizes);
const weightValues = Object.values(fontWeights);
const lineValues = Object.values(lineHeights);

for (const [name, v] of Object.entries(textVariants)) {
  assert.ok(scaleValues.includes(v.fontSize), `${name} size on scale`);
  assert.ok(weightValues.includes(v.fontWeight), `${name} weight sanctioned`);
  assert.ok(lineValues.includes(v.lineHeight), `${name} line-height token`);
  if (v.fontWeight === fontWeights.heavy) {
    assert.ok(["display", "navTitle"].includes(name), `heavy weight leaked into ${name}`);
  }
}

assert.deepEqual(textVariants.heading, {
  fontSize: 24,
  fontWeight: 700,
  lineHeight: 1.2,
});
assert.deepEqual(textVariants.body, {
  fontSize: 15,
  fontWeight: 400,
  lineHeight: 1.45,
});
assert.deepEqual(textVariants.display, {
  fontSize: 30,
  fontWeight: 800,
  lineHeight: 1.1,
});
assert.deepEqual(textVariants.navBody, {
  fontSize: 15,
  fontWeight: 700,
  lineHeight: 1.45,
});

console.log("test-typography-tokens: OK");
