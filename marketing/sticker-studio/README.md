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

## Placement operations

The **Locations** workspace is backed by:

```text
marketing/sticker-data/registry.json
```

The regular Vite development server exposes the private local persistence API.
Restart `npm run dev` after changing `vite.config.mjs`. Registry writes are
validated, revision-checked, atomic, and backed up to `registry.json.bak` before
replacement.

The workflow is:

1. Plan a location by clicking the map or using the explicit current-location
   action.
2. Record permission, location type, priority, landmark, and instructions.
3. Create a physical placement and assign a unique short code.
4. Choose **Design & assign**, then export the sticker. The exact generator
   configuration becomes an immutable design version.
5. In the field, mark it placed, upload a photo, and verify its condition and QR.
6. Later mark it overdue, damaged, missing, removed, or create a replacement.

JSON, GeoJSON, field CSV, verification-route, campaign, candidate-score,
print-batch, replacement-history, and aggregate scan fields are included.

## Public short redirects

Each registry save derives a coordinate-free public file:

```text
data/sticker-redirects.json
```

`npm run build` regenerates and copies it. Public URLs such as
`https://cycleways.app/s/K7M4Q` resolve through the lightweight React redirect
route. The public file contains only the code, target, active flag, and design
version—never coordinates, notes, permission data, or photos.

The local Vite API records privacy-minimal scan events containing only placement
identity and time. Static GitHub Pages cannot receive writes; production scan
counting therefore requires setting `window.CYCLEWAYS_STICKER_SCAN_ENDPOINT` to
a deployed compatible endpoint. Redirecting itself is fully static and does not
depend on scan recording.
