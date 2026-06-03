# Route Search Design

## Goal

Help a visitor — especially one who doesn't already know the network — find a
route that fits what they want to ride. A short button-driven conversation
("מאיפה תרצו להתחיל? כמה ק״מ? רמת קושי?") replaces the cold-start problem
of "open the map and figure it out yourself." Picks land in the existing
planner with a route already drawn.

The feature should:

- present a guided wizard (button choices only, no typing) as the welcoming
  front door of the site for first-time visitors;
- let returning visitors and power users skip straight to the map;
- run entirely client-side — no server backend, no LLM;
- match against a curated catalog of routes that doubles as the registry for
  promoted "featured" routes — one list, one editor surface;
- compute classification metadata (difficulty, style, region, distance,
  passes-near places) on the editor side at promote time, not at runtime, so
  the wizard is just filter + sort.

## Current Shape

After the work that landed on this branch:

- `/featured/:slug` routes render via react-router using
  `src/featured/<slug>.jsx` + `<slug>.meta.js`. Each `.meta.js` carries the
  route encoding plus a handful of fields (slug, name, summary, route, hero,
  difficulty, tags). Two featured routes exist:
  `sovev-beit-hillel` and `shdeh-nehemia-baniyas`.
- A "המומלצים שלנו" section in `ContentSections.jsx` hardcodes 5 named
  *segments* (not routes) with rich Hebrew descriptions and a click-to-focus
  hook. These are different from featured routes in granularity (single
  segment vs full ride).
- The editor at `editor/` has workspace modes (Segments / Base Graph /
  CW Overlay / Video Sync) added incrementally via `setWorkspaceMode` and a
  matching `renderWorkspaceChrome` pass. Each mode has its own panel and
  optionally its own promote endpoint that writes from
  `editor/.drafts/...` to `public-data/...`.
- The runtime route-decoding path (`restoreRouteFromParam`,
  `createRouteManager`) is already wired to run server-side in
  `editor/server.mjs` via `createRequire('route-manager.js')` — used by the
  video keyframes promote handler.
- A `/find` URL path does not exist; there is no client-side router fallback
  beyond the existing react-router routes.

## Product And Architecture Decision

**Unified catalog.** All findable routes — whether full landing pages or
not — live in a single editor-managed list:
`public-data/route-catalog.json`. An entry is "featured" if it has
`featured: true` and a matching `src/featured/<slug>.jsx` exists. The
existing `<slug>.meta.js` files are migrated into the catalog and deleted;
JSX modules now read meta from the loaded catalog by slug.

**Welcome wizard, not a separate page.** A `<WelcomeWizard>` overlay
mounted from `App.jsx` is shown on `/` when:

- there is no `?route=` parameter in the URL, AND
- `localStorage["cycleways:skipWelcome"]` is not `"1"`.

A dismiss sets the localStorage flag so returning users never see the
wizard again automatically. A "מצא מסלול" button in the existing `TopBar`
opens the wizard manually whenever the user wants it; the manual open does
not affect the localStorage flag. Direct `?route=` links never show the
wizard.

**Button-driven, no LLM.** The conversation uses multi-choice buttons only,
no typed input. State is a small pure reducer with five questions:
`place` → `region` (conditional) → `distance` → `difficulty` → `style`.

**Pre-computed catalog, runtime filter.** The editor's promote handler runs
each entry's route token through the existing `RouteManager` to compute
distance, elevation gain/loss, road-type mix, scenic-quality average,
region (by centroid in named polygons), `passesNear` (places within 500 m
of the polyline), and applies rule-based `difficulty` / `style`
classification. The runtime is a pure `catalogFilter(catalog, spec)`
function — hard filters on place/region, soft scoring on distance /
difficulty / style — returning the top 5 by score, ties broken by
quality.

**Editor-owned authoring surface.** A fifth workspace tab "Route Catalog"
mirrors the Video Sync pattern: list/edit UI, draft persistence, promote
to canonical, fallback to promoted file when draft absent. No hand-edited
JSON or YAML.

## File Structure

**New runtime files**

- `src/components/WelcomeWizard.jsx` — the overlay component.
- `src/components/WelcomeWizardChat.jsx` — the conversational sub-component
  (bot bubbles, option buttons, conversation history).
- `src/components/RouteCard.jsx` — single result card.
- `src/components/wizardReducer.js` — pure state machine.
- `src/components/catalogFilter.js` — pure filter + scoring + ranking.
- `src/data/catalog.js` — small helper to load `route-catalog.json`.

**Modified runtime files**

- `src/App.jsx` — mount `<WelcomeWizard>`, decide visibility from URL +
  localStorage.
- `src/components/TopBar.jsx` — add "מצא מסלול" button that opens the
  wizard manually.
- `src/components/featured/FeaturedRoute.jsx` — read meta from the loaded
  catalog (by slug) instead of from `meta` prop sourced from `.meta.js`.
- `src/featured/index.js` — enumerate featured entries from catalog where
  `featured === true`.
- `src/featured/sovev-beit-hillel.jsx`, `shdeh-nehemia-baniyas.jsx` —
  remove `export { meta }`, drop the `meta` argument to `<FeaturedRoute>`
  (component reads it from context).
- **Delete:** `src/featured/sovev-beit-hillel.meta.js`,
  `shdeh-nehemia-baniyas.meta.js`.

**New editor files (additions to existing modules)**

- `editor/index.html` — new `#route-catalog-panel` section + workspace
  tab button.
- `editor/editor.js` — register "route-catalog" workspace mode; list + detail
  UI; save / promote / recompute actions.
- `editor/server.mjs` — `validateCatalogDraft`, `classifyRoute`,
  `promoteCatalogDraft`, and the four endpoints.
- `editor/styles.css` — small styles for the new panel.

**New data files**

- `data/places.json` — named places `[{ id, name, lat, lng }]`. ~20–30
  entries initially. Hand-authored; will grow over time.
- `data/region-zones.json` — named regions `[{ id, name, polygon: [[lng,lat], …] }]`.
  ~5 zones initially.

**New public-data file (written by editor on promote)**

- `public-data/route-catalog.json` — the enriched catalog the runtime reads.

**Draft (editor-side, gitignored)**

- `editor/.drafts/route-catalog.json`

## Catalog Schema

### Authored fields (set in the editor)

```jsonc
{
  "slug": "sovev-beit-hillel",
  "name": "סובב בית הלל",
  "summary": "מסלול קצר ונעים מסביב לבית הלל",
  "route": "DvsVvkJ2…",          // encoded route token
  "notes": "...",                 // optional, not displayed
  "featured": true                // whether a src/featured/<slug>.jsx exists
}
```

### Computed fields (filled by `classifyRoute` on promote)

```jsonc
{
  "distanceKm": 8.4,
  "elevationGainM": 47,
  "elevationLossM": 47,
  "regionId": "hula-valley",
  "passesNear": ["beit-hillel", "dafna"],
  "difficulty": "easy",                          // "easy" | "moderate" | "hard"
  "style": "family",                             // "family" | "scenic" | "sporty" | "adventurous"
  "roadMix": { "paved": 0.62, "dirt": 0.31, "road": 0.07 },
  "qualityScore": 4.1
}
```

The published file is an array of entries with both authored and computed
fields merged.

### Classification rules

Encoded once in `editor/server.mjs::classifyRoute`. Single source of truth.

**Difficulty:**

| Difficulty  | Rule                                          |
|-------------|-----------------------------------------------|
| `easy`      | gain < 150 m AND distance < 25 km             |
| `moderate`  | gain 150–500 m, OR distance 25–40 km          |
| `hard`      | gain > 500 m OR distance > 40 km              |

**Style** (first match by priority — family > scenic > sporty > adventurous):

| Style          | Rule                                                                       |
|----------------|----------------------------------------------------------------------------|
| `family`       | difficulty=easy AND `roadMix.road` < 10% AND `qualityScore` ≥ 3            |
| `scenic`       | `qualityScore` ≥ 4                                                         |
| `sporty`       | difficulty=hard OR distance > 30 km                                        |
| `adventurous`  | `roadMix.dirt` ≥ 50%                                                       |

**Region** — point-in-polygon test of route centroid against the polygons
in `data/region-zones.json`. Falls back to `"unknown"` if no polygon contains
the centroid.

**Passes-near** — for each entry in `data/places.json`, true if any point on
the route's polyline is within `PASSES_NEAR_METERS` (default 500 m).

## Editor: "Route Catalog" Mode

### Workspace tab

Fifth tab next to Segments / Base Graph / CW Overlay / Video Sync. Wired via
the same `setWorkspaceMode("route-catalog")` extension we already use,
adding to `renderWorkspaceChrome`'s active-toggle + panel show/hide block.

### Panel layout

```
Route Catalog                                       [ + New entry ]

▢ סובב בית הלל            8.4 km · easy · family · ⭐featured
▢ שדה נחמיה → בניאס        12.1 km · easy · scenic
▢ בניאס שדה נחמיה          5.0 km  · easy · scenic
▢ ציר הנפט                15.4 km · hard · sporty

┌─ Detail (selected entry) ──────────────────────────────────┐
│ Slug:        [sovev-beit-hillel                       ]    │
│ Name:        [סובב בית הלל                            ]    │
│ Summary:     [מסלול קצר ונעים…                         ]    │
│ Route token: [DvsVvkJ2…       ] [Open in planner →]       │
│ Featured:    [ ☑ ]                                         │
│ Notes:       [                                         ]    │
│                                                             │
│ Computed:                                                   │
│   Distance: 8.4 km · Elevation gain: 47 m                  │
│   Region: hula-valley · Difficulty: easy · Style: family    │
│   Passes near: beit-hillel, dafna                           │
│   [ Recompute metadata ]                                    │
│                                                             │
│   [ Delete ]                  [ Save Draft ] [ Promote ]    │
└─────────────────────────────────────────────────────────────┘
```

### Server endpoints

All under `/api/route-catalog/…`. Parallel to the video-keyframes endpoints.

- `GET /draft` — returns the draft if present, else the promoted catalog
  (fallback so promoting doesn't appear to wipe data). On the very first
  load when neither exists, returns a seed catalog built from the existing
  `src/featured/*.meta.js` files (one-shot migration).
- `PUT /draft` — body is the full catalog JSON; persist to
  `editor/.drafts/route-catalog.json`.
- `POST /recompute` — body is the catalog draft; returns it with computed
  fields filled in. Does NOT write anywhere. Lets the editor show fresh
  tags before promoting.
- `POST /promote` — validate, recompute, write to
  `public-data/route-catalog.json` atomically, delete the draft.
- `GET /places` — returns `data/places.json` for the editor's UI display.

### Validation (used by `PUT /draft` and `POST /promote`)

- `slug` matches `^[a-z][a-z0-9-]*$`.
- `slug` is unique across all entries.
- `name` and `summary` non-empty.
- `route` decodes via `RouteManager.restoreFromPoints` — fail = reject.
- If `featured: true`, a `src/featured/<slug>.jsx` file should exist —
  warn (don't reject) when missing.

### One-shot migration

The first time the editor's GET draft endpoint is hit with no draft and no
promoted catalog on disk, the server reads `src/featured/*.meta.js`, builds
a seed catalog with `featured: true` for each, and returns it. The user
sees it pre-populated in the editor, can edit, and promotes. After
promote, the `.meta.js` files can be deleted (separate code commit; the JSX
modules are updated to read meta from the catalog).

## Runtime: `WelcomeWizard` Overlay

### Visibility rules

In `App.jsx`, on mount:

```js
const hasRouteParam = new URLSearchParams(window.location.search).has("route");
const skipFlag = localStorage.getItem("cycleways:skipWelcome") === "1";
const showWizard = !hasRouteParam && !skipFlag;
```

Plus a `manualOpen` state for the TopBar button — when manually opened,
the wizard appears regardless of the rules; closing it manually does not
need to set the flag (already set).

### Component tree

```
<WelcomeWizard visible={…} onDismiss={…} onPickRoute={…}>
  <header>
    "מצא מסלול"                                       [דלג למפה ✕]
  </header>
  <WelcomeWizardChat
    state={reducerState}
    dispatch={dispatch}
    catalog={catalog}
  />
</WelcomeWizard>
```

- `WelcomeWizard` owns the visibility, the localStorage write on dismiss,
  the `?route=` URL update on pick, and the conversation backdrop.
- `WelcomeWizardChat` is presentation only — receives reducer state and
  dispatches actions.
- `wizardReducer` is pure — no DOM, no fetch, no React.

### Reducer state

```js
{
  step: 0,
  answers: {
    place: null,       // place id or "any"
    region: null,      // region id or "any" — only set when place === "any"
    distance: null,    // "short" | "medium" | "long" | "any"
    difficulty: null,  // "easy" | "moderate" | "hard" | "any"
    style: null,       // "family" | "scenic" | "sporty" | "adventurous" | "any"
  }
}
```

Actions: `ANSWER` (advances step, with conditional skip if place !== "any"
to bypass the region question), `BACK` (decrement step, restoring the
prior question's view), `RESET` (back to step 0, clear answers).

### Catalog filtering

`catalogFilter(catalog, answers) → Route[]`:

- **Hard filter:** drop entries that fail `place` or `region` constraints
  (when not "any").
- **Soft score** for each remaining entry:
  - Distance: 3 if bucket matches, 1 if adjacent bucket, 0 otherwise.
  - Difficulty: 3 if matches, 1 if adjacent (easy↔moderate, moderate↔hard),
    0 otherwise.
  - Style: 3 if matches, 0 otherwise.
- Sort by total score descending; ties broken by `qualityScore` descending.
- Return top 5.

Distance buckets used for matching:

| Bucket    | Range       |
|-----------|-------------|
| `short`   | < 10 km     |
| `medium`  | 10–25 km    |
| `long`    | > 25 km     |

### Results & navigation

Each result is a `<RouteCard>`:

- Title (entry name), summary, distance / elevation / difficulty badges.
- "עובר ב: …" with place names if `passesNear` non-empty.
- Primary button "ראו את המסלול במפה" — sets `?route=<entry.route>` in
  the URL and dismisses the wizard. The existing planner code restores the
  route from the URL param on mount.
- Secondary button "פרטים מלאים →" — only when `entry.featured === true`,
  navigates to `/featured/<entry.slug>`.

Selecting a card also sets `localStorage["cycleways:skipWelcome"] = "1"` —
the user has actively engaged with the wizard once, so future visits
without a route param should go straight to the planner.

Empty state: "לא נמצאו מסלולים מתאימים. נסו לשנות תנאי." with quick
buttons to relax constraints (clear region, clear difficulty, reset).

## Edge Cases

| Case | Behavior |
|------|----------|
| `?route=` in URL | Wizard skipped on automatic open; planner loads the route directly. |
| `localStorage` unavailable (private mode) | Treat as "no flag" — wizard appears once per session in that browser. Acceptable. |
| `route-catalog.json` fetch fails | Wizard shows error state + "סגור" button that dismisses + sets the flag (next visit goes straight to the planner). |
| Catalog entry route fails to decode | Promote-time validation rejects it; editor list flags the entry red. Wizard skips broken entries silently. |
| `places.json` empty or missing | "מאיפה?" step replaced by "באיזה אזור?" (Q2 becomes mandatory Q1). |
| User dismisses, later opens via TopBar button | Wizard appears at step 0; closing again is a no-op for localStorage. |
| First visit after migration but before any promote happens | Catalog file does not yet exist — wizard shows "טוען..." then the same fetch-failure flow. The site is still usable via the planner. |
| Direct featured-route link (`/featured/...`) before catalog is promoted | Featured route still works via the seeded-from-meta.js migration (after we delete `.meta.js`, the JSX module reads from the catalog — which by then must exist). Order of operations: promote the catalog first, then delete `.meta.js`. |

## Testing Strategy

**Unit (Node, no browser):**

- `wizardReducer` — covers the conditional region skip, back navigation,
  reset, and edge cases (back from step 0, answer with `"any"`).
- `catalogFilter` — fixture catalog with known tags; assert ranking for a
  variety of `answers` combinations, including empty result, "any" on every
  axis, hard-filter rejection.
- `classifyRoute` in the editor server — fixture-driven tests for each
  difficulty/style rule edge.
- Editor catalog endpoints — validation rejections, draft persistence,
  promote atomicity (writes through `<file>.tmp` + rename), seed-from-meta
  fallback on first load.

**Integration:**

- A fixture catalog + fake `places.json` and `region-zones.json` exercised
  end-to-end through `classifyRoute` → verify the JSON shape matches what
  the runtime expects.

**E2E (Playwright):**

- Load `/` on first visit (no `?route=`, no localStorage flag): assert
  wizard overlay appears.
- Click through 4 buttons of one specific path: assert a result card
  appears with the expected slug.
- Click a result card: assert URL becomes `/?route=<token>`, wizard closes,
  map is visible.
- Load `/?route=<token>` directly: assert wizard does NOT appear.
- Click "דלג למפה": assert localStorage flag set, reload, wizard skipped.
- Click the TopBar "מצא מסלול" button after dismissal: assert wizard
  reopens.

## Non-Goals

- LLM / natural-language understanding. The wizard is button-only.
- Live in-browser route generation. The catalog is pre-computed by the
  editor.
- Editing the route geometry inside the Route Catalog mode. The route token
  is authored by drawing in the existing planner and pasted in.
- Synchronizing the catalog draft across multiple editor sessions on
  different machines. Single-author model.
- Persisting wizard state across browser sessions. Refreshing while the
  wizard is open resets to step 0 — acceptable for the welcoming-front-door
  use case.

## Open Questions

None blocking. Items to revisit if they become friction:

- Whether to allow multi-select in the style question (e.g., "family OR
  scenic"). Defer to v2.
- Whether to surface POI-based filtering ("רוצה לעבור ליד נחל?"). Requires
  extending `classifyRoute` to tag routes by data-point categories; defer.
- Whether `passesNear` should be visible in result cards even when the user
  didn't ask for that place (currently yes, as helpful context). Easy to
  toggle.
