# Website Growth Roadmap — Design

**Date:** 2026-07-09  
**Status:** Recommended website-first roadmap; not yet scheduled  
**Related:** `recommended-routes/`, `featured-routes/`,
`route-map-thumbnails/`, `discovery-surface/`, `planning-surface/`,
`segment-scores/`, `navigation-handoff/`

## Purpose

Define the next product investments for the public CycleWays website while the
native app is not yet in production. The roadmap is based on a review of all 94
topics under `plans/`, their implementation records, and the current promoted
route catalog.

The website already has substantial interaction depth: a unified route catalog,
Discover and Build surfaces, mobile bottom-sheet behavior, route stories,
synthetic and video playback, map snapshots, compact sharing, local draft
retention, rich-text descriptions, and loading feedback. The next investments
should therefore improve acquisition, decision confidence, and ride preparation
instead of adding another playback or navigation treatment.

## Product posture

Until the app is in production:

- Mobile web remains the acquisition, discovery, and route-consumption surface.
- Desktop web remains the strongest planning surface.
- The website must stay self-sufficient: route details, GPX, sharing, printing,
  and mobile Build cannot depend on an installed app.
- Continuous navigation, recording, app-install promotion, and universal-link
  calls to action remain out of scope.
- Accounts and backend route synchronization are not required for this roadmap.

This follows the surface-role decisions in `discovery-surface/`,
`planning-surface/`, and `navigation-handoff/`.

## Current-state findings

### Existing strengths

- `/routes` is the canonical catalog and every entry can have a detail page.
- Discover supports filters, map previews, near-me ranking, and route-page calls
  to action.
- The planner supports local drafts, recents, QR handoff, GPX, sharing, route
  playback, elevation, POIs, and warnings.
- Route-story pages support video, synthetic map playback, galleries, rich text,
  POIs, route endpoints, and generated map images.
- The editor already has a promoted catalog workflow and substantial route/POI
  authoring infrastructure.

### Gaps that now limit the website

1. The promoted catalog has only eight routes and inconsistent decision-making
   metadata. Four entries have a catalog `description`, six have authored
   `start` details, and none has `season` or `duration`.
2. Route pages are SPA-only. Per-route Open Graph metadata and build-time
   prerendering were explicitly deferred by `featured-routes/`.
3. Warnings and internal quality data exist, but there is no public lifecycle
   for route freshness, temporary closure, or route-specific problem reports.
4. Recents are passive. Riders cannot deliberately save a shortlist or compare
   candidate routes side by side.
5. The pre-app website offers GPX and a live page but no compact printable ride
   brief for preparation or group sharing.
6. Production `index.html` loads Google Analytics while the privacy page says
   that the website has no analytics. This contradiction must be resolved before
   increasing acquisition traffic.

## Prioritization principles

The roadmap is ordered by:

1. Value to a rider choosing and preparing a ride.
2. Independence from the unreleased native app.
3. Reuse of existing catalog, editor, snapshot, map, elevation, sharing, and
   local-storage infrastructure.
4. Ability to ship in small, testable slices.
5. Avoidance of a backend until a feature clearly requires one.

## Priority 1 — Decision-ready route catalog

### Goal

Make every published route answer the practical questions a rider needs before
choosing it, and then expand the catalog without lowering content quality.

### Catalog additions

Add a conservative first set of structured fields:

- `durationMinutes`: estimated moving time or a documented duration range.
- `season`: one or more controlled values, not free-form labels.
- `routeType`: `circular` or `one-way`.
- `audience`: controlled values such as `family`, `scenic`, `sporty`, and
  `adventurous`; reuse or migrate the existing `style` field rather than keeping
  duplicate concepts indefinitely.
- `startAccess`: short public information about parking, arrival, or access.
- Existing computed `roadMix`, `difficulty`, distance, elevation, and quality
  remain the source for objective route statistics.

Do not add a large lifestyle taxonomy in the first slice. Water, shade, public
transport, services, and similar fields should be represented by existing POIs
or added later only when the content can be maintained consistently.

### Public behavior

- Route cards show duration, route type, and a compact audience label.
- Route pages show season and start-access information near the main decision
  block, not buried in narrative copy.
- `/routes` gains duration, season, route-type, and audience filters only after
  the corresponding field has useful coverage.
- Missing optional data is omitted cleanly; it never renders as an empty chip or
  unknown-looking value.

### Authoring and promotion

- Existing promoted routes receive a one-time completeness pass.
- Promotion blocks on stable identity, route token, name, summary, and valid
  computed route data, matching the existing catalog contract.
- Promotion warns on missing description, image, start details, duration,
  season, route type, or audience.
- A readiness summary shows maintainers exactly which public fields are missing.

### Success criteria

- All promoted routes have description, representative image, start details,
  duration, season, route type, and audience.
- Filters never produce misleading empty categories.
- Adding a new complete route requires no source-code change.

## Priority 2 — Search and social acquisition

### Goal

Make route pages useful before JavaScript executes and make shared route links
look like real route recommendations rather than generic site links.

### Build-time output

Generate static HTML shells for `/routes` and every promoted `/routes/:slug`
path during the existing Vite build. Each route output includes:

- A unique `<title>` and meta description.
- Canonical URL.
- Open Graph and social-card title, description, URL, and image.
- Indexable route name, summary, core statistics, and description.
- Appropriate structured data chosen during implementation and covered by a
  fixture test.
- Normal SPA hydration so the existing interactive route page takes over.

The social image should prefer `routeMapImage`, then the existing public image
fallback. No new screenshot service is needed.

### Indexing and internal discovery

- Keep `sitemap.xml` synchronized with all promoted route paths.
- Ensure canonical links point to `/routes/:slug`, including legacy featured
  aliases.
- Add meaningful internal links between the catalog, relevant routes, and
  region/place pages.
- Add regional landing pages only after a region has enough routes to avoid thin
  pages; the initial threshold should be at least three promoted routes.

### Success criteria

- Built route HTML contains route-specific content and metadata without running
  JavaScript.
- Link-preview validators receive a route-specific title, description, and
  image.
- Every promoted route appears in the sitemap and has one canonical URL.

## Priority 3 — Route freshness and reporting

### Goal

Give riders an honest signal about how recently a route was checked and make
temporary problems visible without turning the site into a social network.

### Data model

Add an optional catalog status object:

```json
{
  "status": {
    "level": "open",
    "message": "",
    "verifiedAt": "2026-07-09",
    "validUntil": null
  }
}
```

Allowed levels are `open`, `caution`, and `closed`.

- `verifiedAt` states when the route information was last editorially checked.
- `message` is required for `caution` and `closed`.
- `validUntil` lets temporary notices expire from prominent display while
  remaining available for editor review.
- An expired notice must not silently continue to claim that a route is closed;
  it becomes an editor warning until reconfirmed.

### Public behavior

- A current caution or closure appears on the catalog card and route page.
- The route page shows a modest “last checked” line even when open.
- GPX and print actions keep working during a caution, but a closure requires an
  explicit acknowledgement before download.
- Add a contextual “report a problem” action that opens the existing feedback
  channel with the route slug and page URL prefilled.

### Editorial behavior

- The editor can update status, message, verification date, and expiry.
- The catalog readiness view highlights expired and long-unverified statuses.
- Reports are private feedback, not public comments, ratings, or crowdsourced
  route truth.
- Internal segment quality remains internal until its data coverage is reliable;
  editorial status and segment quality are separate concepts.

### Success criteria

- Every promoted route shows a verification date.
- Current cautions and closures are consistent across cards and detail pages.
- Reports identify the route without requiring the rider to copy technical IDs.

## Priority 4 — Saved shortlist and comparison

### Goal

Support the natural loop of considering several rides, leaving, returning, and
choosing one—without requiring an account.

### Saved routes

- Add an explicit save control to catalog cards and route pages.
- Store saved slugs in versioned local storage, separate from passive recents.
- Add a `/saved` page or equivalent catalog view.
- Saved entries always resolve against the current catalog so stale names,
  images, and statistics are not duplicated in storage.
- A missing or retired slug is removed gracefully with a short explanation.

### Comparison

- Allow selecting two or three saved/catalog routes for comparison.
- Compare distance, elevation gain, duration, difficulty, surface/road mix,
  route type, audience, season, and start area.
- Draw compared routes together on the existing map with the shared Discover
  route-color system.
- Keep the comparison URL shareable by slug list if it remains reasonably short;
  otherwise keep comparison local in the first version.

### Non-goals

- Accounts, cloud sync, collaborative lists, public profiles, likes, or social
  feeds.
- Copying full route snapshots into local storage.

### Success criteria

- A saved route survives reload and browser restart.
- Recents and explicit saves remain visibly distinct.
- Comparison is usable on desktop and readable on mobile without a wide table.

## Priority 5 — Printable ride brief

### Goal

Provide a useful pre-ride artifact while the native app is unavailable, without
claiming to provide browser turn-by-turn navigation.

### First version

Build a print-first HTML view and print stylesheet rather than introducing a
server-side PDF generator. Browser “Save as PDF” is sufficient initially.

The brief contains:

- Route name, summary, date printed, and current route status.
- Generated route-map image.
- Distance, elevation, duration, difficulty, route type, and surface/road mix.
- Elevation profile.
- Start details and access information.
- Important POIs and warnings in route order.
- QR code to the canonical live route page.
- GPX download action in the screen view; it may be represented as a URL/QR in
  print.

### Guardrails

- Label the artifact as a route brief/preview, not navigation instructions.
- Do not generate turn cues from incomplete web data.
- Avoid loading the full interactive map in print mode; use the existing static
  map image.
- Hide video players, playback controls, app promotion, and editor-only content.

### Success criteria

- The brief prints cleanly on A4 in Hebrew/RTL without clipped content.
- It remains useful when opened from a saved PDF without JavaScript.
- Status, warnings, and route metadata match the public route page.

## Cross-cutting requirements

### Privacy consistency

Before growth work ships, reconcile production analytics behavior with the
published privacy statement. The default decision for this roadmap is to honor
the current “no analytics” promise and remove/disable the production Google
Analytics loader. Reintroducing analytics later requires an explicit product and
privacy decision rather than an incidental script change.

### Accessibility

- All new actions work by keyboard and expose meaningful accessible names.
- Saved/compare state is not communicated by color alone.
- Status messages use text and icons, not color alone.
- Print and prerendered content preserve semantic headings and link text.
- Motion is not required to understand comparison or route information.

### Performance

- Catalog cards continue to use thumbnails and lazy loading.
- Prerendering must not bundle full route geometry into every index page.
- Print views use static route images and avoid Mapbox initialization.
- New filters and saved-route state remain client-local and lightweight.

### RTL and language

- Hebrew/RTL is the primary layout contract.
- English metadata can be added later, but this roadmap does not introduce a
  multi-language routing system.

## Recommended sequence

1. Resolve analytics/privacy consistency and establish baseline checks.
2. Complete catalog metadata and public presentation.
3. Add prerendered route HTML and social metadata.
4. Add freshness/status and contextual reporting.
5. Add saved routes and comparison.
6. Add the printable ride brief.

Catalog completeness comes first because every later feature—metadata, status,
comparison, and printing—depends on trustworthy route content.

## Explicit non-goals

- Native-app installation banners or “open in app” calls to action before the
  app is in production.
- Continuous GPS navigation in the browser.
- User accounts, cloud sync, public comments, ratings, or social profiles.
- Another video crop, playback animation, or map-layout experiment.
- A new backend solely to support this roadmap.
- Replacing GPX; GPX remains a permanent output.

