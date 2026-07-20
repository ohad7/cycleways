# Network Editor Workflow Consolidation — Implementation Plan

Date: 2026-07-20

Status: Planned

## Outcome

Deliver one Network authoring workflow in which the curator switches explicitly
between CW and base-network focus, makes one deliberate edit, and sees the
result become current automatically whenever it is mechanically safe.

The implementation must preserve existing traversal-policy enforcement,
accepted directional data, current manual-base-edge edits, roundabout/crossing
decisions, release validation, and runtime routing behavior.

## Delivery principles

- Introduce the new coordinator and status model behind the current UI before
  deleting old controls.
- Use Overlay V2 as the forward authoring path; never round-trip a new edit
  through V1.
- Preserve user-authored repository data and accepted evidence during migration.
- Make every automatic application pass the same validators used by explicit
  acceptance.
- Keep automatic authoring refresh separate from the expensive release Build.
- Keep Promote fail-closed.
- Add synthetic fixtures for workflow rules; do not make tests depend on the
  curator's changing live segment data.
- Measure refresh duration before investing in incremental graph generation.

## Expected file changes

Names may be adjusted during implementation, but responsibilities should remain
separate.

### Add

```text
editor/lib/network-authoring-status.mjs
editor/lib/network-authoring-coordinator.mjs
editor/lib/network-focus.mjs
editor/lib/network-inspector.mjs
editor/lib/network-issues.mjs
editor/lib/network-auto-apply.mjs
tests/test-network-authoring-status.mjs
tests/test-network-authoring-coordinator.mjs
tests/test-network-focus.mjs
tests/test-network-inspector.mjs
tests/test-network-issues.mjs
tests/test-network-auto-apply.mjs
tests/test-network-editor-server.mjs
```

### Modify

```text
editor/index.html
editor/editor.js
editor/styles.css
editor/server.mjs
editor/README.md
editor/lib/cw-overlay-v2.mjs
editor/lib/direction-review-refresh.mjs
editor/lib/direction-review-issues.mjs
editor/lib/base-network-explorer.mjs
editor/lib/base-edge-direction-layer.mjs
editor/lib/base-overlay-continuity.mjs
editor/lib/manual-edge-direction-defaults.mjs
processing/match_cycleways_to_osm_graph.py
scripts/migrate-cw-base-overlay-v2.mjs
package.json
```

Existing roundabout, crossing, overlay-migration, and policy tests remain
regression gates.

## Task 0 — Freeze current behavior and scenario fixtures

### Work

- Record the current source schemas, V1/V2 relationship, server endpoints, and
  release gates before changing writes.
- Add synthetic fixtures representing:
  - a simple exact-reverse bidirectional segment like #62;
  - an explicit edge-picked bidirectional segment;
  - distinct A->B/B->A carriageways like #174;
  - a unique roundabout reverse repair like #276;
  - an ambiguous roundabout repair;
  - a continuity gap like the earlier #63 state;
  - endpoint drift like #159;
  - a new CW alignment over `bicycle=no` like #19;
  - one manual base edge used by several CW segments; and
  - a late refresh result superseded by a newer edit.
- Capture current accepted alignment/evidence digests and prove that a no-op
  migration is byte-stable or semantically stable.
- Ensure the current continuity diagnostics and manual-edge direction defaults
  are covered by the baseline rather than reimplemented inconsistently.

### Tests and exit

- Existing `npm run pretest` passes before workflow changes.
- Synthetic fixtures express expected direction, continuity, endpoint, policy,
  ownership, and roundabout results.
- A no-op load/save does not change repository authoring data.

## Task 1 — Create the pure authoring status and issue model

### Work

- Implement `network-authoring-status.mjs` as a pure projection from logical
  segment, current base graph, V2 alignment state, validation, and active jobs
  to `updating`, `current`, `needs-decision`, or `blocked`.
- Implement stable issue codes and plain-language details for continuity gaps,
  endpoint drift, ambiguity, asymmetry, unavailable direction, traversal
  evidence, access precedence, ownership, and stale derived state.
- Map current migration and Direction Review classifications into the new model
  without losing detailed reasons.
- Make direction-scoped failure explicit internally while allowing symmetric
  segments to render as one path.
- Define deep-link targets for segment ID, edge ID, OSM way ID, roundabout, and
  crossing IDs.

### Tests and exit

- Every synthetic fixture produces exactly one understandable top-level status.
- A blocked item always includes a concrete cause and primary repair target.
- A simple bidirectional segment has no direction-review issue.
- Build-report issue adapters resolve to the same object IDs and labels.

## Task 2 — Make V2 the only mutable mapping authority

### Work

- Add a compatibility adapter that reads V1 only to seed V2 fields that do not
  yet exist.
- Route all new segment mapping writes directly to V2.
- Stop updating V1 as a prerequisite for V2 refresh.
- Retain V1 output/read paths needed by existing builds and audits, but label
  them compatibility-only.
- Make authoring adoption direction-scoped so a published B->A alignment cannot
  block a revised A->B proposal, or vice versa.
- Preserve unchanged accepted alignments using their referenced-evidence digest,
  not a global graph digest.
- Make the migration idempotent and prohibit it from overwriting newer V2
  revisions.
- Add schema/version handling so interrupted migration can resume safely.

### Tests and exit

- Editing one direction updates only that direction's V2 revision.
- Unrelated graph changes preserve both directions and their decisions.
- A V1 compatibility refresh cannot revert a newer V2 mapping.
- Legacy accepted data migrates without requiring reacceptance when its evidence
  is unchanged.
- The #159-style “published opposite direction blocks adoption” fixture passes.

## Task 3 — Implement the authoring transaction coordinator

### Work

- Create a server-owned monotonic authoring revision.
- Wrap discrete source mutations in validated atomic writes.
- Classify dependencies for metadata, CW geometry, manual geometry, traversal
  policy, explicit edge selection, roundabout evidence, and crossing evidence.
- Run only required stages:
  - segment rematch against the current graph;
  - base graph regeneration when base inputs change;
  - policy normalization/audit when traversal evidence changes;
  - affected V2 proposal/validation refresh; and
  - affected roundabout/crossing evidence refresh where applicable.
- Coalesce overlapping work and discard superseded results by revision.
- Expose current job stage and affected object IDs through a state endpoint.
- Recover incomplete work idempotently after editor-server restart.
- Report timings per stage.
- Do not invoke elevation processing, public asset generation, or Promote.

### API transition

- Add a coherent authoring-state endpoint and mutation response envelope with
  revision, status, affected objects, and job state.
- Initially keep current `/api/source`, `/api/cw-base-overlay-v2/*`, and base-edge
  endpoints as adapters over the coordinator.
- Remove old endpoints only after no editor action calls them directly.

### Tests and exit

- A CW geometry edit rematches only the selected segment.
- A base-edge edit refreshes all and only known dependent segments at the V2
  application layer, even if graph generation is initially full.
- Two quick edits coalesce and the older result cannot win.
- A failed source write leaves derived state unchanged and reports retryable
  unsaved work.
- Restart recovery yields the same state as an uninterrupted run.

## Task 4 — Implement deterministic automatic application

### Work

- Implement the design's strict auto-application predicate in one pure module.
- Reuse current endpoint, continuity, access, direction, ownership, and
  roundabout validators rather than duplicating looser checks.
- Generate and validate an exact reverse for a fully allowed bidirectional path.
- Detect materially competitive parallel paths using documented matcher score
  tolerances; do not auto-apply when the choice is ambiguous.
- Respect intentionally asymmetric existing segments.
- Allow a unique validated roundabout reverse repair and record its provenance.
- Never auto-apply a new prohibited/conditional/unknown traversal or CW access
  precedence decision.
- Store algorithm version, source revision, evidence digest, result class, and
  `automatic` provenance.
- Treat **Done** after explicit edge selection as the curator decision; validate
  and apply it without a second acceptance.
- Preserve the last valid current mapping while a new invalid proposal is
  explained as blocked.

### Tests and exit

- #62-style automatic match becomes current in both directions.
- New ordinary manual-edge-backed segment becomes current without Direction
  Review when all edges are allowed both ways.
- Road 99-style distinct carriageways require one paired review.
- Conditional, unknown, prohibited, ambiguous, discontinuous, endpoint-invalid,
  and ownership-conflicting proposals never auto-apply.
- Unique roundabout repair auto-applies; ambiguous repair does not.
- Explicit edge picking requires exactly one Done action.

## Task 5 — Add the CW/Base network focus switch

### Work

- Introduce a single Network workspace shell and the persistent segmented focus
  control.
- Add **Show other network for context**, defaulting off.
- Define focused, contextual, selected, mapping-preview, directional-review,
  and issue-highlight layer roles in `network-focus.mjs`.
- Ensure only the focused network owns normal hit testing.
- Preserve camera and translate selection context when switching focus:
  - selected CW segment -> mapped/nearby base-edge corridor;
  - selected base edge -> using CW segments.
- Keep selected directional mapping edges visible above contextual lines without
  letting the CW segment intercept base-edge editing.
- Carry map style and focus preference across reloads.

### Tests and exit

- Base edges are individually clickable while a selected CW segment is visible.
- Switching focus never zooms out or clears the useful selection unexpectedly.
- Context layers cannot steal clicks.
- Direction arrows remain legible for forward-only and reverse-only edges.
- Keyboard and screen-reader states distinguish both modes.

## Task 6 — Build the object-centered inspector

### Work

- Replace separate Selected Mapping and Direction Review cards with one CW
  segment inspector.
- Show the compact current summary first.
- Put exact edge references, evidence digests, and provenance under **Inspect
  mapping** / **Advanced audit**.
- Render one bidirectional path for symmetric segments.
- Reveal A->B/B->A only for the progressive-disclosure cases in the design.
- Reuse the Base Network explorer's raw tags, normalized policy, source-way
  grouping, and used-by information in the base-edge inspector.
- Add direct **Show in Base network** and **Show affected CW segments** actions.
- Preserve hover highlighting for every listed edge and make it independent of
  the current top-level focus.

### Tests and exit

- #62-style state shows one bidirectional path and no Accept/Revalidate actions.
- #174-style state shows two directional paths and clear arrows.
- Hovering/clicking any listed edge highlights the exact edge, not its whole
  source way unless source-way grouping is explicitly selected.
- The inspector explains every disabled exceptional action.

## Task 7 — Replace pipeline queues with one Issues workflow

### Work

- Project Base Overlay issues, Direction Review exceptions, policy evidence,
  roundabout/crossing blockers, and Build issues into `network-issues.mjs`.
- Deduplicate issues that refer to the same root cause.
- Add shared search by segment, edge, OSM way, and name.
- Make issue selection open the object inspector and exact map diagnosis.
- Implement one-decision reviews:
  - choose between ambiguous paths;
  - approve a directional pair;
  - mark one direction unavailable;
  - approve an explicit access-precedence exception; or
  - correct the underlying base evidence.
- Auto-fill local curator identity (`ohad` initially, configurable later) and
  current date.
- Keep optional filters by issue type and severity, without requiring a review
  session to inspect the map.

### Tests and exit

- No object appears as current in one panel and invalid in another.
- Segment #360-style changes become visible immediately in Issues when blocked.
- Build issues deep-link to the same diagnosis as live authoring issues.
- Resolving one shared base-edge cause removes all dependent duplicate issues
  after refresh.

## Task 8 — Integrate base-edge editing and impact reporting

### Work

- Route manual-edge create, copy, split, move, direction change, and delete
  operations through the coordinator.
- Retain the current defaults:
  - newly drawn manual edge -> reviewed bidirectional;
  - copied OSM edge -> inherit normalized source direction;
  - split manual edge -> inherit parent policy.
- Build the dependency index from base edge/source way to CW directions,
  roundabouts, and crossings.
- After a base mutation, show counts for updated/current/decision/blocked
  dependents and link only to exceptions.
- Ensure deleted manual references are removed or rematched rather than kept as
  invisible stale selections.
- Keep OSM geometry read-only and retain reviewed override provenance.

### Tests and exit

- One manual-edge edit updates multiple dependent segments in one operation.
- A safe replacement edge is selected automatically.
- An ambiguous replacement creates review instead of silently changing intent.
- Deleting a used edge cannot leave a current segment referencing a missing ID.
- No extra bidirectional acceptance is required for a newly drawn ordinary
  manual edge.

## Task 9 — Integrate continuity, roundabout, crossing, and access workflows

### Continuity and endpoints

- Surface exact disconnected edge pair, measured distance, and endpoint drift.
- Add **Show gap in Base network** that switches focus, preserves the segment
  corridor, fits the local defect, and marks both endpoints.
- Reevaluate automatically after topology changes.

### Roundabouts

- Apply unique legal reverse repair through the automatic predicate.
- Record roundabout ID and repair evidence in the affected direction digest.
- Link ambiguous or stale classification to the Roundabouts lens.

### Crossings

- Reuse the shared focus, selection, search, and inspector shell.
- Refresh crossing evidence after relevant base changes.
- Keep semantic crossing approval explicit and separate from CW path application.

### Access precedence

- Preserve unchanged accepted CW precedence decisions.
- Require one explicit decision for a new/materially changed alignment over an
  explicit prohibition.
- Show raw source tags, normalized verdict, affected direction, and exact CW
  alignment before the decision.

### Tests and exit

- #63-style gap opens the exact location and resolves after the connector edit.
- #276-style reverse repair is visible in audit provenance.
- A base edit stales only crossings/roundabouts that reference changed evidence.
- #19-style unchanged precedence remains valid; changed mapping requires one
  new decision and cannot auto-apply.

## Task 10 — Separate authoring status from release controls

### Work

- Replace repeated Build/Promote panels with one persistent release status.
- Keep **Build release** explicit.
- Require the authoring revision to be current before starting a release build.
- Store the exact source/authoring revision in the build manifest.
- Disable Promote when the build revision differs from current authoring data.
- Render build issues through the unified issue adapter with object deep links.
- Preserve complete existing elevation, policy, shard, roundabout, crossing, and
  public-asset gates.

### Tests and exit

- Normal editing never runs the release build.
- Build refuses stale/incomplete authoring state with a clear object list.
- A post-build edit makes Promote unavailable until another build.
- Existing promote-target and public-asset tests continue to pass.

## Task 11 — Remove legacy curator controls after parity

Remove from the normal UI only after Tasks 1–10 are validated:

- Save Source;
- Recalculate Selected;
- Base Overlay Accept;
- Rebuild graph + refresh V2 evidence;
- Direction Revalidate;
- Accept direction for symmetric paths;
- Apply reviewed V1 direction;
- migration Run/Clear Queue controls;
- Bulk Accept Full Auto Matches; and
- batch manual-edge finalize controls.

Keep temporary diagnostics available only behind the advanced audit/developer
view until migration is stable. Then remove unused event handlers and server
adapters.

### Tests and exit

- No normal scenario fixture requires a removed control.
- Exceptional scenarios still expose their single required decision.
- Static wiring tests fail if legacy controls reappear in the normal workspace.
- Editor README documents recovery/diagnostics without instructing curators to
  manipulate V1/V2 stages.

## Task 12 — Current-data migration and manual validation

### Migration

- Back up and digest current V1, V2, CW source, manual edges, and override files
  before migration.
- Dry-run the V1-to-V2 compatibility adapter and report create/preserve/skip
  counts by direction.
- Never overwrite a newer V2 authoring revision.
- Retain current accepted Road 99, manual-edge, access-precedence, and
  roundabout-repair decisions.
- Run the full policy audit and compare before/after routable directed
  alignments.

### Required manual scenario validation

1. **#62 simple bidirectional edit**
   - change its CW endpoint or supporting manual geometry;
   - finish the edit once;
   - confirm it selects the expected base edges and becomes Current without
     mapping or direction acceptance.
2. **#174 and #352 divided-road behavior**
   - confirm distinct carriageways and arrows;
   - edit one direction and confirm the other remains accepted/current;
   - confirm one Done action applies the pair or affected direction.
3. **#276 roundabout reverse**
   - confirm the legal reverse route is generated and its repair provenance is
     visible.
4. **Continuity diagnosis**
   - create or use a safe test gap;
   - confirm the exact edges/distance are shown and Base focus reveals them;
   - repair the topology and confirm automatic resolution.
5. **#19 access precedence**
   - confirm the prohibited source edge is visible;
   - confirm unchanged CW precedence remains current;
   - in a disposable fixture, change the mapping and confirm a new explicit
     decision is required.
6. **New ordinary segment**
   - draw over bidirectional base edges and press Done;
   - confirm both directions apply automatically.
7. **Base edit fan-out**
   - edit one base edge used by multiple segments;
   - confirm the impact summary and that only real exceptions enter Issues.
8. **Focus and hit testing**
   - switch CW/Base focus at the same camera location;
   - confirm the focused network receives clicks and context never obscures it.
9. **Reload/restart recovery**
   - reload the browser during/after an authoring refresh;
   - restart the editor server;
   - confirm no accepted work disappears and no manual refresh is required.
10. **Release**
    - run Build release;
    - follow every blocker deep link;
    - confirm Promote is enabled only for the matching clean revision.

### Route regression validation

- Recreate the original July 13 ride scenario from its coordinates/token.
- Confirm Road 99 uses the permitted carriageway in each direction.
- Confirm off-CW planning and navigation-to-start enforce the same policy.
- Confirm exact shared-route replay, return route, route reversal, partial-edge
  starts/ends, roundabout instructions, and crossing instructions remain valid.
- Compare route distance and cue sequence to the currently accepted scenario
  expectations; explain any intentional difference.

### Automated gates

- `npm run pretest`
- `npm test`
- focused Python matcher/policy tests
- editor server transaction tests
- browser smoke tests for focus switching, automatic #62-style resolution,
  exceptional directional review, gap repair, reload recovery, Build, and
  Promote state

## Milestones

### Milestone A — Safe engine behind the current UI

Tasks 0–4. V2 authority, direction-scoped evidence, coordinator, and automatic
application work while old controls remain available as fallback diagnostics.

### Milestone B — One Network experience

Tasks 5–8. The focus switch, inspector, unified Issues list, and base-edit impact
summary become the primary curator workflow.

### Milestone C — Specialized features and release integration

Tasks 9–10. Continuity, roundabout, crossing, access precedence, and release
deep links use the shared workflow.

### Milestone D — Cutover and validation

Tasks 11–12. Legacy controls are removed only after current-data migration,
manual scenario review, route regression, and promotion gates pass.

## First implementation slice

The first slice should deliver visible value without performing the full UI
rewrite:

1. add the pure status and auto-application modules;
2. fix direction-scoped V2 authoring adoption;
3. route CW geometry changes through a revisioned selected-segment refresh;
4. make a #62-style safe bidirectional rematch become current automatically;
5. show its compact Current summary in the existing inspector; and
6. leave all exceptional cases on the existing review path.

That slice proves the most important simplification—ordinary segments require
no mapping or direction approval—before the separate workspaces and legacy
buttons are removed.

