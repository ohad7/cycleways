# Segment tooltip restyle + legend relocation

Date: 2026-06-10
Status: Approved design (pre-implementation)

## Summary

The planner map's segment hover/click tooltip (`SegmentNameDisplay`,
`.segment-name-display`) is a steel-blue box in the top-left corner that shows a
segment's name, distance, elevation gain/loss, and any data points (warnings /
POIs). It looks dated and visually unrelated to the cream "editorial" POI
preview card (`RoutePoiPlaybackPreview` / `.fv-video-poi-preview`) that appears
over the map during playback.

This change restyles the segment tooltip to match the POI preview's visual
language (shared `--fv-*` palette, cream card, optional photo), removes the
overlap problem with the POI preview by hiding the tooltip during active
playback, and relocates the road-type legend from the top-left to the
conventional bottom-left corner so the segment card owns the top-left.

Scope is the **planner only**. The shared POI preview component is untouched.

## Goals

- Make the segment tooltip visually appealing and consistent with the POI
  preview (color, card shape, optional image).
- Show a representative image when the segment's data points carry photos.
- Keep the card compact and predictable no matter how many data points a
  segment has.
- Resolve the top-left overlap between the segment tooltip and the playback POI
  preview.
- Place the road-type legend in a conventional, non-competing location.

## Non-goals

- No change to *when* the tooltip is triggered: it stays a passive hover/click
  tooltip reflecting `inspectedSegment`. It does **not** become a live
  "now-playing / current segment" readout during playback.
- No change to the shared `RoutePoiPlaybackPreview` component or featured pages.
- No change to segment data, `segments.json`, or any generated/promoted data.

## Current state (reference)

- `SegmentNameDisplay` lives in `src/App.jsx` (around line 680). It renders
  `.segment-name-display` (hidden by default; `.react-segment-name-display--active`
  toggles it visible) with: name (`<strong>`), a stats line
  (`📏 km • ⬆️ gain • ⬇️ loss`), and a `.react-segment-data-list` of data points
  (emoji + information).
- Data comes from `inspectedSegmentDetails` (built by `getSegmentDetails` in
  `packages/core/src/app/useCyclewaysApp.js`): `{ distanceKm, elevationGain,
  elevationLoss, dataPoints }`. Each `dataPoint` spreads the source data marker,
  so it retains `images` / `photo` / `thumbnail` and carries a resolved `emoji`.
- Base styles: `styles.css` `.segment-name-display` (steel-blue,
  `top:25px; left:135px`, with `bounce-intro`/`pulseGlow`) and a mobile rule at
  `@media (max-width: 768px)`. Desktop overrides + the data list live in
  `src/react-app.css` (`.react-segment-name-display--active`,
  `.react-segment-data-list`, and the `@media (min-width: 769px)` block that
  sets `left:138px` and the `--has-planner-poi` shove-down to `top:122px`).
- Planner map corners today: **legend** top-left (`.legend-container`,
  `top:25px; left:25px`), **search** top-right (`.search-container`,
  `top:25px; right:25px`), **playback controls** full-width along the bottom
  (`.planner-route-playback`, `bottom:25px`), **data-marker card** fixed
  bottom-center. The legend hides during active playback
  (`.map-container--planner-playing .legend-container { display:none }`); the
  POI preview occupies the top-left during playback.
- Data reality (from `public-data/segments.json`): 336 segments, only 55 have
  any data points; the maximum in a single segment is **4** (41 have 1, 10 have
  2, 3 have 3, 1 has 4).

## Design

### 1. Restyled card

`.segment-name-display` becomes a cream editorial card using the shared
`--fv-*` palette (already reachable on the planner — the planner POI preview
uses `var(--fv-clay)` etc. successfully). Accent color is **forest/green**
(`--fv-forest` / `--fv-forest-soft`) so segment info reads as distinct from a
clay-accented POI while staying in the same palette family.

Layout (RTL), mirroring the POI preview's media + body structure:

- **Media** (inline-start): a ~104×96 rounded thumbnail when the segment has a
  photo; otherwise a forest-tinted icon circle with a road glyph (🛣️).
- **Body**:
  - `מקטע` eyebrow — small, bold, forest-colored (the POI preview's type-label
    role).
  - **Segment name** — bold ink (`--fv-ink`).
  - **Stats row** — `📏 {distanceKm} ק"מ` · `⬆️ {gain} מ'` · `⬇️ {loss} מ'`,
    muted ink, wrapping.
  - **Data chips** — one forest-tinted chip per data point (`emoji` +
    `information`), capped (see §3).

Card chrome matches the POI preview: `background: rgba(253,252,248,.96)`,
`border: 1px solid var(--fv-line)`, `border-radius: 8px`, the same soft drop
shadow. The existing `bounce-intro`/`pulseGlow` entrance can be retained or
dropped; if retained, retune the glow color from steel-blue to forest. Default:
keep a subtle entrance, recolored.

### 2. Image source

Add a pure helper `segmentPreviewImage(details)`:

- Walk `details.dataPoints`, take the first whose `previewImage(dataPoint)`
  (from `@cycleways/core/data/poiTypes.js`) returns an image entry.
- Resolve it via `imageSrc(entry)` (from
  `src/components/featured/routePoiStoryData.js`).
- Return the resolved URL string, or `""` when no data point has an image.

`SegmentNameDisplay` renders the `<img>` when the helper returns a URL, and the
icon-circle fallback otherwise. Both helpers already exist; no new data
plumbing.

### 3. Chip cap

Render at most 3 chips; if there are more, append a `+N נוספים` chip
("+N more"). With today's max of 4 this affects almost nothing, but it keeps the
hover card compact and bounded if a segment later accumulates many POIs. (A
future click/focus "expanded" view could list all; out of scope here.)

### 4. Playback behavior

- Hide the card while actively playing: add
  `.map-container--planner-playing .segment-name-display { display: none; }`.
  The `--planner-playing` class already tracks `plannerPlayback.isPlaying`.
- The card returns the moment playback pauses or stops.
- Keep the existing `.map-container--has-planner-poi .segment-name-display`
  shove-down rule, retuned for the new card height, to cover the rare
  paused-next-to-a-POI overlap (POI preview visible while not playing).

### 5. Legend relocation

Move `.legend-container` from top-left to the conventional **bottom-left**
corner. Because the segment card now owns the top-left, it starts at the corner
(`left: 25px` instead of `left: 138px`) with the full column width.

Legend positioning details:

- Default (browsing / no route): `bottom-left` of the map.
- When a route is loaded the full-width playback controls occupy the bottom, so
  the legend must **lift above the controls** — reuse the existing
  `--route-ready` offset pattern (cf. `.map-container--route-ready
  .route-description-panel { bottom: 104px }`) to raise the legend clear of the
  controls bar.
- During active playback the legend continues to hide
  (`.map-container--planner-playing .legend-container { display:none }`,
  unchanged).

### 6. Mobile

Update the existing `@media (max-width: 768px)` rules so the restyled card fits
the mobile viewport (mirroring the POI preview's mobile sizing: smaller
thumbnail, reduced font sizes, optionally hide the eyebrow). Verify the
bottom-left legend doesn't collide with mobile controls; lift/hide as on
desktop.

## Component / file changes

- `src/App.jsx` — restructure `SegmentNameDisplay` JSX into the media + body
  layout; use `segmentPreviewImage(details)`; apply the chip cap; render the
  icon fallback. Import `previewImage` and `imageSrc`.
- New helper `segmentPreviewImage(details)` — placed where it can be imported by
  both `App.jsx` and the test (e.g. a small module under `src/components/` or
  alongside the existing planner helpers). Pure, no React.
- `styles.css` — replace `.segment-name-display` base styles with the cream
  card; retune/relocate the entrance animation color; move `.legend-container`
  to bottom-left; update the `@media (max-width: 768px)` rules.
- `src/react-app.css` — update `.react-segment-name-display--active`,
  `.react-segment-data-list` → chip styles, the `@media (min-width: 769px)`
  block (`left:25px`, retuned `--has-planner-poi` offset), add the
  `--planner-playing` hide rule and the route-ready legend lift.

## Testing

- **Unit** — `tests/test-segment-preview-image.mjs` for
  `segmentPreviewImage(details)`:
  - returns the resolved URL of the first data point that has an image,
  - skips data points without images,
  - returns `""` when no data point has an image,
  - resolves a bare `public-data/...` path to a leading-slash URL via
    `imageSrc`.
  Wire it into the `npm test` script list.
- **Manual** (running app):
  - hover a plain segment → cream card, icon fallback, stats;
  - hover a segment with a warning + photo → thumbnail + forest chip;
  - hover the 4-data-point segment → chip cap behaves;
  - build + play a route → card hidden during play, returns on pause;
  - confirm the legend sits bottom-left, lifts above the controls when a route
    is ready, and hides during play.

## Risks / notes

- `--fv-*` variables must be in scope on the planner. They are (the planner POI
  preview already consumes them); verify the relevant `:root`/global definition
  still applies after the restyle.
- Using a POI's photo as the segment "image" is intentionally opportunistic —
  the photo belongs to a data point on the segment, not the segment itself. The
  `מקטע` eyebrow keeps the framing clear.
- Bottom-left legend must not fight the bottom-center data-marker card or the
  playback bar; the route-ready lift + playback hide handle the known cases.
