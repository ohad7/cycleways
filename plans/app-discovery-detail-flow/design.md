# iPhone App — Discovery & Route-Detail Flow

Date: 2026-06-30

## Goal

Reshape the iPhone app's front-of-app experience around **route discovery**,
not map-building. Today the app opens on a single full-screen map with a bottom
sheet that toggles Discover/Build, and tapping a route drops you straight into
the build planner over the map. We want:

1. A **map-free discovery front page** focused on browsing routes.
2. **Richer discovery cards** (large media, swipeable photo/POI gallery, a video
   poster when the route has a video).
3. Tapping a route opens a **native route-detail page** mirroring the polished
   mobile-web featured page (synced video + swappable map PiP, POI stories,
   elevation) — *not* a jump straight into editing.
4. Building from scratch and editing a route both happen on the existing map
   UI, reached only by an explicit action.

Turn-by-turn navigation is **out of scope** for this design (a separate, later
topic). It remains a sub-mode inside the build/map screen, untouched.

## Context

- App: `apps/mobile` — React Native / Expo, `@rnmapbox/maps`, sharing
  `@cycleways/core` for data + route logic. It does **not** render web DOM/CSS.
- Everything currently lives inside one screen, `src/MapScreen.jsx`: the map,
  the Discover/Build bottom sheet (`PlannerSheet` + `DiscoverPanel` +
  `RouteCard`), the planner, playback, and turn-by-turn navigation. The shared
  controller `useCyclewaysApp` is instantiated there.
- `App.js` renders a single `MapScreen` and resolves deep links
  (`cycleways://routes/<slug>`) by pre-seeding a native location href that
  `MapScreen` reads.
- There are **8 catalog routes** (`public-data/route-catalog.json`). Each entry
  has: `name`, `summary`, `description`/`notes`, `distanceKm`,
  `elevationGainM/LossM`, `difficulty`, `routeShape`, `surfaceType`,
  `heroImage`, `routeMapImage`, `start` (name/description/images),
  `passesNear`/`placeMatches`, and the encoded `route` token. POIs come from
  data markers along the route. Only the hand-authored featured routes
  (`sovev-beit-hillel`, `banias-gan-hatsafon`) have video.
- The mobile-web featured page (`src/pages/FeaturedRoutePage.jsx`,
  `src/components/featured/*`) is React DOM + CSS: `mapbox-gl-js`, a YouTube
  **iframe**, and a video↔route sync engine. The companion design
  `plans/featured-mobile-layout/design.md` already concluded that this layout
  **cannot be shared at the component level** with RN — only data, sync logic,
  and design intent are reusable — and pre-decided a **native reimplementation**
  ("Option B"), deferred until a discovery path into featured routes existed in
  the app. This design is that discovery path; we now build the deferred native
  screen.

### What is reusable web → native

| Layer | Reuse |
|-------|-------|
| Catalog data, copy, route geometry, POIs, places | Yes — `@cycleways/core` + `public-data` |
| Discovery filtering / near-me ordering | Yes — `selectDiscoverRoutes`, `sortByDistanceFromUser` (already used by the app) |
| Video↔route sync math (`videoSync`, `playbackRamp`, `routeVideoIndex`) | Yes, after relocating these from `src/components/featured/` into `@cycleways/core` |
| Component UI (DOM + CSS) | **No** — rebuilt natively |
| YouTube playback | Only via the iframe API — the *video element* uses a small WebView-backed player; everything around it is native |

## Decisions

- **Architecture: a real screen stack** via `@react-navigation/native` +
  `native-stack`, replacing the single-`MapScreen` model. (Chosen over a manual
  `App.js` state machine, which would hand-roll the back stack, Android back,
  transitions, and deep-link routing.)
- **Detail page: a native port** mirroring the mobile-web featured layout
  (Option B), reusing core data + relocated sync logic — not a WebView of the
  whole page.
- **Synced video: full fidelity**, matching mobile web, including the
  **swappable video/map PiP** behavior.
- **Phased delivery**, each phase its own implementation plan (see Phasing).

## Architecture — screen stack & state

Three stack screens (RTL-aware):

- **`Discover`** (initial route, no map) — the discovery front page.
- **`RouteDetail`** (`{ slug }`) — the native featured page.
- **`Build`** — today's `MapScreen` UI, essentially intact, now a stack route.
  Accepts an optional `{ routeToken, slug }` param. Turn-by-turn navigation
  stays a sub-mode inside `Build`.

State & data flow:

- `useCyclewaysApp` (the heavy controller) moves **into the `Build` screen
  only**; it no longer wraps Discover. `Discover` and `RouteDetail` load catalog
  data themselves (`loadRouteCatalogEntries`, `getJsonAsset` — the same calls
  the app already makes).
- Selecting a route passes its `slug` to `RouteDetail`. "פתח לעריכה" navigates
  to `Build` with the route's encoded `route` token, loaded through the existing
  `handleLoadRouteParam` path (the same path used today and by deep links). The
  FAB opens `Build` with no param (empty planner).
- **Deep links** move to react-navigation's `linking` config:
  `cycleways://routes/:slug` → `RouteDetail`. This replaces the
  `resolveNativeLaunchUrl` logic currently in `App.js`; the "route not found"
  error surface is preserved.
- The map mounts **only** on `Build`, so the front page is genuinely map-free
  and the map unmounts when leaving Build (a real perf win, and the literal
  fulfillment of "remove the map from the front page").

## Discovery front page

Full-screen `Discover` (no map behind it):

- **Top row:** a lightweight title + search field. Search here **filters the
  catalog list** by route name / nearby-place name. It does **not** geocode —
  geocoding/address search stays in `Build`'s `TopSearch`.
- **Collapsible filters:** collapsed by default to a single "סינון" button
  showing an active-filter count; expanding reveals the existing chip groups
  (`FILTER_GROUPS`) + "קרוב אליי". The result count ("N מסלולים") stays visible.
  Filtering and ordering keep using the shared core helpers unchanged.
- **Rich media cards:** each route renders a large card with a **horizontally
  swipeable gallery** — a video poster-with-play-badge first *when the route has
  a video*, then hero image, route-map image, start photos, and POI photos —
  plus title, difficulty chip, `distance · shape · via place` meta, and the
  near-me distance when a location fix is available. Tapping the card opens
  `RouteDetail`. The list scrolls vertically; each card's gallery scrolls
  horizontally.
- **FAB "תכנן מסלול":** a persistent floating button → `Build` with no route
  (empty planner).

Card video preview: the card's first gallery item is the **video poster + play
badge** (not an autoplaying clip — true autoplay in a scrolling list is heavy);
the real synced video plays on the detail page. A short muted looping preview on
the card is a possible later enhancement, not part of this design.

## Native route-detail page

A native `RouteDetail` screen mirroring the mobile-web featured layout
(`plans/featured-mobile-layout/design.md` content order), single-column, RTL:

1. **Header** — kicker (region · "מסלול מומלץ"), title, and a clean horizontal
   stats row (distance · elevation gain/loss · difficulty · surface) from
   catalog data, via the existing `createGenericRouteStoryProps`.
2. **Primary media stage:**
   - **When the route has a video:** the **video is primary** and the **map is a
     small corner PiP window**, with a transient on-video POI preview overlay —
     reproducing `FeaturedVideoRoute`'s mobile composition. The PiP is
     **swappable**: tapping it makes the **map primary** and shrinks the video
     into the corner PiP (the "map-primary" ↔ "video-primary" layouts). Playing
     the video drives a cursor along the route on the map and the elevation
     profile; scrubbing the video scrubs the map. Same behavior as mobile web.
   - **When the route has no video:** the **map is the primary stage** (no PiP),
     interactive, with a "נגן מסלול" action that animates the route cursor.
   - The map reuses the app's existing route/network/marker rendering from
     `MapScreen` (route line, POI markers, video cursor).
3. **Route blurb + "על המסלול"** — `summary` / `description` / `intro`.
4. **POI story list** — native cards mirroring `RoutePoiStoryList` (lead photo,
   "תחנה N · distance" kicker, copy), built from the route's data markers.
5. **Elevation** — reuse the app's existing `ElevationProfileChart`.
6. **CTA "פתח לעריכה"** → `Build` with the route token. (Plus the web page's
   secondary actions as appropriate, e.g. download GPX.)

### Shared-logic relocation (web ↔ native)

Move `videoSync.js`, `playbackRamp.js`, and `routeVideoIndex.js` from
`src/components/featured/` into `@cycleways/core` so the web featured page and
the native detail screen import one copy. The web page keeps working against the
relocated modules — an import-path change only, no behavior change.

### YouTube playback caveat (explicit)

YouTube has no native player; even a native screen must play the video through
the iframe API. So the **video element itself** uses a small WebView-backed
component (`react-native-youtube-iframe`). This is only the player surface — the
rejected approach was wrapping the *whole page* in a WebView. Layout, map, POIs,
elevation, and the sync math are all native. Sync works because the player
component exposes its current time, which feeds the relocated `videoSync` to
position the map/elevation cursor.

## Phasing

Each phase is its own implementation plan.

- **Phase A — Stack + map-free discovery.** Introduce the navigation stack;
  refactor `MapScreen` into the `Build` route (lifting `useCyclewaysApp` into it
  and removing the Discover panel / front-map default); build the `Discover`
  screen (filtered list, collapsible filters, FAB); move deep-linking to the
  react-navigation `linking` config. Cards can stay close to today's
  `RouteCard` initially.
- **Phase B — Rich media discovery cards.** The large swipeable-gallery card
  with video poster.
- **Phase C — Native route-detail page.** The featured screen incl. swappable
  video/map PiP and full synced playback; relocate the sync modules into core.
  Depends on Phase A.

## Testing

- Unit-test the relocated `videoSync` / `playbackRamp` / `routeVideoIndex` in
  core (pure logic).
- Discovery filtering/ordering already lives in tested core helpers
  (`selectDiscoverRoutes`, `sortByDistanceFromUser`).
- Regression-check the mobile-web featured page after the import-path move (it
  must not change behavior).
- Native screens get manual device verification (the app's established
  practice), plus any smoke-test updates.

## Risks / watch-items

- `react-native-youtube-iframe` pulls in `react-native-webview` — a native dep
  requiring a dev-client rebuild (already using `expo run:ios`, so fine).
- The `Build` refactor must preserve the deep-link "open route" launch path when
  lifting `useCyclewaysApp` out of the shared mega-screen.
- Offline: detail photos and the map are bundled, but **YouTube playback needs
  connectivity** — acceptable, since video is enrichment, not navigation.

## Non-goals

- No changes to turn-by-turn navigation (separate, later topic).
- No changes to editor/pipeline-owned data files (`data/`, `public-data/`).
- No new route content or video; we surface existing catalog data.
- No autoplaying video previews in the discovery list (poster + play badge
  only).
