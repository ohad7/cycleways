# Build panel empty state — action-oriented starters

Date: 2026-07-02

> **Alternative designs — pick one.** This is one of two competing designs for
> the same empty-panel space. The other is
> `plans/build-empty-guide-vignette/design.md` (guidance-only animated
> vignette). They replace the same `build-panel__empty` paragraph and MUST NOT
> both be implemented. This variant is **action-first**: compact static
> guidance plus real shortcuts that get a route started.

## Problem

When the Build panel opens with no route points, it shows only the header
("מסלול חדש" + undo/redo/clear tools) and a single line of text —
`סמנו נקודות על המפה כדי לבנות מסלול.` in `src/components/frontPanel/BuildPanel.jsx`
(the `build-panel__empty` paragraph). The rest of the panel is blank.

Two distinct users hit this state:

- **New users** don't know the gesture (tap near a trail, tap again, route
  computes along trails, drag to refine).
- **Returning planners** (desktop web is the planning surface) know the
  gesture; their real blocker is *positioning* — getting the map to the area
  they want to ride — and *resuming* — picking up a draft.

Understanding is already taught contextually by the on-map
`PlannerHints`; the empty panel is the only moment in the Build flow where
the app can offer starting shortcuts. So the space should mostly *act*, and
only briefly *teach*.

## Current context (verified 2026-07-02)

- `src/components/frontPanel/BuildPanel.jsx` — renders the Build panel;
  `getPlannerBuildModel(routeState)` provides `hasRoute`; when `!hasRoute` the
  single-line empty paragraph shows.
- `src/components/PlannerHints.jsx` — three one-time on-map hints that fire
  progressively off real user progress. **These stay untouched.**
- **Place search already exists** as a small map overlay
  (`.search-container` in `src/App.jsx` ~line 1066): a form wired to
  `handleSearchSubmit` / `handleSearchQueryChange` with state in
  `mapUi.searchQuery` / `mapUi.searchStatus`, plus a locate-me button wired to
  `handleLocateMe` (`mapUi.locateStatus`). Search flies the map to the result;
  it does not add route points.
- **Draft restore already exists**: `DraftRestoreBanner`
  (`src/components/DraftRestoreBanner.jsx`) is a floating map banner rendered
  in `src/App.jsx` (~line 1102) when
  `SHOW_DRAFT_RESTORE_BANNER && plannerDraft && !hasQueryParam("route") && routePointCount === 0`,
  wired to `handleRestoreDraft` / `handleDismissDraft`.
- `recentRoutes` exist in `App.jsx` and feed Discover's `RecentRoutesStrip`;
  catalog routes can be loaded into the planner (`handlePeekBuild` /
  `onBuild` flow).
- Mobile: Build lives in the bottom sheet; entering Build snaps it to `half`
  (`setSheetSnap("half")`), so the panel body is visible at that moment.
  Planner mobile breakpoint: `max-width: 860px`.
- The app is Hebrew / RTL.

## Design

### 1. Component & placement

- New component `src/components/frontPanel/BuildEmptyActions.jsx`; styles in
  `src/components/frontPanel/front-panel.css`.
- Rendered by `BuildPanel.jsx` **when `routeState.points.length === 0`**,
  replacing the `build-panel__empty` paragraph. `App.jsx` passes down the
  handlers/state listed below.
- With exactly 1 point (started, no route yet) the existing plain one-line
  text remains; the on-map hint covers that moment.
- **Persistent** — no seen-state, no dismiss. It is useful (not just
  instructional), so it may show every time.

### 2. Panel content, top to bottom

**a. Compact how-it-works block (teach, briefly).** Three short static lines
with small leading icons — no animation:

1. לחצו על המפה ליד שביל כדי להתחיל
2. הוסיפו נקודה נוספת — המסלול יחושב לאורך השבילים
3. גררו את הקו כדי לדייק, ואז הורידו GPX או שתפו

**b. "איפה מתחילים?" — position the map (act).**

- A place-search input inside the panel, reusing the *same* handlers and
  state as the existing map search overlay (`handleSearchQueryChange`,
  `handleSearchSubmit`, `mapUi.searchQuery`, `mapUi.searchStatus`), so both
  inputs stay in sync and behavior is identical: submit flies the map to the
  result, adds no points. Show `mapUi.searchError` inline under the input
  when set.
- Next to it, a "המיקום שלי" locate button calling `handleLocateMe`
  (disabled while `mapUi.locateStatus === "locating"`).
- The existing map-overlay search stays; this is a second, more prominent
  entry point at the moment of highest relevance.

**c. Resume draft (act).** When the draft-banner condition holds
(`plannerDraft && !hasQueryParam("route") && routePointCount === 0`), show a
row: `להמשיך את המסלול הקודם (X ק"מ)` + a restore button wired to the same
restore flow as the banner (clear selected catalog slug → `handleRestoreDraft`
→ switch panel to build).

**De-duplication rule:** while the Build empty-actions panel is visible
(desktop panel, or mobile sheet at `half`/`full` with `panel.state ===
"build"`), suppress the floating `DraftRestoreBanner` so the offer isn't shown
twice. The floating banner keeps its current behavior in every other case
(Discover state, mobile peek).

### 3. Optional extension (separate follow-up, not in the first cut)

"התחילו ממסלול מומלץ" — a short strip of 2–3 nearby/recent recommended routes
(reusing `recentRoutes` / catalog data and the existing load-into-planner
flow) as bases to modify. Valuable but adds layout and data wiring; ship the
core empty state first and evaluate.

### 4. Responsive behavior (CSS only)

- **Desktop:** the three blocks stacked with comfortable spacing; search input
  full panel width.
- **Mobile (`max-width: 860px`):** tighter spacing, steps as single condensed
  lines, search row + draft row compact so everything fits the half-height
  sheet without scrolling. Order stays: steps → search → draft.

### 5. Testing

- Component test: `BuildPanel` with empty `routeState` renders the
  actions block; with 1 point renders plain text; with a route renders stats.
- Search input in the panel calls `handleSearchQueryChange` /
  `handleSearchSubmit`; locate button calls `handleLocateMe`.
- Draft row renders only when a draft is present, and the floating
  `DraftRestoreBanner` is suppressed while the panel row is visible.
- Manual check in the running app: desktop and ~390px mobile viewport (Build
  tab → sheet at half), RTL layout.

## Out of scope

- Any change to `PlannerHints.jsx`.
- Animated vignette / GIF guidance — that is the competing
  `plans/build-empty-guide-vignette/design.md` design.
- The recommended-route-starter strip (optional extension above).
