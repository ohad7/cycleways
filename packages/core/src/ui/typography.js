// Single source of truth for typography across web and native.
// Source of truth: plans/typography-design-system/design.md
// Web CSS is generated from this module by scripts/generate-typography-css.mjs.

export const fontSizes = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
};

export const fontWeights = {
  regular: 400,
  semibold: 600,
  bold: 700,
  heavy: 800,
};

export const lineHeights = {
  tight: 1.1,
  heading: 1.2,
  snug: 1.3,
  caption: 1.4,
  body: 1.45,
};

export const webFontStack = "'Assistant', -apple-system, 'Segoe UI', Tahoma, sans-serif";

export const textVariants = {
  display: {
    fontSize: fontSizes["3xl"],
    fontWeight: fontWeights.heavy,
    lineHeight: lineHeights.tight,
  },
  heading: {
    fontSize: fontSizes["2xl"],
    fontWeight: fontWeights.bold,
    lineHeight: lineHeights.heading,
  },
  subheading: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    lineHeight: lineHeights.snug,
  },
  body: {
    fontSize: fontSizes.md,
    fontWeight: fontWeights.regular,
    lineHeight: lineHeights.body,
  },
  bodyStrong: {
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    lineHeight: lineHeights.body,
  },
  caption: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.regular,
    lineHeight: lineHeights.caption,
  },
  captionStrong: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    lineHeight: lineHeights.caption,
  },
  label: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    lineHeight: lineHeights.snug,
  },
  navTitle: {
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.heavy,
    lineHeight: lineHeights.heading,
  },
  navBody: {
    fontSize: fontSizes.md,
    fontWeight: fontWeights.bold,
    lineHeight: lineHeights.body,
  },
  navCaption: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.bold,
    lineHeight: lineHeights.caption,
  },
};
