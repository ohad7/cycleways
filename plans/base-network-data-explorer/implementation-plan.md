# Base Network Data Explorer — Implementation Plan

Date: 2026-07-18

Status: In progress; first map-exploration milestone implemented

## Delivered milestone — map-first access inspection

Implemented on 2026-07-18:

- the editor's Base Graph workspace is now presented as **Base Network**;
- **Explore** is the read-only default and **Edit / review** is explicit;
- all 48,845 graph edges can be shown and colored without changing source data;
- focused presets cover raw `bicycle=no`, normalized two-way prohibition,
  conditional traversal, manual edges, and reviewed overrides;
- the initial themes cover traversal policy, raw bicycle/access tags,
  directionality, road class, and source type;
- visible results are grouped into source OSM ways (or manual edges), with edge,
  source-subject, and related-CW counts;
- source ways used by CycleWays segments are identified and sorted first;
- selecting a result highlights the entire source way and opens its existing
  raw-data and normalized-policy inspector;
- search accepts an exact base-edge ID or OSM way ID; and
- a CycleWays overlay toggle and per-theme legends provide map context.

The real-data browser acceptance check for the first decision use case found
120 raw `bicycle=no` edges grouped into 73 source OSM ways. OSM way 57116180 is
shown first because it is used by CW segment #19, and its detail panel explains
the current `prohibited/prohibited` policy.

Still deferred until the curator has used this milestone and chosen the next
direction: arbitrary composable facets, optional review annotations/sessions,
viewport-only counts, extra relationship overlays, and migration of the
roundabout/crossing workspaces into the common shell.

## Outcome

Deliver a map-first Base Network workspace that can display and filter the full
base graph, explain raw source data and normalized routing policy, inspect OSM
ways and their CycleWays impact, and optionally turn the current filtered set
into a review session.

Exploration is read-only. Existing authoritative edit paths remain authoritative:

- manual geometry and policy in `data/manual-base-edges.geojson`;
- OSM traversal corrections in `data/bicycle-traversal-overrides.json`;
- CycleWays direction alignments in Overlay V2;
- roundabout decisions in `data/roundabout-review.json`; and
- crossing decisions in the existing crossing review artifact.

The work must not change routing behavior merely by displaying, filtering, or
confirming source data.

## Delivery principles

- Add failing pure-helper/API tests before behavior changes.
- Keep all explorer-only properties ephemeral; never save them into generated
  graph GeoJSON or manual-edge source data.
- Do not replace the graph Mapbox source on each filter or theme change.
- Do not create a mandatory review queue or a new promotion gate.
- Preserve the current whole-source-way OSM override contract and evidence
  requirements.
- Preserve roundabout/crossing candidate fingerprints, decisions, publication,
  and runtime artifacts.
- Preserve current Base Graph geometry editing throughout migration.
- Keep Base Network usable with the local blank style after graph preparation.
- Use explicit interaction ownership so visible overlays cannot steal base-edge
  clicks.
- Any source-controlled write goes through a validated server API and is atomic.

## Proposed file changes

### Add

- `editor/lib/base-network-explorer.mjs`
- `editor/lib/base-network-review.mjs`
- `data/base-network-reviews.json`
- `tests/test-base-network-explorer.mjs`
- `tests/test-base-network-review.mjs`

### Modify

- `editor/index.html`
- `editor/editor.js`
- `editor/styles.css`
- `editor/server.mjs`
- `editor/lib/base-edge-direction-layer.mjs`
- `editor/lib/roundaboutReview.mjs` only if a small shared-shell adapter is
  required
- `editor/lib/crossingReview.mjs` only if a small shared-shell adapter is
  required
- `tests/test-direction-review-editor-wiring.mjs`
- `tests/test-base-edge-direction-layer.mjs`
- `tests/test-roundabout-review.mjs`
- `tests/test-crossing-review.mjs`
- `editor/README.md`
- `package.json` test wiring

Do not add explorer state to promoted `public-data` or the map manifest.

## Task 0 — Freeze baseline behavior and fixtures

### Work

- [ ] Add a small synthetic base-network fixture containing:
  - an allowed bidirectional OSM way split into two edges;
  - a `bicycle=no` track split into two edges;
  - an OSM one-way edge;
  - a reverse-only edge;
  - conditional and unknown examples;
  - one reviewed OSM override;
  - one reviewed and one unreviewed manual edge;
  - published and staged CW references; and
  - one edge related to a roundabout and one to a crossing.
- [ ] Record the current real-graph diagnostic as a non-gating developer
  command/report: edge count, distinct OSM ways, `bicycle=no` edge/way counts,
  normalized state counts, and CW conflicts.
- [ ] Add regression assertions for the existing #19 facts without hard-coding
  whole-network counts:
  - way 57116180 groups edge `e57116180_1`;
  - raw `bicycle=no` is visible;
  - normalized forward/reverse are prohibited;
  - reasons are `explicit-access-prohibited`; and
  - CW segment 19 is reported as related.
- [ ] Capture existing Base Graph manual-edit, OSM-override, one-way layer,
  roundabout, and crossing focused test commands before UI restructuring.

### Tests and exit

- The synthetic fixture can exercise every initial theme and filter without
  loading the full graph.
- #19 is discoverable through raw tag and CW-conflict indexes, not only exact
  edge search.
- No production data is changed.

## Task 1 — Build the pure explorer model

Add `editor/lib/base-network-explorer.mjs` with no DOM or Mapbox dependency.

### Work

- [ ] Define and validate default explorer state:
  `mode`, `theme`, `inspectTarget`, filters, overlays, selected subject, and
  optional review session.
- [ ] Define canonical theme IDs, filter facet IDs, overlay IDs, and built-in
  presets.
- [ ] Normalize missing raw properties without converting “missing” into an
  allowed/prohibited statement.
- [ ] Derive an aggregate traversal category from forward/reverse states while
  retaining the two independent states.
- [ ] Build indexes:
  - edge ID → feature;
  - share ID → edge IDs;
  - OSM way ID → ordered split edges;
  - manual ID → feature;
  - edge ID → published/staged CW references;
  - OSM way ID → traversal override;
  - review key → optional review record; and
  - edge ID → derived memberships when supplied.
- [ ] Derive ephemeral render/filter properties without mutating canonical
  source objects passed to save functions.
- [ ] Implement composable predicates for every V1 facet.
- [ ] Implement grouped result subjects and counts for edges, source ways/manual
  edges, current viewport, and affected CW segments.
- [ ] Implement exact/fuzzy search ranking for edge ID, share ID, manual ID,
  OSM way ID, CW segment ID, and names.
- [ ] Implement built-in presets as ordinary state patches, including Reset.
- [ ] Implement review-session snapshot order independent of later viewport
  changes.
- [ ] Provide plain-language policy explanations from raw winning evidence and
  normalized reason codes, with a safe unknown fallback.

### Tests and exit

Add `tests/test-base-network-explorer.mjs` covering:

- [ ] raw `bicycle=no` versus normalized prohibition;
- [ ] one-way prohibition without raw `bicycle=no`;
- [ ] higher-specificity bicycle permission overriding generic access;
- [ ] OSM-way grouping across split edges;
- [ ] published/staged/no-CW relationships;
- [ ] current/stale/orphaned override and optional-review states;
- [ ] all preset definitions;
- [ ] filter intersection and reset;
- [ ] result/facet counts;
- [ ] exact search priority and ambiguous results;
- [ ] review snapshot order; and
- [ ] explanations for known and unknown reason codes.

Run:

```text
node tests/test-base-network-explorer.mjs
```

## Task 2 — Reshape Base Graph into Base Network safely

### Work

- [ ] Rename the top-level **Base Graph** button/panel heading to **Base
  Network** while retaining the internal `workspaceMode: "base"` identifier to
  avoid unnecessary migration risk.
- [ ] Add visible **Explore** and **Edit** mode controls; default to Explore.
- [ ] Move the existing geometry action row under Edit mode without changing
  its handlers.
- [ ] Keep edge selection and exact-ID search available in both modes.
- [ ] Add a guarded transition out of Edit:
  - incomplete drawing must be Done or Cancelled;
  - no silent draft loss; and
  - returning to Explore restores read-only hit behavior.
- [ ] Ensure Explore hides or disables New/Copy/Delete/Split/vertex mutation
  controls and cannot enter drawing handlers by keyboard shortcut.
- [ ] Retain the current direction-policy inspector in Explore because policy
  review is an intentional selected-subject action, not geometry editing.
- [ ] Update status/help copy to distinguish exploring data from editing manual
  geometry.
- [ ] Preserve selected subject, camera, active filters, and overlays when
  switching Explore/Edit.

### Tests and exit

- [ ] Wiring test proves Explore is the default and geometry actions are not
  reachable.
- [ ] Existing manual create/copy/split/delete tests remain unchanged in Edit.
- [ ] Switching modes with an incomplete draft requires an explicit decision.
- [ ] Search and selection work in both modes.

Run:

```text
node tests/test-direction-review-editor-wiring.mjs
node tests/test-edge-pick-helpers.mjs
```

## Task 3 — Add map themes, overlays, and reliable hit ownership

### Work

- [ ] Add one explorer base-edge presentation layer or carefully adapt the
  existing base graph layer so only one primary theme controls line styling.
- [ ] Implement paint/layout expressions for Neutral, Bicycle traversal, Raw
  bicycle/access, Directionality, Road/highway class, Surface/track quality,
  and Source/review state.
- [ ] Reuse `base-edge-direction-layer.mjs` for allowed-direction arrows,
  including geometry reversal for reverse-only edges.
- [ ] Add non-color styles for blocked, conditional, and unknown states.
- [ ] Add selection halo layers for one edge and for all split members of a
  selected OSM way.
- [ ] Add independent toggles for arrows, CW segments, manual edges,
  roundabouts, and crossings.
- [ ] Implement explicit Inspect target. Ordinary map clicks query only the
  target's hit layers; visible non-target overlays do not select or zoom.
- [ ] In Edit, base/manual edit hit layers always win.
- [ ] Keep selection camera-stable. Implement a separate Fit action.
- [ ] Make search-result selection fit only after the user chooses a result.
- [ ] Define layer ordering so selected base edges and arrows remain legible
  above the basemap and below transient edit handles.

### Tests and exit

- [ ] Pure style-category tests cover all traversal combinations.
- [ ] Reverse-only arrow coordinates point in the permitted direction.
- [ ] A visible CW line above #360/#19 cannot intercept a Base edges inspect
  click.
- [ ] Roundabout/crossing overlays are non-interactive unless their Inspect
  target is active.
- [ ] Selection does not zoom; Fit and search selection do.

Run:

```text
node tests/test-base-edge-direction-layer.mjs
node tests/test-base-network-explorer.mjs
```

## Task 4 — Build the map-first explorer controls

### Work

- [ ] Add compact primary-theme and Inspect-target selectors.
- [ ] Add preset chips/menu with an always-visible Reset action.
- [ ] Add filter sections for Source, Raw tags, Normalized traversal, Reasons,
  Road/surface, CW relationship, Override/review state, and Derived features.
- [ ] Show active-filter chips that can be removed individually.
- [ ] Add live summary counts with explicit units:
  matching edges, source subjects, viewport edges, and affected CW segments.
- [ ] Add a collapsible, progressively rendered/virtualized Results section;
  do not create one DOM node per full-graph edge.
- [ ] Add a complete textual legend for the active theme and overlays.
- [ ] Debounce free-text search/filter changes.
- [ ] Persist only sanitized explorer display state in localStorage. Do not
  persist selection, review-session progress, or incomplete editing.
- [ ] Recover safely from unknown/old stored theme, filter, or preset IDs.
- [ ] Make empty results list the active filters and offer Reset.

### Tests and exit

- [ ] Preset → manual filter edits → reset behaves deterministically.
- [ ] Stored state migration ignores unknown values.
- [ ] Result rendering is capped/progressive on a 48,000-item synthetic list.
- [ ] Counts distinguish 120 edges from 73 OSM-way subjects in an equivalent
  fixture.
- [ ] Keyboard and screen-reader labels exist for all controls.

## Task 5 — Implement the grouped base-network inspector

### Work

- [ ] Render identity, stored A/B orientation, length, source, raw tags, and
  normalized policy for an atomic edge.
- [ ] When the selected edge is OSM-backed, add a source-way subject view that
  lists/highlights all split edges and presents the way-wide action scope.
- [ ] Show forward and reverse verdicts separately with reason, policy ID,
  policy digest, and provenance.
- [ ] Show current/stale/orphaned override details and the original derived
  policy beneath an active override.
- [ ] Show published and staged CW segment references separately, with actions
  to open the segment in CW Overlay and select A→B/B→A Direction Review.
- [ ] Show roundabout/crossing membership only when those datasets are loaded;
  label unavailable data rather than implying “none.”
- [ ] Show OSM links, copyable edge/way identity, and plain-language policy
  explanation.
- [ ] Keep the existing OSM/manual direction-policy form and evidence
  validation; make its whole-way scope unmistakable.
- [ ] After saving/removing an authoritative override, preserve explorer view
  state and display the existing rebuild/refresh requirement.

### Tests and exit

- [ ] #19 inspector states that `bicycle=no` wins and blocks both directions.
- [ ] Selecting either split edge of a synthetic way opens the same source-way
  subject and action scope.
- [ ] Published versus staged CW relations are not conflated.
- [ ] Saving an override marks graph evidence stale; inspection alone does not.

## Task 6 — Add optional non-authoritative review annotations

### Data and server work

- [ ] Add an empty canonical `data/base-network-reviews.json` with schema
  version 1.
- [ ] Add `editor/lib/base-network-review.mjs` for key construction, schema
  validation, state derivation, and freshness comparison.
- [ ] V1 accepts only:
  - `lens: "access"`;
  - `subject.kind: "osm_way"`;
  - `status: "confirmed_source" | "needs_follow_up"`; and
  - non-empty reviewer/date plus bounded optional note.
- [ ] Require current OSM way identity and source geometry digest when saving.
- [ ] Reject traversal states, policy fields, manual geometry, unknown fields,
  duplicate keys, missing ways, and stale digests.
- [ ] Add atomic GET/POST endpoints.
- [ ] Ensure these writes do not mark graph/build/Direction Review stale.

### Client work

- [ ] Add **Review filtered results** only when the current grouped result set
  is non-empty and has a supported review subject.
- [ ] Snapshot grouped subject IDs and provide Previous, Next, Skip, End Review,
  progress, and explicit Fit.
- [ ] Add one-click Confirm source using reviewer `ohad` and local date, with
  fields editable before save.
- [ ] Add Needs follow-up with required note.
- [ ] Continue to route Create/update override through the existing
  authoritative evidence form.
- [ ] Show stale/orphaned annotations as warnings and allow re-review/removal.
- [ ] Make it explicit that Confirm source records inspection but does not
  change routing.

### Tests and exit

Add `tests/test-base-network-review.mjs` covering:

- [ ] valid normalization and stable key;
- [ ] invalid lens/subject/status;
- [ ] missing metadata and extra routing-authority fields;
- [ ] stale and orphaned derivation;
- [ ] atomic API rejection with no partial write;
- [ ] confirmation does not affect traversal override data or stale graph
  state; and
- [ ] review session can end with skipped/unreviewed subjects untouched.

Run:

```text
node tests/test-base-network-review.mjs
node tests/test-base-network-explorer.mjs
```

## Task 7 — Deliver the Access lens and #19 workflow

### Work

- [ ] Implement the **Bicycle prohibited by raw tag** preset using raw
  `bicycle=no`, grouped by OSM way.
- [ ] Implement **Any normalized bicycle restriction** using directional
  verdicts, not raw tags.
- [ ] Implement **CW access conflicts** as a precise predicate:
  at least one published/staged directed CW alignment requires a base traversal
  that current normalized policy does not allow.
- [ ] Do not classify an ordinary legal one-way mapping as a conflict merely
  because its unused opposite direction is prohibited.
- [ ] Show raw-tag combination facets such as bicycle/foot/access/highway to
  make suspicious patterns easy to find.
- [ ] Show way-level counts and all split edges.
- [ ] Add focused inspector copy for explicit access rules and overrides.
- [ ] Validate #19 end to end:
  - visually discover it with no edge ID;
  - explain the current restriction;
  - leave without writes;
  - optionally Confirm source; and
  - optionally create an allowed/allowed override, rebuild, refresh V2, and
    make both segment directions eligible for acceptance.

### Tests and exit

- [ ] Synthetic CW conflict detects required prohibited traversal.
- [ ] Legal one-way CW alignment is not falsely classified as access conflict.
- [ ] #19 appears in both raw `bicycle=no` and CW-conflict views before an
  override and leaves the conflict view after a rebuilt allowed override.
- [ ] No bulk “allow all” action exists.

## Task 8 — Integrate derived roundabout and crossing overlays

### Phase A: read-only overlays

- [ ] Lazy-load existing roundabout/crossing review endpoints when the overlay
  or Inspect target is enabled.
- [ ] Draw their existing geometry and state styling in Base Network without
  changing candidate or review data.
- [ ] Add derived membership indexes for inspector context.
- [ ] Selecting their Inspect target opens their existing detail model and Fit
  action.
- [ ] Preserve all-at-once map display, filters, freshness banners, warnings,
  and state counts.

### Phase B: specialized lenses

- [ ] Adapt the current Roundabouts panel to the common Base Network shell while
  keeping roundabout-specific filters, detail, note, Accept/Reject, and
  Previous/Next.
- [ ] Adapt Crossings likewise, including manual crossing tooling and directed
  mapping display.
- [ ] Prove API writes and review artifacts are byte-equivalent to the old
  workspaces for the same action.
- [ ] Keep the old top-level workspace buttons during a parity period.
- [ ] Remove old buttons and duplicate panel containers only after parity tests
  and manual validation pass.
- [ ] Do not migrate either domain into `base-network-reviews.json`.

### Tests and exit

- [ ] Existing focused suites pass unchanged.
- [ ] Base-edge click ownership works with both overlays visible.
- [ ] All candidates remain visible at once when requested.
- [ ] Accept/reject/manual actions write only their existing domain artifacts.
- [ ] Source freshness and stale-review behavior remain unchanged.

Run:

```text
npm run test:roundabouts
npm run test:crossings
```

## Task 9 — Performance, offline, and accessibility hardening

### Work

- [ ] Confirm a theme/filter change updates expressions/filter state without
  calling `setData` on the full graph source.
- [ ] Measure initial projection, filter/facet calculation, theme change, and
  Results rendering on the current full graph in a supported desktop browser.
- [ ] Profile memory after repeated preset/theme changes and overlay toggles;
  eliminate retained duplicate feature collections.
- [ ] Debounce text input and cancel superseded expensive calculations.
- [ ] Cap/progressively render Results and keep map interaction responsive.
- [ ] Exercise the local blank style with network disabled after preparation.
- [ ] Verify missing graph/candidate datasets show clear unavailable/preparation
  states rather than empty success.
- [ ] Verify all legends and states have textual/non-color representation.
- [ ] Verify keyboard-only filter, result selection, inspection, review
  navigation, and Edit mode entry/exit.
- [ ] Verify narrow-window layout remains usable even though the editor is
  desktop-first.

### Exit expectations

- Ordinary preset/theme changes feel immediate on the current graph and do not
  recreate the graph source.
- Repeating the same interactions does not steadily increase memory.
- Base geometry, policy reasons, arrows, and review state remain inspectable
  offline.
- No destructive action is keyboard-reachable from Explore.

## Task 10 — Documentation, regression, and release validation

### Documentation

- [ ] Update `editor/README.md` with Base Network Explore/Edit/Review behavior,
  filters, presets, interaction target, annotations, and authoritative override
  consequences.
- [ ] Document raw tags versus normalized policy with #19 as an example.
- [ ] Document which actions require rebuild + V2 evidence refresh.
- [ ] Document that annotations do not change routing or block promotion.

### Automated validation

Run focused tests first:

```text
node tests/test-base-network-explorer.mjs
node tests/test-base-network-review.mjs
node tests/test-base-edge-direction-layer.mjs
node tests/test-direction-review-editor-wiring.mjs
node tests/test-direction-review-workspace.mjs
npm run test:roundabouts
npm run test:crossings
```

Then run traversal/build regressions:

```text
python3 -m unittest tests.test_bicycle_traversal_policy
node tests/test-bicycle-traversal-runtime.mjs
node tests/test-bicycle-traversal-baseline.mjs
node tests/test-road-99-traversal-policy.mjs
node tests/test-base-routing-network.mjs
```

Finally run the repository suite appropriate to the changed scope:

```text
npm test
```

### Manual validation checklist

- [ ] Start editor and open Base Network; it opens in Explore.
- [ ] Verify all graph edges are visible with a truthful legend and counts.
- [ ] Apply raw `bicycle=no`; compare map display with distinct way/edge counts.
- [ ] Enable CW overlay and locate #19 visually.
- [ ] Inspect way 57116180 and verify all raw tags, normalized states, reason
  codes, OSM link, and CW relationship.
- [ ] Exit inspection without writes and confirm Git remains unchanged.
- [ ] Confirm source for a disposable fixture/test way and verify only
  `data/base-network-reviews.json` changes and graph remains current.
- [ ] Create/update a disposable OSM override and verify the graph becomes stale
  until rebuild.
- [ ] Toggle all direction arrows and verify forward-only/reverse-only arrows.
- [ ] Enable CW, roundabout, and crossing overlays simultaneously; inspect a
  base edge without accidental segment selection or zoom-out.
- [ ] Switch Inspect target to Roundabouts and Crossings and verify their
  specialized details/actions.
- [ ] Enter Edit and create/modify/cancel a manual edge using existing behavior.
- [ ] Return to Explore with filters/camera preserved and no edit controls.
- [ ] Restart/refresh editor and verify sanitized explorer view restoration.
- [ ] Disable network after preparing graph data and validate the local style.

## Milestones

### Milestone A — Read-only explorer

Tasks 0–5 complete. The curator can visualize, filter, search, group, and
inspect the full graph, including #19, without any new review storage.

This is the highest-value first release and must be usable independently.

### Milestone B — Optional access review

Tasks 6–7 complete. The curator may confirm or bookmark source data and can use
the existing authoritative override workflow from the grouped way inspector.

### Milestone C — Unified derived-feature workspace

Task 8 complete. Roundabouts and crossings share the Base Network map shell and
their duplicate top-level workspaces can be retired after parity.

### Milestone D — Hardened delivery

Tasks 9–10 complete. Full regression, offline, accessibility, performance, and
manual checks pass.

## Explicitly deferred follow-ups

- User-authored repository presets and shared explorer URLs.
- Route-catalog usage and real rider-frequency heatmaps.
- OSM history, Mapillary, satellite-classification, or external evidence
  automation.
- Batch traversal overrides or “trust every CW conflict” actions.
- Direct OSM editing/upload.
- Surface/comfort scoring changes to routing costs.
- A generic data-review registry replacing domain-specific review files.
