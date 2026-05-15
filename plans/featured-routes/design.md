# Featured Routes Design

## Goal

Add a "featured routes" feature: curated, recommended routes (e.g. "סובב בית הלל")
that have their own landing page with a description, map, photos, video, business
contacts, warnings, and points of interest along the way. Featured routes are
authored by the maintainer in the repository alongside other content.

The feature should:

- give each featured route a stable, shareable URL;
- present a rich landing page that does not require the map to dominate the
  viewport;
- work on both desktop and mobile, with different layouts per breakpoint;
- reuse the existing route engine, map renderer, and POI plumbing; not
  duplicate any of them;
- let the author control what appears on a route page — including which
  segment POIs to show, which to hide, and what extra route-specific content
  to add.

## Current Shape

The public app currently has:

- a single page at `/` containing the route planner (map plus content
  sections);
- routes encoded into a `?route=<token>` URL parameter, decoded via
  `restoreRouteFromParam` in `src/routing/routeActions.js`;
- segment metadata in `segments.json`, including a `data` array per segment
  with entries of shape `{ type, information, location? }`. The supported
  types today are warnings: `mud`, `gate`, `payment`, `slope`, `narrow`,
  `severe`, `warning`;
- a "המומלצים שלנו" content section (`src/components/ContentSections.jsx`)
  that hardcodes a list of recommended segments and a single hardcoded
  recommended complete route as an `<a>` link to `/?route=…`;
- no client-side router — all UI lives under `/`.

## Product And Architecture Decision

**Each featured route is a JSX module** in `src/featured/`, not a JSON file.
Authoring in JSX gives per-route flexibility (custom prose order, inline
images, optional sections), Vite handles image bundling and code splitting,
and the author is already comfortable in React.

**Each featured route has its own URL** under `/featured/<slug>`. A new
`/featured` gallery page indexes them.

**POIs along the route extend `segments.json`** rather than being authored
per-route. New POI types are added: `viewpoint`, `landmark`, `cafe`,
`restaurant`, `bike_shop`, `flora`, `nature`, `rest_stop`. They share the
existing `{ type, information, location }` base and add optional `id`,
`name`, `photo`, `phone`, `website`, `hours` fields. Because POIs live on
segments, they automatically surface on any route — featured or
user-planned — that traverses the segment. The featured-route page
consumes the same `activeDataPoints` already computed in
`routeActions.js`, with author overrides via `exclude` and `extra` props.

**Client-side routing uses `react-router-dom`.** Three URL surfaces:

- `/` — existing planner, unchanged behavior;
- `/featured` — gallery of all featured routes;
- `/featured/<slug>` — individual featured-route landing page.

GitHub Pages needs a 404.html → index.html SPA fallback for deep links to
resolve; the build adds this.

## Authoring Model

A featured route is a JSX module that exports:

- `meta` — `{ slug, name, summary, route, hero, difficulty, tags }`;
- a default-export React component — the body of the route page.

```jsx
// src/featured/sovev-beit-hillel.jsx
import FeaturedRoute from "../components/featured/FeaturedRoute.jsx";
import heroImg from "../../attached_assets/featured/sovev/hero.jpg";
import startImg from "../../attached_assets/featured/sovev/start.jpg";

export const meta = {
  slug: "sovev-beit-hillel",
  name: "סובב בית הלל",
  summary: "מסלול קצר ונעים מסביב לבית הלל",
  route: "u2RR2EzQKyMNaQSfoLh5fhMieHKFiE8qzNLPTbbR5jf2",
  hero: heroImg,
  difficulty: "easy",
  tags: ["family-friendly", "river"],
};

export default function SovevBeitHillel() {
  return (
    <FeaturedRoute meta={meta}>
      <p>המסלול מתחיל ליד החניון של בית הלל…</p>
      <img src={startImg} alt="הכניסה למסלול" />

      <FeaturedRoute.Map />

      <p>אחרי כ-2 ק"מ תגיעו לתצפית יפה…</p>

      <FeaturedRoute.POIs
        exclude={["cafe-galil-2"]}
        extra={[{
          type: "cafe",
          id: "cafe-dana",
          name: "בית הקפה של דנה",
          information: "ארוחת בוקר עד 12",
          location: [33.21, 35.60],
          photo: "featured/sovev/cafe-dana.jpg",
          phone: "+972-50-1234567",
        }]}
      />

      <FeaturedRoute.Video src="https://www.youtube.com/watch?v=…" />
      <FeaturedRoute.Gallery photos={[g1, g2, g3]} />
    </FeaturedRoute>
  );
}
```

The order of children in the JSX is the order on the page. Any slot whose
data is empty (e.g. `<Gallery photos={[]}>`) renders nothing. The author
controls what shows by what they include.

Module discovery uses Vite's glob import. `meta` is eager (needed
synchronously by the gallery page and the home-page hero cards); the
default component export is lazy (loaded only when a specific
`/featured/:slug` page is navigated to):

```js
// src/featured/index.js
const metaModules = import.meta.glob("./*.jsx", {
  eager: true,
  import: "meta",
});
const componentLoaders = import.meta.glob("./*.jsx");

export const featuredRoutes = Object.entries(metaModules).map(
  ([path, meta]) => ({ meta, load: componentLoaders[path] }),
);
```

## Data Model

### POI schema extension (in `segments.json`)

Existing warning entries keep their current shape. New POI entries extend
it with optional fields:

```json
{
  "type": "cafe",
  "id": "cafe-dana",
  "name": "בית הקפה של דנה",
  "information": "ארוחת בוקר עד 12:00",
  "location": [33.21, 35.60],
  "photo": "pois/cafe-dana.jpg",
  "phone": "+972-50-1234567",
  "website": "https://…",
  "hours": "א-ה 8:00-18:00"
}
```

Field rules:

- `type` — required; one of the existing warning types or one of the new
  POI types listed above;
- `information` — required;
- `id` — required for any POI a featured route may reference via
  `exclude`. Existing warning entries get ids as they are referenced.
  The runtime-computed `${segmentName}-${index}` id in
  `getActiveRouteDataPoints` is replaced by the stable `id` so that
  reordering entries in `segments.json` does not break references;
- `location` — required for the new POI types (so they can be mapped and
  filtered against the route geometry); remains optional for existing
  warning types;
- `name`, `photo`, `phone`, `website`, `hours` — optional, used for
  businesses and richer cards.

### POI type constants (moved to shared module)

`WARNING_EMOJIS`, `WARNING_COLORS`, `WARNING_TRANSLATIONS`, and
`WARNING_PRIORITY` currently live inside `src/App.jsx`. They move to
`src/data/poiTypes.js` so the new POI cards reuse the same iconography.
New entries are added for `viewpoint`, `landmark`, `cafe`, `restaurant`,
`bike_shop`, `flora`, `nature`, `rest_stop`.

## URL And Routing

`react-router-dom` is added as a dependency. The app's entry point
(`src/main.jsx`) wraps the existing `<App />` in a `<BrowserRouter>` with
routes:

| Path                  | Component               | Notes |
|-----------------------|-------------------------|-------|
| `/`                   | `<App />`               | Existing planner, unchanged. |
| `/featured`           | `<FeaturedIndexPage />` | Gallery of all featured routes. |
| `/featured/:slug`     | `<FeaturedRoutePage />` | Looks up module by slug, renders default export. 404 for unknown slug. |
| anything else         | `<App />` (default)     | Existing behavior preserved. |

GitHub Pages 404 fallback: a `public/404.html` is added that is a copy
of `index.html` (Vite copies `public/` to the build output as-is). When
GitHub Pages can't find a file for `/featured/<slug>`, it serves
`404.html`, which is the SPA shell — `react-router-dom` then resolves
the path client-side. No redirect or path-rewriting hack needed.

The route geometry param continues to use the existing encoded format.
The featured-route page reads it from `meta.route` and passes it through
`restoreRouteFromParam` exactly as the planner does today. The route
engine (`route-manager.js`) is unchanged.

## Page Layout

Two layouts, one breakpoint (the existing mobile breakpoint, ~768px).

### Desktop — sticky map split

- Single full-width header band with name, summary, distance, elevation
  gain, difficulty, and hero image.
- Below the header: two columns. One column is a sticky `<MapView>` with
  the route pre-drawn (read-only — no point creation, no drag). The other
  column scrolls and contains the article (the JSX module's children).
- The map column stays visible the whole time the article scrolls.
- Clicking a POI card in the article pans the map and highlights its
  marker. Clicking a marker on the map highlights the corresponding card.

### Mobile — article-first

- Single column. No sticky map.
- The header band is the same content, stacked.
- `<FeaturedRoute.Map>` in the JSX renders an inline interactive map
  (~280px tall) at its position in the body. If the author omits it, the
  shell renders one immediately after the header.
- The inline map has a "מפה מלאה" button → opens a fullscreen modal
  map (`position: fixed`) with a close button.
- Clicking a POI card scrolls the inline map into view and pans it to
  the POI's location.
- `<FeaturedRoute.Gallery>` becomes a horizontal swipe carousel
  (`scroll-snap-type: x mandatory`) instead of a grid.

The shell uses the same `MapView.jsx` already in the codebase. Read-only
behavior is achieved by not passing `onMapClick`, `onRoutePointDrag`, or
`onRoutePointRemove`.

## Component Inventory

```text
src/
  featured/                       # per-route JSX modules (authored content)
    sovev-beit-hillel.jsx
    shdeh-nehemia-baniyas.jsx     # migrated from the hardcoded link
    index.js                      # glob import → list of meta

  components/featured/            # the framework
    FeaturedRoute.jsx             # shell + context provider + responsive layout
    FeaturedRouteMap.jsx          # inline mobile map slot
    Header.jsx                    # name, summary, stats, hero
    POIList.jsx                   # consumes activeDataPoints + exclude/extra
    POICard.jsx                   # renders one POI (cafe, viewpoint, etc.)
    Gallery.jsx                   # grid on desktop, carousel on mobile
    VideoEmbed.jsx                # lazy-loaded iframe
    Warnings.jsx                  # warning-type entries from activeDataPoints

  pages/
    FeaturedRoutePage.jsx         # /featured/:slug router handler
    FeaturedIndexPage.jsx         # /featured gallery

  data/
    poiTypes.js                   # icon/color/translation constants
                                  # (moved out of App.jsx)
```

`<FeaturedRoute>` is the shell. It receives `meta`, decodes
`meta.route` via `restoreRouteFromParam`, builds the route through
`RouteManager`, computes distance/elevation/`activeDataPoints`, provides
all of it on a `FeaturedRouteContext`, renders the responsive layout, and
renders the header. Slot components (`<FeaturedRoute.Map>`,
`<FeaturedRoute.POIs>`, etc.) read from the context.

Slot components hide themselves when there is no content
(`<Gallery photos={[]}>` returns `null`, `<Video src={undefined}>` returns
`null`).

## Map–POI Interaction

- The map shows a marker for each POI surfaced on the route (same data
  marker pipeline as today: `dataMarkerFeaturesFromSegments` in
  `src/map/mapLayers.js`).
- The shell tracks a `focusedPoi` id in state.
- A POI card click sets `focusedPoi`, which causes the map to pan to the
  POI's location and the marker to highlight (reusing the existing
  `selectedDataMarker` plumbing).
- A marker click sets the same `focusedPoi`. On desktop the corresponding
  card gets a highlight border. On mobile the card scrolls into view.

## Recommendations Section Migration

`src/components/ContentSections.jsx` currently has two relevant blocks
on `/`:

- **"קטעים מומלצים לרכיבה"** — recommended *segments*. Each item focuses a
  segment on the map. These are segment-level recommendations, distinct
  from featured routes. **Kept as-is.**
- **"מסלולים שלמים מומלצים"** — recommended complete routes. Currently
  one hardcoded `<a href="/?route=AQByAAcABAAFAFgAYABeAAoAeAAZAHIA">`.
  **Replaced** with a link to `/featured` plus 3–4 inline hero cards
  rendered from `featuredRoutes` (the glob-imported `meta` list), using
  the same gallery card component as the index page.

The single existing hardcoded route is migrated to a featured-route JSX
module as part of this work, so the home page has at least two featured
routes to display.

## Hosting And Build

- The Vite build emits per-route chunks for the body components (lazy
  glob loaders); `meta` is bundled into the main entry. Image assets
  imported by each module are bundled and hashed by Vite.
- `public/404.html` is a copy of `index.html` so GitHub Pages serves the
  SPA shell for any deep link path.
- No backend; no CMS.

## Non-Goals

- Per-route Open Graph tags or build-time SEO prerendering. SPA-only for
  v1; if social previews matter, prerendering is a follow-up.
- Admin UI for non-technical authors.
- User-contributed featured routes.
- Per-route map style customization (different basemap, fly-through,
  animations).
- Multi-language support.
- Comments, ratings, likes.
- Restructuring `RouteManager` or the route encoding to accommodate
  featured-route metadata.
- Modifying segment-level features that are not POIs (geometry,
  elevation processing, etc.).

## Implementation Notes

Deviations and clarifications recorded during phases 1–7:

- **Vite `appType`** in `vite.config.mjs` is `"spa"` (not `"mpa"` as the
  early spec suggested). The `"spa"` value gives the dev server the SPA
  history-fallback behavior required for `/featured/<slug>` deep links.
- **`src/data/mapAssets.js`** resolves manifest URLs against the Vite
  `BASE_URL` so the app works under non-root deploys.
- **`useIsMobile`** is extracted to `src/components/featured/useIsMobile.js`
  and shared by the mobile inline map and other responsive bits.
- **`src/featured/sovev-beit-hillel.jsx`** currently uses the legacy
  `u2RR…`-style route token rather than a new compact-route token; both
  encodings decode via `restoreRouteFromParam`, so the page works either
  way. The token can be re-encoded later without code changes.
- **`GalleryCard` accepts a `headingLevel` prop** (default `"h2"`). The
  `/featured` index relies on the default; `ContentSections.jsx` passes
  `"h3"` so cards nested under the home page's `<h2>` use a correct
  heading hierarchy.
- **Distance computation in `FeaturedIndexPage`** uses a serial loop
  intentionally — `restoreRouteFromParam` is synchronous, so
  `Promise.all` would offer no parallelism. The work is single-shot on
  mount.
