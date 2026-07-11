# Cycleways Sticker Studio Implementation Plan

**Date:** 2026-07-11

1. Preserve the supplied assets and add a non-destructive female-rider template.
2. Implement pure helpers for destinations, caption wrapping, filenames, pixel
   dimensions, and physical QR module validation.
3. Build the local Sticker Studio form and live SVG preview.
4. Add self-contained SVG, print-resolution PNG, and repeated A4 print output.
5. Cover the pure helpers with Node tests.
6. Run the tests and production build, then visually verify representative male,
   female, Hebrew, and QR configurations in the browser.

Expected validation:

- Route slugs resolve to canonical `/routes/:slug` URLs.
- Invalid custom URLs block QR generation rather than silently encoding bad data.
- QR output always includes a four-module quiet zone.
- The UI warns when a dense QR produces modules below 0.4 mm at print size.
- PNG dimensions match the selected millimetres and DPI.
- Hebrew captions keep their direction and never exceed two generated lines.

