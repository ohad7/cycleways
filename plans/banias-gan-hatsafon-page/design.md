# Banias / Gan HaTzafon featured page — design

Date: 2026-06-03

## Goal

Publish a featured landing page for the `banias-gan-hatsafon` route, matching
the polished video-first experience of `sovev-beit-hillel`. In the process,
generalize the sovev page's bespoke scaffold into a reusable **video-route
template** so that future featured pages differ only in their content, not their
layout.

## Context (what already exists)

- **Catalog entry** — `public-data/route-catalog.json` has
  `banias-gan-hatsafon` (`featured: true`, 14.8 km, easy/family, fully paved,
  region `hula-valley`), including a `start` point with name, description, and a
  WebP image (already present in `public-data/poi-images/`).
- **Ride-along video** — `public-data/route-videos/banias-gan-hatsafon.json`
  exists (`youtubeId: S8H2zx_Cnt0`, ~296 s) with keyframes, and is registered in
  `public-data/route-videos/index.json`. So the synced video player works for
  this route today.
- **POIs** — flow automatically from the route's segment data via
  `routeState.activeDataPoints`. Currently one POI; more can be added later with
  no page change.
- **Shared sub-components already exist** — `VideoEmbed`, `RoutePoiStoryList`,
  `RoutePoiVideoPreview`, `RoutePoiGallery`, and `FeaturedRouteMap` are generic;
  they merely carry a route-specific `sbh-` (sovev-beit-hillel) class prefix.
- **The only page-specific code** is the scaffold + prose hand-written in
  `src/featured/sovev-beit-hillel.jsx`.

## Design

### 1. Extract a video-route template — `FeaturedVideoRoute`

New component `src/components/featured/FeaturedVideoRoute.jsx` owns the layout
currently inlined in `sovev-beit-hillel.jsx`:

- playback section → video stage/shell with `Video` + `POIVideoPreview` +
  mobile `Map`;
- side rail → intro panel + `ProgressDistance` + desktop `Map`;
- "about" section;
- `POIStories`.

It internally renders the existing `FeaturedRoute` with
`layout="video-first" desktopMap="manual"`, and accepts **content only** as
props:

```jsx
<FeaturedVideoRoute
  slug="banias-gan-hatsafon"
  kicker="גליל עליון · רכיבה למשפחות"
  intro={{ kicker, heading, body: ["…", "…"] }}     // body: array of paragraphs
  about={{ kicker, heading, paragraphs: ["…", "…"] }}
/>
```

Both pages use it. `sovev-beit-hillel.jsx` is rewritten to pass its existing
prose through `intro`/`about`, proving the template against the known-good page.

`intro.body` and `about.paragraphs` are arrays of strings, each rendered as a
`<p>`. (Sovev's current double `<br>` spacing is reproduced via paragraph
splitting, not literal `<br>` tags.)

### 2. De-route-specify the CSS prefix: `sbh-` → `fv-`

Mechanical global rename so the shared template isn't named after one route:

- `src/components/featured/featured.css` (~243 occurrences), including the CSS
  custom property `--sbh-video-progress` → `--fv-video-progress`.
- The 5 shared components listed above.
- Anchor ids: `sbh-about` → `fv-about`; the hardcoded `sbh-poi-stories`
  (in `RoutePoiStoryList`) → `fv-poi-stories`; the `.sbh-video-shell` /
  `.sbh-poi-story` query selectors in `FeaturedRouteMap`, `RoutePoiStoryList`,
  and `RoutePoiVideoPreview`.
- Nav anchor hrefs in `src/featured/index.js` updated to the new ids.

This is naming-only; correctness is confirmed by the build plus a visual check
that the sovev page is unchanged.

### 3. New page + registration

- Add `src/featured/banias-gan-hatsafon.jsx` using `FeaturedVideoRoute`.
- Register in `src/featured/index.js`: `moduleLoaders["banias-gan-hatsafon"]`
  and `moduleNav["banias-gan-hatsafon"]` (`#fv-about`, `#fv-poi-stories`,
  back-to-map).

### 4. Content

Hebrew prose for `intro`/`about` is drafted from the catalog summary, the
start-point description (שער שדה נחמיה — שער כניסה צהוב, חניית כורכר, פנייה לכיוון
הנחל), and route facts (14.8 km, paved, family-friendly, מעגלי, בניאס/גן הצפון).
Author drafts; user edits afterward.

## Out of scope

- No edits to generated map data / `public-data/` artifacts (catalog, video
  keyframes, images already exist and are owned by the editor/pipeline).
- No new POIs (added later via the editor).
- No functional change to the video/map/POI sub-components beyond renaming.

## Verification

- App builds.
- `grep -rn "sbh-" src/` returns nothing.
- Sovev Beit Hillel page renders identically to before.
- Banias page renders: header, synced video, map, intro/about prose, start
  endpoint + POI stories.
