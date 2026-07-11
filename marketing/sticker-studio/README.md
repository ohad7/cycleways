# Cycleways Sticker Studio

Run the regular Vite development server:

```bash
npm run dev
```

Then open:

```text
http://127.0.0.1:5173/marketing/sticker-studio/
```

The page is a private local marketing utility and is not linked from the public
site. It exports a self-contained SVG, a PNG at the selected physical size and
DPI, or an A4 sheet through the browser print dialog.

Rider artwork is grouped into adult, child, youth, and commute options. Each
template keeps the river/road on the right and reserves the left-center landscape
for the optional QR. At the default 90 mm sticker size, the QR prints at roughly
17 mm with modules just above the 0.4 mm print-safety guideline; longer URLs or
smaller stickers may trigger a warning.

The current badge sources are raster images with opaque gray corners. Ask the
printer to confirm the desired square or contour-cut treatment before a large
production run.
