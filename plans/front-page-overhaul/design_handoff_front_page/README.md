# Handoff: Cycleways Front Page Redesign — "Option A · Classic"

## Overview
A redesign of the Cycleways map front page (`מפת שבילי אופניים – גליל עליון וגולן`). The page turns the
old "giant map + tiny floating search" layout into a **persistent two-column app shell**: a Mapbox map on
the **left**, and a fixed **right-side panel** (RTL) that owns all route context. The panel has **two states**
the user moves between:

- **Discover (`גילוי מסלול`)** — find/browse: search filters, a "build your own" CTA, and recommended-route cards.
- **Build (`בניית מסלול`)** — the user has drawn a route: route stats, an **interactive elevation graph that
  doubles as a scrubber/timeline**, auto-detected points-of-interest cards, and route actions.

The headline interaction: the elevation graph, the map marker, and the play/scrub control are **one synchronized
timeline** driven by a single `progress` value (0–1). Hovering or scrubbing moves a marker along the route on the
map; hovering a difficulty segment highlights that stretch on both the graph and the map.

## About the Design Files
The files in this bundle are **design references created in HTML/React-via-Babel** — prototypes showing the
intended look and behavior. They are **not** meant to be shipped as-is. Your task is to **recreate this design in
the existing Cycleways codebase** (React + Vite + Mapbox GL, inferred from the dev server and map canvas) using its
established components, state patterns, and the real Mapbox map — replacing the prototype's faked map (an SVG route
drawn over a static screenshot) with native Mapbox GL layers fed by the user's actual drawn geometry and GPX data.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, shadows, and interactions are final and intended to be matched
closely. The only deliberately-faked part is the map rendering (screenshot + SVG overlay) — see **Map Integration**.

---

## Screens / Views

### Shell (both states)
- **Layout:** full-viewport column. `header` (62px tall) on top; below it a flex **row-reverse** region (RTL) with
  10px padding and 10px gap containing the **map** (`flex: 1`) and the **panel** (`flex: 0 0 408px`, on the right).
- **Header:** blurred grass→sky banner. Title (`מפת שבילי אופניים — גליל עליון וגולן`, weight 800, 18.5px) sits on the
  **right**; nav links on the **left** (`מדריך`, `מצא מסלול` [boxed CTA], `צרו קשר`, `על המפה`, `מסלולים`, `מפה` [active,
  green underline]).
- **Panel:** white, 14px radius, soft border. Top: a **segmented state toggle** (`גילוי מסלול` / `בניית מסלול`). Body
  scrolls.

### Discover state
- **Panel contents (top→bottom):**
  - Eyebrow `מצא מסלול` + heading `מצאו את הרכיבה הבאה`.
  - **Search form:** start-location field (`נקודת התחלה`), via field (`עובר דרך`), and three pill-group filters —
    difficulty (`קל`/`בינוני`/`קשה`), surface (`סלול`/`שטח/סלול`/`שטח`), length (`עד 10 ק״מ`/`10-25 ק״מ`/`25 ק״מ ומעלה`).
    Selected pill = green-tint fill, green border. Primary `חיפוש מסלולים` button.
  - **Build-your-own CTA:** green gradient card, heading `בנו מסלול משלכם`, white pill button `התחילו לתכנן`
    (switches to Build state).
  - **Recommended routes:** divider label `מסלולים מומלצים`, then horizontal cards — thumbnail (104px) + title +
    `מומלץ במיוחד` badge + description + meta (distance bold, level, via towns).
- **Map:** clean (no route), legend top-left, no floating tools, no on-map search (the panel owns search).

### Build state
- **Map (left):** the drawn route as a Mapbox line (blue `#1c6fb0`, ~5px, white casing underneath), a green
  **start** dot, colored **POI pins**, and a white **rider marker** at the scrubbed position. Legend top-left.
  **No floating tool buttons** (they moved into the panel).
- **Panel contents (top→bottom):**
  - **Route header:** eyebrow `המסלול שלי · טיוטה`, editable title (`סובב עמק החולה`) with a pencil glyph, and a
    **mini edit toolbar** on the right — undo / redo / clear (30px square ghost icon buttons). *These are the old
    floating map tools, relocated here.*
  - **Stat strip:** 5 cells — `אורך 11.7 ק״מ`, `טיפוס 465 מ׳`, `ירידה 11 מ׳`, `משטח שטח`, `קושי בינוני`. Cell key =
    rust 11px bold; value = 15px weight 800.
  - **Interactive elevation graph** (see Interactions).
  - **Route actions:** primary `שמירת מסלול`, ghost `GPX`, ghost `ניווט`.
  - **POIs:** divider `נקודות עניין בדרך` + count tag (`5 נקודות זוהו`), then numbered cards — index circle, category
    icon (in a tinted square, colored per category), category label (rust), title, description, distance-along (`ק״מ 4.1`).

---

## Interactions & Behavior

### The unified timeline (core feature)
A single state value **`progress` (0–1)** is shared by three controls; all of them read and write it:

1. **Elevation graph hover/click** — `onMouseMove` over the chart sets `progress = clamp((clientX − rectLeft) / rectWidth, 0, 1)`.
   The chart x-axis is **LTR** (0 km at left, 11.7 km at right) even though the UI is RTL.
2. **Scrub slider** — a `<input type="range" min=0 max=1 step=0.001>` bound to `progress`.
3. **Play button** — toggles `playing`. While playing, a `requestAnimationFrame` loop advances
   `progress += dt / 11` (≈11s for the full route), stopping at 1.

On every `progress` change:
- A **vertical cursor line** + a **dot on the elevation curve** move to `left: progress*100%`.
- A **readout chip** follows the cursor showing distance (`(progress*11.7).toFixed(1) ק״מ`), interpolated elevation
  (`מ׳`), and grade (`↗/↘ N%`). It flips its anchor near the edges so it never clips.
- The **map marker** moves to the point at that distance along the route line (prototype uses
  `path.getPointAtLength(progress*totalLength)`; in production use turf — see below).

### Segment inspection
The route is split into surface/road **segments** (prototype: 4 — dirt, road 977, paved, climb), each with a color
from the difficulty scale. Rendered as a row of proportional-width bands beneath the chart.
- **Hover a band** → set `hoveredSegment = i`. The graph header swaps from totals to that segment's stats
  (`label · surface · km · climb`), and the matching stretch of the route **brightens on the map** (prototype draws
  an overlay path with `stroke-dasharray`/`dashoffset` windowed to the segment; in production filter a Mapbox layer
  to the segment's coordinate slice or use `line-gradient`/feature-state).
- **Click a band** → set `progress` to the segment midpoint.

### Other
- **State toggle** swaps Discover/Build panel content (and the map between clean/route).
- **"התחילו לתכנן"** CTA in Discover switches to Build.
- **Pills** in the search form are single-select per group.
- Hover states: cards lift (`translateY(-1px)` + larger shadow); buttons darken; ghost buttons gain green border.

## State Management
- `panelState: 'discover' | 'build'`
- `progress: number` (0–1) — the shared timeline position
- `hoveredSegment: number | null`
- `playing: boolean` (+ rAF effect driving `progress`)
- Search-form selections: `difficulty`, `surface`, `length`
- **Data (from your app, not faked):** the drawn route as a GeoJSON `LineString`; per-point elevation + cumulative
  distance (from GPX); derived difficulty segments (bucket per-point grade %); detected POIs (name, category, lng/lat,
  distance-along); recommended routes list.

## Map Integration (replace the prototype's fake map)
The prototype draws an SVG `<path>` over a **screenshot**. In the real app use **Mapbox GL JS**:
1. **Route line** — GeoJSON `LineString` source + a `line` layer (`line-color: #1c6fb0`, width ~5, plus a wider white
   casing layer beneath).
2. **Rider marker** — a `circle` layer or `mapboxgl.Marker`. On `progress` change, compute the position with
   **`@turf/along`**: `const pt = turf.along(routeLine, progress * totalKm, { units: 'kilometers' })` → set marker
   lng/lat. (`@turf/length` gives `totalKm`.) This replaces `getPointAtLength`.
3. **Segment highlight** — second `line` layer filtered to the hovered segment, or a `line-gradient` painted from the
   difficulty buckets; toggle via feature-state on hover.
4. **POI pins** — a `symbol`/`circle` layer from the detected-POI GeoJSON, colored by category.
5. **Difficulty bands** under the elevation chart come from the same per-point grade buckets used for the line gradient.

## Design Tokens
Pulled from `styles.css` `:root` — copy these into your theme.

**Colors**
| Token | Value | Use |
|---|---|---|
| `--green` | `#355e3b` | primary buttons, active, CTA |
| `--green-700` | `#2c4f31` | hover / darker green |
| `--green-600` | `#3f6b42` | gradient pair |
| `--green-tint` | `#eef3e9` | selected pill fill |
| `--rust` | `#b5742e` | eyebrows, stat keys, badges |
| `--rust-tint` | `#f6ead7` | — |
| `--cream` | `#faf6ec` | panel header / statebar bg |
| `--cream-2` | `#f4eede` | app background |
| `--cream-3` | `#efe7d4` | scrub track |
| `--panel` | `#ffffff` | panel, cards |
| `--border` | `#e7dfca` | strong borders |
| `--border-soft` | `#efe8d7` | soft dividers |
| `--text` | `#283026` | primary text |
| `--text-2` | `#586056` | secondary text |
| `--muted` | `#8b917f` | tertiary/axis |
| `--blue` | `#1c6fb0` | route line, marker, cursor |
| difficulty | `--d-down #2b6fb5` · `--d-easy #2f9e44` · `--d-mod #f2c037` · `--d-firm #f08c00` · `--d-hard #e03131` | elevation/segment colors |

**Type:** `Assistant` (Google Fonts), weights 300–800. Title 18.5/800; section headings 19/800; hero number 38/800;
body 13–15; labels 11–13/700. RTL (`dir="rtl"`); charts stay LTR.

**Radius:** panel/map/cards 12–14px; pills 999px; buttons 10px; small chips 7–8px.
**Shadows:** `--shadow-sm 0 1px 3px rgba(40,48,38,.05)`, `--shadow-md 0 4px 14px rgba(40,48,38,.10)`,
`--shadow-lg 0 12px 36px rgba(40,48,38,.16)`.
**Spacing:** panel padding 16px; section gap 13px; pill gap 6px; control gap 8–12px.

## Assets
- `assets/map-discover.png`, `assets/map-building.png` — **screenshots used only as the prototype's fake map base**.
  Do not ship these; the real app renders Mapbox. Icons are inline SVG (`Icon` component) — replace with your icon set.
- Recommended-route thumbnails reuse the map screenshots as placeholders — swap for real route photos.
- Copy text in the cards/POIs is **illustrative placeholder** — replace with real content.

## Files (in this bundle)
- `Cycleways Front Page — Option A (standalone).html` — **self-contained** build of Option A; open in any browser to
  interact with the real thing (scrub, play, hover segments, toggle states).
- `Cycleways - Option A.html` — un-bundled entry that mounts `<VariationA/>` full-viewport.
- `styles.css` — all design tokens + component styles (the highest-value lift).
- `components.jsx` — `Icon`, `CAT` (category→icon/color), `TopNav`, `MapBackdrop`, the static `ElevationGraph`, and the
  `RECS`/`POIS` sample data.
- `panels.jsx` — `SearchForm`, `RecCard`, `ByoCta`, `RouteActions`, `StatStrip`, `PoiCard`.
- `explorer.jsx` — the interactive build pieces: `RouteOverlay` (map route+marker+pins+segment highlight) and
  `ElevationInteractive` (graph + cursor + readout + hoverable segments + play/scrub). **This is the file to study for
  the timeline interaction.**
- `variations.jsx` — `VariationA` wires it together and owns the `progress`/`playing`/`hoveredSegment`/`panelState`
  state + the playback rAF loop. (`VariationB`/`VariationC` are the other explored directions — ignore for Option A.)
