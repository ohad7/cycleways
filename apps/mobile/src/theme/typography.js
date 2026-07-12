// RN-ready typography styles derived from shared core tokens.
// Spec: plans/typography-design-system/design.md

import { textVariants, fontSizes, fontWeights } from "@cycleways/core/ui/typography.js";

const toNativeStyle = ({ fontSize, fontWeight, lineHeight }) => ({
  fontSize,
  fontWeight: String(fontWeight),
  lineHeight: Math.round(fontSize * lineHeight),
});

export const text = Object.fromEntries(
  Object.entries(textVariants).map(([name, v]) => [name, toNativeStyle(v)]),
);

export { fontSizes, fontWeights };
