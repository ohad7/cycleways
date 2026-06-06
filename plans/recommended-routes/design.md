# Recommended Routes Public Catalog

Date: 2026-06-04

## Problem

The app currently has a route catalog at `public-data/route-catalog.json`, but
the public gallery at `/featured` only lists entries where `featured: true`.
That makes the route catalog and the public route list diverge: catalog-only
recommended routes, such as `historic-jordan`, are searchable data but do not
appear in the public route gallery.

The word "featured" is also overloaded:

- it means "recommended route" in some UI copy;
- it means "has a rich editorial page" in route-page code;
- it controls whether snapshot files are generated;
- it is used as the URL namespace.

The route-search feature is not published yet, so this is the right point to
rename the concepts and URLs for the long term.

## Goals

- Make the promoted route catalog the single source of truth for all public
  recommended routes.
- Give every catalog entry a public discovery surface.
- Keep rich route-story pages optional. A route can be recommended without
  having video, long editorial copy, POI stories, or a custom JSX module.
- Prefer the new canonical URL namespace `/routes`.
- Keep existing rich route pages working during the transition.
- Preserve the lean public page architecture: route index pages should not load
  planner-only routing assets, and route detail pages should prefer generated
  read-only snapshots over client-side route decoding.

## Non-Goals

- Do not design a new route-authoring workflow in this topic. The editor can
  continue storing route tokens in the route catalog.
- Do not change the map network, route encoding, or routing algorithm.
- Do not require every recommended route to have video or a custom route story.
- Do not publish route discovery by flipping `routeDiscovery`; this topic is
  about route catalog pages and naming.

## Terminology

**Route catalog**

The promoted JSON data file at `public-data/route-catalog.json`. It contains
all public recommended routes and their route token, display metadata, and
computed classification fields.

**Recommended route**

Any public route catalog entry. Recommended routes are listed on `/routes`,
can be opened in the planner via `/?route=<token>`, and may have a detail page.

**Route story**

Optional rich content for a recommended route: video, POI story list, gallery,
custom article copy, and custom page layout. Current files under `src/featured/`
are route stories.

**Route snapshot**

A generated, read-only snapshot of a route's geometry, bounds, stats, and active
POIs. Snapshots let public route detail pages render maps without downloading
the full planner and routing engine.

**Featured**

Retired as a product concept. Existing code may keep transitional names during
implementation, but public UI and future schema should use "recommended route"
and "route story".

## URL Design

Canonical URLs:

```text
/routes
/routes/:slug
```

`/routes` is the public list of all recommended routes from the promoted route
catalog.

`/routes/:slug` is the public route detail URL for a catalog entry:

- if a route story module exists for the slug, render the rich story;
- otherwise render a generic route detail page from catalog metadata and the
  generated route snapshot.

Temporary compatibility:

```text
/featured
/featured/:slug
```

Because this feature is not published yet, the implementation may either remove
these routes or keep them as aliases while tests are migrated. The recommended
path is to keep them as aliases for one development cycle:

- `/featured` redirects or renders the same component as `/routes`;
- `/featured/:slug` redirects or renders the same component as `/routes/:slug`;
- all visible links point to `/routes`.

## Catalog Schema Direction

The catalog remains the source of recommended routes. The `featured` boolean
should be replaced by explicit optional story metadata.

Current shape:

```json
{
  "slug": "sovev-beit-hillel",
  "name": "סובב בית הלל",
  "summary": "...",
  "route": "...",
  "featured": true
}
```

Target shape:

```json
{
  "slug": "sovev-beit-hillel",
  "name": "סובב בית הלל",
  "summary": "...",
  "description": "...",
  "route": "...",
  "heroImage": {
    "photo": "public-data/poi-images/...",
    "thumbnail": "public-data/poi-images/...",
    "alt": "..."
  },
  "story": {
    "enabled": true,
    "kind": "video"
  }
}
```

Catalog entries without `story.enabled` are still recommended and public. They
use the generic route detail page.

For an incremental rollout, code can support both:

- `entry.story?.enabled === true`
- legacy `entry.featured === true`

The editor can migrate the label from "Featured" to "Route story" after the
public route pages are stable.

Optional future fields:

- `sortOrder`: explicit editorial order on `/routes`.
- `audience`: family, scenic, sporty, etc. Existing `style` can carry this for
  now.
- `season`, `duration`, `startLocation`: useful filters once the route list
  grows.

## Route Content Requirements

The catalog should distinguish hard publish requirements from richer optional
content. This lets maintainers add many recommended routes without blocking on a
video or fully written article.

Required for every published recommended route:

- `slug`: stable kebab-case identifier.
- `name`: public Hebrew route name.
- `summary`: one-sentence card copy.
- `route`: encoded route token.
- computed fields from promote/recompute: `distanceKm`, `elevationGainM`,
  `elevationLossM`, `regionId`, `passesNear`, `difficulty`, `style`, `roadMix`,
  and `qualityScore`.

Strongly recommended for every route:

- `description`: 1-3 paragraphs for the generic detail page. This is longer than
  `summary` and should describe the ride, terrain, access, and who it suits.
- `heroImage`: representative image for the catalog card and detail header.
- `start`: authored start point with name, description, and image.
- `end`: authored end point when the route is not cyclic.
- `notes`: internal/editor-only notes.

Optional route-story content:

- `story.enabled`: true when the slug has a custom route-story page.
- `story.kind`: `video`, `article`, or another future route-story type.
- route video metadata under `public-data/route-videos`.
- custom JSX/article modules for rich story pages.

The editor should allow routes to exist in draft form before all strongly
recommended fields are filled, but promote should surface warnings for missing
`description`, missing representative image, and missing start details. Promote
should only block on the hard required fields and a decodable route token.

## Representative Images

Every route card should have a useful representative image. The data model should
support an explicit route-level image, but the app can derive a fallback from
existing route content so maintainers do not have to upload a new image for every
route immediately.

Resolution order:

1. `entry.heroImage.thumbnail || entry.heroImage.photo`.
2. `entry.start.images[0].thumbnail || entry.start.images[0].photo`.
3. `entry.end.images[0].thumbnail || entry.end.images[0].photo`.
4. First gallery-capable active route POI image from the route snapshot, ordered
   by route progress.
5. First image from any segment POI on selected route segments if the snapshot
   has no active image-backed POI.
6. A neutral generated/default route placeholder.

The fallback image should be resolved during snapshot/catalog recompute where
possible, then stored as a derived `displayImage` field in the public catalog or
snapshot. Runtime pages can still recompute the fallback defensively, but should
not need to download the full segment dataset just to find a card image.

`heroImage` uses the same shape as POI images:

```json
{
  "photo": "public-data/poi-images/route-slug-1234abcd.webp",
  "thumbnail": "public-data/poi-images/route-slug-1234abcd-thumb.webp",
  "alt": "רוכבים ליד הירדן"
}
```

The route-level image is for presentation. It does not create a map POI unless
the maintainer also adds it as a route start/end image or segment POI.

## Data Flow

1. The editor maintains a draft catalog.
2. Promote writes `public-data/route-catalog.json`.
3. Promote or build decodes every public catalog route and writes a route
   snapshot.
4. `/routes` fetches only the catalog, plus small reference files such as
   `data/places.json` when place names are needed.
5. `/routes/:slug` fetches the catalog entry and its route snapshot.
6. If the slug has a route story module, the route detail page renders the rich
   story shell using the same snapshot.
7. If no story module exists, the route detail page renders a generic detail
   page using the catalog metadata and snapshot.
8. The planner remains the route-editing surface. Public route pages link to
   `/?route=<entry.route>` for "open in map".

## Snapshot Path

Current featured snapshots live under:

```text
public-data/featured-routes/<slug>.json
```

The long-term route-catalog name should be:

```text
public-data/route-snapshots/<slug>.json
```

The snapshot schema can stay the same initially. The important behavior change
is that snapshots are generated for every public catalog entry, not only entries
marked as `featured`.

During migration, the loader can support both paths:

1. try `public-data/route-snapshots/<slug>.json`;
2. fall back to `public-data/featured-routes/<slug>.json` for existing files.

## Public Index Presentation

`/routes` should be an operational route list, not a marketing landing page.
The first screen should show the list and filters.

The route list should feel like a useful route-finding tool:

- full-width page under the normal site shell, with a constrained content width;
- compact header with title, one short explanatory line, and route count;
- sticky or top-positioned filter row on desktop when useful;
- responsive card grid on desktop and a single-column list on mobile;
- no separate hero section before the route list.

Each card should show:

- representative image;
- route name;
- summary;
- distance;
- elevation gain/loss;
- difficulty;
- surface mix when available;
- nearby places when available;
- optional badges such as "וידאו" or "כתבה" only when a route story exists;
- primary action: open the route in the planner map;
- secondary action: route details.

Card layout:

- image on top or inline left depending on viewport;
- title and summary grouped together;
- stats row uses short, scannable labels;
- badges are factual (`וידאו`, `כתבה`, `מעגלי`) rather than promotional;
- actions are at the bottom and remain visible without shifting layout.

Detail pages should reuse the same image and stats language so the route list and
the route page feel like one system.

All recommended routes appear in the same list. Routes with videos should not
dominate the page unless explicit sort order says so.

Suggested ordering:

1. `sortOrder` ascending, when present;
2. story-enabled routes before generic routes only if no explicit order exists;
3. `qualityScore` descending;
4. distance ascending as a stable final tie-breaker.

Suggested filters:

- place search using `passesNear` and `data/places.json`;
- distance bucket;
- difficulty;
- style/audience;
- route-story only toggle, if useful later.

The existing `catalogFilter` logic can be reused, but it should move out of
`WelcomeDiscover`-specific naming into shared route-catalog utilities.

## Route Detail Presentation

Every catalog entry should have `/routes/:slug`.

Generic route detail page:

- header with name, summary, distance, elevation, difficulty, and nearby places;
- read-only map from the route snapshot;
- start/end point panels when authored;
- route warnings/POIs when present in the snapshot;
- actions: open in planner, download GPX if available from snapshot geometry.

Route story page:

- uses the existing rich page components and route-story JSX;
- reads route metadata from the catalog;
- reads route geometry from the same route snapshot path as generic pages;
- may include video, POI stories, gallery, custom intro/about copy.

## Route Catalog Editor Experience

The current Route Catalog editor is a raw detail form. It should become a
dedicated authoring workspace, closer to the Video Sync mode: clear mode chrome,
route selection, draft status, preview, validation, and explicit save/promote
actions.

Recommended layout:

- left rail: searchable route list with badges for draft/published/story/missing
  image/missing description;
- main panel: tabbed editor for the selected route;
- right or lower preview panel: route card preview and basic decoded route
  status;
- sticky action bar: Save Draft, Recompute, Preview, Promote.

Tabs:

- **Basics:** slug, public name, summary, long description, internal notes,
  sort order.
- **Route:** route token/full share URL input, paste-from-URL extraction, decode
  status, computed distance/elevation/difficulty, open-in-planner link.
- **Images:** route-level representative image upload, image preview, choose
  fallback from route POI/start/end images, alt text.
- **Start/End:** existing start/end name, description, and image upload fields.
- **Classification:** computed nearby places, region, style, difficulty, surface
  mix; editor can override only future explicitly supported fields.
- **Story:** route-story enabled/kind, video-sync presence, route-story module
  presence, and links into Video Sync for story routes.
- **Publish:** validation checklist and publish readiness.

Validation should be visible, not just returned by the promote endpoint:

- blocking: invalid slug, duplicate slug, missing name, missing summary, missing
  route token, undecodable route token;
- warning: missing long description, missing representative image, missing start
  point, route story enabled but no story module, route story enabled but no
  snapshot/video assets where expected.

The editor should preserve the current draft/promote model:

- load draft if present, otherwise promoted catalog;
- Save Draft writes `editor/.drafts/route-catalog.json`;
- Recompute decodes route tokens and refreshes computed metadata;
- Promote writes `public-data/route-catalog.json`, rebuilds route snapshots, and
  clears the draft.

The image upload pipeline should reuse `POST /api/poi-image` and
`public-data/poi-images`, but the route catalog UI should manage image lists
instead of asking maintainers to type paths.

## Module and File Naming

New code should use route-catalog naming:

```text
src/pages/RoutesIndexPage.jsx
src/pages/RouteDetailPage.jsx
src/routes/index.js
src/components/routes/RouteCatalogCard.jsx
src/components/routes/routes.css
packages/core/src/data/routeCatalog.js
packages/core/src/data/routeSnapshots.js
```

Existing files can be kept temporarily:

```text
src/featured/*
src/components/featured/*
packages/core/src/data/featuredRouteSnapshots.js
scripts/lib/featuredRouteSnapshotBuilder.mjs
```

The implementation should avoid a large mechanical rename until behavior is
stable. Public URLs and user-facing copy matter more than internal file names in
the first pass.

## Build and Static Shells

The static shell generator currently creates `/featured/<slug>` shells for
featured entries. It should create `/routes/<slug>` shells for all catalog
entries.

If compatibility aliases are kept, it can also create `/featured/<slug>` shells
for story-enabled legacy routes, but new links should point to `/routes`.

## Open Questions

- Should generic `/routes/:slug` pages show a map immediately in the first
  implementation, or should they initially be metadata-only with an "open in
  planner" action?
- Should `story.enabled` be user-editable in the route catalog editor, or should
  it be inferred from the presence of a route-story module?
- Should route story modules stay as JSX forever, or should more story content
  move into catalog/editor-managed JSON over time?
- What is the Hebrew public title: `מסלולים מומלצים`, `מאגר מסלולים`, or
  another product phrase?

## Decision

Adopt `/routes` as the canonical public route catalog. List every promoted
catalog entry. Treat rich route-story content as optional metadata layered on top
of the catalog, not as the definition of which routes are public.
