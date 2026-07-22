# Bicycle Traversal Policy — Implementation Plan

**Date:** 2026-07-13  
**Status:** implementation in progress
**Design:** [`design.md`](./design.md)

## 2026-07-22 amendment — physical CW detail presentation

- [x] Classify accepted alignment geometry during Build: exact reverse pairs
  become one shared bidirectional feature; distinct or single-direction
  realizations remain directional features with arrows.
- [x] Preserve backward compatibility by applying the same normalization when
  loading the previous unclassified alignment artifact.
- [x] Merge physical alignments into the normal public CW network feature
  collection and inherit the logical segment's styling and identity.
- [x] Cross-fade logical source geometry to physical geometry from zoom 10.5 to
  zoom 12 on both web and mobile.
- [x] Keep published base-edge-derived junction footprints visible as ordinary
  CW network geometry while avoiding movement-path arrow clutter.
- [x] Make route building, hover, focus, and segment selection use the visible
  physical line at detailed zoom instead of an invisible logical source line.
- [x] Add shared/build/web/mobile regressions for bidirectional collapsing,
  separated direction arrows, zoom-aware styling, and interaction ownership.
- [x] Carry the clicked logical segment id from visible map geometry into
  route-point snapping and preserve it across later recalculations.
- [x] Prefer nearby allowed base edges carrying that segment's
  direction-scoped membership, while retaining ordinary snapping as a fallback.
- [x] Add regressions for dense parallel CW segments and the map-to-router
  segment-identity handoff.

## 2026-07-22 amendment — historical V6 anchor compatibility

- [x] Inventory the graph hashes in the published featured-route tokens and
  identify the Git commit, registry, and routing shards that originally
  published each token.
- [x] Generate an immutable graph-version archive containing verified anchor
  edge geometry and exact, digest-addressed historical registry snapshots.
- [x] Resolve a missing historical V6 anchor from that archive and replan its
  coordinate intent through the current policy graph, while preserving
  fail-closed behavior for unknown or unverifiable graph versions.
- [x] Preserve historical route intent with original anchor coordinates and
  conditional detour shaping. Retry only the spans whose still-current CW
  segment IDs disappeared from the initial current-policy replan; ignore
  retired IDs instead of forcing obsolete geometry.
- [x] Keep exact replay, navigation auto-start, and resume gated on current
  identity and traversal validation; archived geometry never becomes route
  geometry.
- [x] Add the archive to staged builds, runtime manifest hashing, web loading,
  mobile offline bundling, promotion targets, cleanup protection, and strict
  promotion integrity checks.
- [x] Add core restore, mobile asset-list, and editor promotion-target
  regressions.
- [x] Rebuild staged V3 assets and prove that all six formerly undecodable
  catalog V6 tokens now recover as current-policy replans rather than decode
  failures.
- [x] Archive the released reported Road 99 ride token and its independently
  verified `f03acd80` graph anchors, including non-catalog user-owned routes in
  the compatibility inventory.
- [x] Continue from failed current-edge anchor resolution to the historical
  archive after legacy identity is proven, and cover the retired-edge case with
  a focused restore regression.
- [x] Generate exact current-graph replacement tokens and a comparison report
  for all featured routes, including a gate for omitted historical segment IDs
  that remain in the current CW index.
- [x] Correct the Sovev Dafna migration so its start intent and the
  #335 → #246 → #247 sequence survive current-policy replanning.
- [ ] Manually review the material Sovev Dafna geometry/distance change and the
  other routes still classified as material; do not update accepted corpus
  fingerprints before that review.
- [ ] Record accepted current fingerprints and pass the complete offered-route,
  strict traversal, build, and promotion dry-run gates without a waiver. The
  reported Road 99 token now restores under current policy; its complete cue
  and crossing audit remains part of the ride-feedback validation.
- [ ] Add release-process automation that captures newly published token
  anchors before a later graph generation can remove them.

## 2026-07-20 amendment — roundabout reverse auto-correction

- [x] Detect exact-reverse failures caused exclusively by contiguous
  `osm-roundabout-implied-oneway` refs.
- [x] Find the shortest permitted roundabout-only arc between the same entry
  and exit nodes and splice it into the reverse without changing other edges.
- [x] Revalidate the complete repaired alignment and emit an explicit
  `roundabout-repaired-reverse` draft only when all hard checks pass.
- [x] Add a `roundabout_reverse_candidate` queue classification and filter.
- [x] Explain the current proposal method, mark replacement edge rows, and add
  an in-editor guide to every automatic proposal class.
- [x] Cover the repair with a synthetic roundabout regression and confirm that
  ordinary one-way blockers remain manual.
- [x] Dry-run current data: #276 produces a valid 16-edge B→A draft replacing
  three forbidden reverse roundabout refs with two permitted forward refs;
  #164 and #186 also produce fully validated review drafts.
- [ ] Restart the editor, refresh V2 evidence, visually review #276, and accept
  the repaired B→A direction.

## 2026-07-20 amendment — reviewed CW access precedence

- [x] Treat full-edge `explicit-access-prohibited` and
  `explicit-access-conditional` traversals as valid review material in
  Direction Review and record explicit `policyPrecedence` evidence. One-way,
  roundabout, and manual-reviewed prohibitions remain blocking.
- [x] Keep `unknown` and partial restricted edge refs invalid; require a base
  edge split before a partial CW alignment can grant access.
- [x] Apply precedence only from accepted V2 alignment membership in the exact
  traversal direction; legacy `cwSegmentIds` remains non-authoritative.
- [x] Emit effective runtime traversal as `allowed` with reason
  `accepted-cw-alignment`, retaining the base state/reason as provenance.
- [x] Make planner, restore, connector, approach, and rejoin validation consume
  the same central effective verdict.
- [x] Change the Base Network review preset from conditional-or-unknown to
  conditional-only and calculate blocked/conditional views from effective
  accepted-alignment policy.
- [x] Verify the current #19 proposal: both directions are now valid symmetric
  candidates, each applying precedence only to `e57116180_1`.
- [ ] In the editor, refresh V2 evidence and explicitly accept segment #19 A→B
  and B→A, then rebuild staged routing assets.
- [ ] Re-run the original full-ride scenario and promotion audit with #19
  accepted.

## Outcome

Ship one policy-bound routing system in which:

- every bicycle traversal is normalized and enforced per stored edge direction;
- one logical CycleWays segment can own independently curated `aToB` and
  `bToA` base-edge alignments;
- CycleWays preference and attribution apply only in the direction actually
  traveled;
- exact reverse, opposite-direction planning, and return-to-start are separate
  operations;
- old shared routes are revalidated and never replay forbidden geometry;
- web and mobile show one logical segment while revealing its actual physical
  directional alignments where direction matters; and
- Road 99 plus the July 13 ride are permanent correctness regressions before
  maneuver work resumes.

This is a staged data migration and product cutover, not a local `oneway` fix.
The production reader stays on the current format until the new policy, overlay,
assets, runtime, curated data, and clients pass one atomic promotion gate.

## 2026-07-14 amendment — immediate implementation slice

This slice changes curation from “inspect every ordinary two-way segment” to
“batch the proved default and inspect the exceptions,” and makes base-edge
direction policy editable in the Base Graph workspace.

Implemented in this slice:

- [x] Split manual-only unknown failures into
  `direction_evidence_needed`; keep structural/policy failures in
  `invalid_existing`.
- [x] Add a reviewed symmetric migration batch operation that publishes the
  existing explicit direction plus a digest-bound `reverseOf`, with reviewer,
  review date, and batch ID.
- [x] Show direction endpoints/arrows and normalized forward/reverse state for
  the selected manual or OSM base edge.
- [x] Add a Base Graph toggle for all direction-limited edges, with repeated
  arrows oriented to permitted travel and a distinct review style for an
  allowed direction whose opposite remains conditional/unknown.
- [x] Save manual direction evidence on the manual edge and save OSM
  corrections in `data/bicycle-traversal-overrides.json` as reviewed
  whole-source-way overrides.
- [x] Validate OSM way identity and oriented source-geometry digest in both the
  editor API and graph builder; apply a valid override to all split edges and
  reject stale/missing references.
- [x] Preserve reviewed override policy through the matcher, elevated graph,
  staged V3 asset, compact shards, and runtime graph.
- [x] Add a routing fixture proving ordinary off-CycleWays routing,
  connector-cost routing, and the sharded approach/rejoin connector all reject
  the shorter prohibited direction and use a permitted detour.

Current migration classification after this change is 219 mechanically proved
`symmetric_candidate`, 37 `direction_evidence_needed`, 12 true
`invalid_existing`, 11 `single_direction_candidate`, and 5 `unresolved`, over
284 active legacy mappings. These counts are evidence for queue design, not a
promotion waiver: the 65 exception records still require their defined
dispositions, and symmetric publication still requires the explicit batch
action.

Remaining release work in this plan is unchanged:

- [ ] Curate manual evidence and the hard exception queues, including both
  explicit Road 99 alignments and offered-route impact.
- [ ] Rebuild all V3 routing/shard/mobile assets and close the route corpus and
  promotion audits.
- [ ] Promote code and policy-bound assets atomically at Gate D. Until then the
  released V1/V2 manifest remains policy-less and must not be called protected.

## 2026-07-16 closeout — exception-only ongoing authoring

- [x] Automatically publish a newly edge-authored segment in both directions
  when its explicit alignment and exact reverse are current, conflict-free,
  continuous, endpoint-valid, and entirely `allowed`.
- [x] Keep automatic matches and every one-way, asymmetric, unknown,
  conditional, invalid, or conflicting result in Direction Review.
- [x] Record a referenced-evidence digest on accepted alignments and preserve
  acceptance across unrelated graph rebuilds only when that digest and source
  geometry remain unchanged and revalidation passes.
- [x] Preserve regenerated proposal candidate provenance for unchanged drafts
  so repeated evidence refreshes do not disable the verified symmetric batch.
- [x] Batch-publish the remaining mechanically verified legacy symmetric
  segments, then leave only the true exception queues for manual decisions.
- [x] Rebuild staged assets and rerun the Road 99/full-ride, shared routing,
  approach/rejoin, migration, and editor regression gates.

Closeout build result: 219 legacy symmetric segments were published in one
reviewed batch, segment 352 is published by the new bidirectional-authoring
rule, and segment 174 retains its two explicit reviewed carriageway mappings.
The staged overlay now has 221 fully accepted segments (442 alignments) and 64
exception segments: 34 direction-evidence, 11 invalid-existing, 13
single-direction, and 6 unresolved. The corrected ride is 10,182.168 m, uses
accepted segments 174 and 352, and contains no non-allowed traversal.

## Delivery rules

- Work from the repository root.
- Add failing tests before each behavior change and run the focused suites
  listed under the task before moving on.
- Keep generated `public-data/` files generated. Author canonical mapping and
  review data through the editor/migration commands, then rebuild.
- Do not hand-edit a generated alignment, shard, manifest, policy report, or
  public index to make a test pass.
- Do not let a compatibility decoder participate in enforced planning unless it
  reconstructs current directed traversals and validates them under the active
  policy.
- Develop V2/V3 readers behind an explicit development selection. There is no
  production fallback from an enforced V3 client to an older policy-less asset.
- Use one canonical build projection to derive public alignment refs,
  direction-scoped edge membership, and alignment display geometry. Do not
  maintain those three representations independently.
- Every route-producing command uses `plan -> validate -> commit`; a failed
  extension, restore, or replan leaves the committed route unchanged.
- New user-facing state and error copy must have Hebrew and English values.

## Fixed contracts

### Overlay V2

Implement one canonical parser/serializer for the following semantic shape:

```json
{
  "schemaVersion": 2,
  "segments": {
    "174": {
      "segmentId": 174,
      "routingDisposition": "navigable",
      "sourceGeometryDigest": "...",
      "endpoints": {
        "a": { "coordinate": [35.0, 33.0], "zoneMeters": 20, "labels": { "he": "…", "en": "…" } },
        "b": { "coordinate": [35.1, 33.1], "zoneMeters": 20, "labels": { "he": "…", "en": "…" } }
      },
      "alignments": {
        "aToB": {
          "published": {
            "disposition": "accepted",
            "realization": {
              "type": "explicit",
              "edgeRefs": [
                { "edgeId": "edge-1", "direction": "forward", "sequenceIndex": 0 }
              ]
            },
            "mappingDigest": "...",
            "review": {
              "reviewedAt": "...",
              "reviewer": "...",
              "graphVersion": "...",
              "graphDigest": "...",
              "policyId": "il-bicycle-v1",
              "policyDigest": "...",
              "sourceGeometryDigest": "...",
              "mappingDigest": "..."
            }
          },
          "draft": null
        },
        "bToA": {
          "published": null,
          "draft": {
            "realization": { "type": "reverseOf", "alignmentKey": "aToB" },
            "proposal": { "kind": "exact-reverse", "algorithmVersion": "..." },
            "validation": { "status": "valid", "referencedMappingDigest": "..." }
          }
        }
      }
    }
  }
}
```

Rules:

- `a` and `b` are stable logical endpoint identities initialized from the
  logical source geometry, not re-inferred whenever its coordinate order
  changes.
- Endpoint labels are optional for bulk legacy migration. Presentation uses a
  deterministic localized compass/destination fallback and never renders raw
  `a`, `b`, `aToB`, or `bToA`. Road 99 and any manually edited/new segment must
  receive meaningful Hebrew/English endpoint labels before acceptance.
- Each slot has a current `published` record plus one optional `draft`. Its
  effective disposition is `accepted`, `unavailable`, or `needs_review`. A
  reviewed unavailable published record carries a reason, evidence, reviewer,
  and date and has no runtime membership. It also carries a stable public
  `unavailableReasonCode` from `no_canonical_alignment`,
  `outside_logical_corridor`, or `editorially_not_offered`; internal curator
  prose/evidence is never rendered.
- A valid published alignment may coexist with a draft. Draft edits never
  mutate runtime membership; Accept atomically replaces published. When bound
  graph/policy/source/mapping evidence becomes stale, build excludes the old
  published record and derives `needs_review` while retaining audit history.
- Automatic tools produce proposals or `needs_review`; they never create
  `unavailable` and never silently publish a distinct physical path.
- `reverseOf` is accepted only after full current-policy proof. Build
  materializes and revalidates the complete reverse sequence and binds the
  referenced mapping digest so a source-alignment change invalidates it. The
  target must be the opposite slot's valid published explicit alignment;
  self-reference, chains, and cycles are invalid.
- An explicit alignment stores a complete directed full-edge sequence. Public
  route attestations continue to carry fractions for partial first/last edges.
- Acceptance binds graph, policy, source-geometry, and mapping digests. A
  substantive change invalidates only the affected alignment.
- Migration writes a complete non-authoritative V2 proposal artifact. Only the
  editor's explicit apply/review action writes the staged V2 authoring file;
  Task 12 promotes that reviewed file to the canonical overlay path. Public
  build ignores every draft.
- The logical `bike_roads` LineString remains editorial/display geometry.
  Editing a second alignment must not rewrite it.
- An active logical segment must publish at least one accepted alignment.
  `unavailable/unavailable` requires withdrawal or display-only status.
- `map-source.properties.status` remains `active`, `deprecated`, or `legacy`.
  Overlay routing disposition is `navigable` or `display_only`; “withdraw” is
  an explicit transition out of active status, normally to `deprecated`.

### Runtime CycleWays membership

The enforced runtime edge shape exposes membership by stored-edge direction:

```js
edge.cwAlignments = {
  forward: [{ segmentId: 174, alignmentKey: "aToB", sequenceIndex: 11 }],
  reverse: [],
};
```

`cwSegmentIds` may exist only in migration/debug adapters. Compact V3 routing,
cost, snap preference, CycleWays distance, segment spans, sharing, and
diagnostics call a shared `cwMembershipForTraversal(edge, from, to)` helper.
V1 active data permits at most one membership per directed interval. The array
shape keeps decoding uniform, but deprecated split archives do not publish
membership and a future intentional shared trunk would require a new explicit
reviewed ownership contract.

### Route operations

- **Ride selected alignment:** expand exactly the accepted `segmentId +
  alignmentKey` sequence and attest it; never generic-search or reverse the
  other slot.
- **Exact reverse:** reverse the attested traversal list without search; require
  `exactReverseAllowed`.
- **Plan opposite direction:** reverse ordered waypoint occurrences and run a
  new directed search; return a separate reviewable draft.
- **Return to start:** append a new occurrence of the first requested point and
  plan a new last leg while preserving the committed outbound route.
- **Close loop:** plan a graph-backed final leg; never add a visual chord.

Repeated coordinates are separate occurrences. One interior occurrence has one
selected graph anchor serving both adjacent legs, so the planner cannot jump
between nearby carriageways at a turnaround.

Show Return to start only when the first occurrence is recoverable and the last
requested occurrence is not already the same return target. Zero-length slices
remain legal for graph bookkeeping but the UX does not append a redundant
zero-length return.

### Validated route evidence seam

Tasks 6–10 share one explicit non-geometry-only contract:

```js
TraversalSlice = {
  edgeShareId,
  fromFractionQ,
  toFractionQ,
  policyState,
  policyReason,
  cwMembership,
  shardIds,
};

RouteCandidate = {
  validationContext,
  traversalSlices,
  waypointOccurrences,
  legBoundaries,
  geometry,
  metrics,
  contentFingerprint,
  baseCommittedFingerprint,
  requestGeneration,
  failure,
};
```

`commitCandidate` revalidates the slices and accepts only a candidate whose
`baseCommittedFingerprint` still matches the live route and whose request
generation is still current. A newer edit/request cancels or supersedes older
work; a late result returns `route-proposal-stale` and cannot overwrite state.
Route snapshots, reducers, sharded sessions, sharing, restore, effective
navigation routes, and persistence preserve this evidence rather than
reconstructing it from geometry.

### Unpublished segment workspace

Add a validated editor-only `data/cw-segment-workspace.json` that never enters
public build inputs. It stores reserved IDs, logical feature/metadata drafts,
endpoint/geometry changes, and alignment drafts for new or existing segments.
New segments do not enter active `map-source` data until both direction slots
have reviewed dispositions and at least one is accepted. Existing logical
geometry/endpoints remain published while replacements are drafted. Activation
uses a journaled/recoverable editor transaction that verifies base digests,
writes `map-source` plus Overlay V2 published records together, and removes the
workspace entry; Cancel changes neither public file.

## Task 0 — Freeze compatibility and Road 99 evidence

**Primary files**

- Add: `tests/fixtures/bicycle-traversal/road-99-ride.json`
- Add: `tests/fixtures/bicycle-traversal/road-99-corridor.json`
- Add: `data/routing-compat/cw-base-index-v1.json`
- Add: `data/routing-compat/cw-base-index-v1.metadata.json`
- Add: `data/routing-compat/cw-base-overlay-v1.json`
- Add: `data/routing-compat/base-edge-share-registry-v1.json`
- Add: `processing/bootstrap_base_edge_share_registry.py`
- Add: `tests/test_base_edge_share_registry.py`
- Add: `scripts/audit-bicycle-traversal-baseline.mjs`
- Test: `tests/test-bicycle-traversal-baseline.mjs`

### Work

- [ ] Freeze the exact July 13 V6 token, its graph version, decoded 11 edge
  anchors, and the 11 recovered coordinates as distinct fixture inputs.
- [ ] Record the current exact replay facts: edge share ID 370 is traversed in
  its forbidden reverse direction for roughly 547 m and the full route is about
  10,019 m. These are red-baseline observations, not future expected output.
- [ ] Add small Road 99 corridor intents for A-to-B, B-to-A, and A-to-B-to-A.
  Include the coordinate that lies on edge 370 and the nearby parallel legal
  candidate.
- [ ] Freeze the released V1 CW public index as an immutable legacy expansion
  table with graph/source/index digests. Old V6 `segmentId + reversed` spans
  must always expand through this table, never through a newly different
  alignment.
- [ ] Freeze the full 309-record V1 overlay separately as migration/audit
  history. Do not add its 25 deprecated-only mappings to the 284-record legacy
  public-index expansion table.
- [ ] Before an ordinary build mutates the current edge-ID registry, freeze a
  historical numeric-share-ID-to-canonical-edge descriptor baseline, including
  ordered geometry/orientation and fraction basis. This is the identity evidence
  required to judge old V6 references after the schema upgrade.
- [ ] Add an explicit V1-to-V2 registry bootstrap/proposal command. Stop ordinary
  builds from mutating released identity history; they read the released
  registry and write a staged proposal for review/promotion.
- [ ] Create a collision-checked lookup from each released legacy V6 32-bit
  `graphVersionHash` to exactly one released registry digest. A missing or
  colliding hash cannot prove exact identity.
- [ ] Generate a baseline inventory containing overlay/public-index counts,
  mapping refs, logical source digests, offered route consumers, and current
  route fingerprints. Assert the inspected baseline explanation: 284 active
  mappings publish to the index; 25 deprecated split-archive mappings account
  for the remaining overlay records and are migration/audit history only.
- [ ] Audit duplicated directed keys separately for active and archived
  mappings. Freeze the current archive overlaps and assert there are zero
  active-to-active overlaps before migration begins.
- [ ] Make the baseline command deterministic and `--check` capable.

### Tests and exit

- [ ] The historical token decodes identically on repeated runs.
- [ ] The frozen V1 compatibility table hash cannot change without an explicit
  fixture update.
- [ ] The coordinate fixture reproduces the current bad traversal before the
  new policy is enabled.
- [ ] No production behavior changes in this task.

Run:

```text
node tests/test-bicycle-traversal-baseline.mjs
node tests/test-route-encoding.mjs
node tests/test-react-route-actions.mjs
python3 -m unittest discover -s tests -p 'test_base_edge_share_registry.py'
```

## Task 1 — Normalize one versioned bicycle traversal policy

**Primary files**

- Add: `processing/bicycle_traversal_policy.py`
- Add: `tests/test_bicycle_traversal_policy.py`
- Add: `data/bicycle-traversal-overrides.json`
- Modify: `processing/build_osm_base_graph.py`
- Modify: `processing/build_map.py`
- Modify: `data/manual-base-edges.geojson` schema validation in
  `editor/server.mjs`

### Work

- [ ] Implement the design's ordered OSM direction/access rules as pure
  functions returning `allowed`, `prohibited`, `conditional`, or `unknown` plus
  stable reason codes and trace data.
- [ ] Preserve stored source orientation across graph splits; test `oneway=-1`,
  `oneway:bicycle`, roundabout implication/override, directional access,
  unsupported values, and conflicts.
- [ ] Extend manual edges with explicitly reviewed forward/reverse bicycle
  states. A missing manual value is `unknown`, not two-way.
- [ ] Add the reviewed override registry with source identity, evidence,
  reviewer, date, and the raw-source digest it overrides. Reject stale or
  incomplete override records.
- [ ] Emit a versioned policy artifact and deterministic audit report. Include
  counts by direction/state/reason/source/highway and the one-way, roundabout,
  restricted, conditional, manual, and CycleWays conflict queues.
- [ ] Keep runtime output unchanged for now; compare normalized results in
  shadow mode.

### Tests and exit

- [ ] Every tag fixture has an expected state, reason, and precedence trace.
- [ ] Unknown and conditional never enter the allowed adjacency projection.
- [ ] Current-data audit includes the known CycleWays one-way/roundabout/access
  queues from the design.
- [ ] Two runs over unchanged inputs produce identical policy digests/reports.

Run:

```text
python3 -m unittest discover -s tests -p 'test_bicycle_traversal_policy.py'
python3 -m unittest discover -s tests -p 'test_osm_base_routing_asset.py'
```

## Task 2 — Add Overlay V2 and an idempotent migration proposal

**Primary files**

- Add: `editor/lib/cw-overlay-v2.mjs`
- Add: `scripts/migrate-cw-base-overlay-v2.mjs`
- Modify: `editor/lib/overlay-edge-migration.mjs`
- Modify: `editor/server.mjs`
- Modify: `tests/test-overlay-edge-migration.mjs`
- Add: `tests/test-cw-overlay-v2.mjs`

### Work

- [ ] Implement the fixed Overlay V2 parser, canonical serializer, mapping
  digest, review-evidence validator, and per-alignment edge-replacement helper.
- [ ] Reject self/cyclic/chained `reverseOf`, `active + navigable`
  unavailable/unavailable segments, and `reverseOf` records whose bound source
  mapping digest is stale.
- [ ] Make the V1 reader read-only and available only to the migration command.
- [ ] Initialize stable A/B endpoints from logical source geometry and compare
  each existing ordered sequence to those endpoint zones. Ambiguity produces a
  queue item; it is never guessed.
- [ ] Revalidate the existing direction against Task 1 policy, continuity,
  source corridor, endpoint zones, and directed ownership.
- [ ] Produce a proposal file and report without overwriting V1. Applying a
  migration batch to the staged V2 authoring file requires an explicit editor
  action that records reviewer and batch ID.
- [ ] Use `map-source.properties.status` as lifecycle authority. Preserve the 25
  deprecated mappings only in the audit snapshot; generate V2 direction slots
  and candidate classifications for the 284 active segments.
- [ ] Classify every active segment as `symmetric_candidate`,
  `alternate_candidate`, `direction_evidence_needed`, `invalid_existing`,
  `single_direction_candidate`, or `unresolved`, with consumer impact and exact
  reasons. Use `direction_evidence_needed` only when every blocker is an
  unreviewed manual-edge direction; reserve `invalid_existing` for hard
  policy/topology/endpoint/mapping failures.
- [ ] Ensure a second direction starts as `needs_review`; no migration code may
  infer reviewed unavailability.
- [ ] Preserve drafts and accepted states independently per alignment so an
  edit to one direction cannot discard the other.

### Tests and exit

- [ ] V1-to-V2 proposal generation is deterministic and idempotent across all
  active mappings, while archived mappings remain byte-stable audit history.
- [ ] Ambiguous endpoints, missing edges, invalid directions, mapping changes,
  and source-digest changes enter the correct queue.
- [ ] Replacing/splitting a base edge updates each affected alignment and leaves
  unrelated alignments byte-identical.
- [ ] V1 remains unchanged until the curator applies the reviewed migration.

Run:

```text
node tests/test-overlay-edge-migration.mjs
node tests/test-cw-overlay-v2.mjs
```

## Task 3 — Make opposite-alignment proposals direction-aware

**Primary files**

- Modify: `processing/match_cycleways_to_osm_graph.py`
- Add: `tests/test_directional_cycleways_match.py`
- Modify: policy/audit integration in `processing/build_map.py`

### Work

- [ ] Replace the matcher's unconditional two-direction connectivity with the
  normalized allowed-only directed graph.
- [ ] First test an exact reverse of the accepted/proposed existing alignment.
  Return a proved `reverseOf` proposal only when every traversal is allowed.
- [ ] Otherwise generate a corridor-constrained opposite candidate. Bound
  endpoint drift, lateral offset, length ratio, road-class change, and source
  coverage so an arbitrary legal A-to-B detour is not labeled as the same
  CycleWays segment.
- [ ] Record candidate origin, algorithm version, metrics, normalized verdicts,
  and rejected alternatives. Distinct physical candidates always remain
  `needs_review`.
- [ ] Detect directed interval ownership conflicts. Opposite directions on the
  same edge may belong to the two alignments; the same directed interval may
  not be silently assigned to competing active logical segments. Deprecated
  split-archive audit records do not participate in this check.
- [ ] Add Road 99 as the first asymmetric matcher fixture. The opposite proposal
  must be a complete connected sequence on the appropriate carriageway, not a
  one-edge substitution around shares 370/19.

### Tests and exit

- [ ] Symmetric two-way, asymmetric divided-road, true one-direction-only,
  missing manual edge, excessive detour, and ambiguous endpoint fixtures have
  stable classifications.
- [ ] No generated proposal contains a non-`allowed` traversal.
- [ ] “No candidate” remains a review item, not an unavailable disposition.

Run:

```text
python3 -m unittest discover -s tests -p 'test_directional_cycleways_match.py'
python3 -m unittest discover -s tests -p 'test_bicycle_traversal_policy.py'
```

## Task 4 — Build the editor Direction Review workflow

**Primary files**

- Modify: `editor/index.html`
- Modify: `editor/editor.js`
- Modify: `editor/styles.css`
- Modify: `editor/lib/edge-pick.mjs`
- Modify: `editor/server.mjs`
- Add: `data/cw-segment-workspace.json`
- Add: `scripts/prepare-direction-review.mjs`
- Modify: `tests/test-edge-pick-helpers.mjs`
- Add: `tests/test-direction-review-workspace.mjs`

### Work

- [ ] Replace the one-mapping panel with independent A-to-B and B-to-A tabs,
  simultaneous published/draft status, metrics, ordered refs, actual terminals,
  and endpoint zones.
- [ ] Draw the logical centerline neutrally and the two physical alignments with
  distinct styles, repeated arrows, and non-color labels. Selecting either
  alignment retains the one logical segment identity.
- [ ] Color base traversals by normalized state and show raw tags, normalized
  reason, source provenance, policy digest, and override evidence.
- [ ] Let Base Graph selection inspect every manual and OSM edge independently
  of CW membership, with A/B endpoints and stored-orientation arrows. Save
  manual evidence on the manual feature; save an OSM correction only through a
  reviewed whole-way override with current source-geometry digest and mark the
  graph stale until rebuilt.
- [ ] Add per-alignment actions: generate candidate, derive proved exact
  reverse, pick/edit directed edges, revalidate, accept, mark reviewed
  unavailable with a stable public reason code plus internal rationale/evidence,
  clear draft, fix source, withdraw, and display-only.
- [ ] Disable Accept on non-allowed traversal, continuity gap, endpoint failure,
  directed ownership conflict, stale evidence, or missing review fields.
- [ ] Make manual base-edge creation collect both direction/access states and
  require rebuild/revalidation before it is selectable for acceptance.
- [ ] Stop `saveEdgePickedMapping` from replacing logical source geometry when
  an alignment changes. A first alignment may seed a brand-new segment's
  logical line once; later alignment edits do not.
- [ ] Add independent direction previews plus A-to-B-to-A composition. The
  initial composition uses the Task 3 allowed-only policy graph and must route
  graph connections between alignment terminals rather than joining nearby
  endpoints visually.
- [ ] Define the local route-fixture panel/API for token exact replay and
  coordinate replan, but wire it to the final runtime candidate/restore APIs in
  Task 12 after Tasks 7–9. Do not duplicate a second editor-only route engine.
- [ ] Add an offline local blank/base style so graph geometry, arrows, verdicts,
  evidence, and validation work without Mapbox/network access.
- [ ] Add a prepare/import command for a retained Direction Review bundle
  containing normalized graph geometry, policy/evidence, overlay/workspace,
  reports, and the local style. “Offline” begins after this bundle is built or
  imported; a clean checkout without the gitignored generated graph must run
  that prerequisite and receives a clear error rather than an empty map.
- [ ] Save through validated server APIs and keep migration/review queues
  resumable across editor restarts.
- [x] Present the staged V2 queue as a first-class review surface: show derived
  classification counts, searchable/filterable segment issues, next/previous
  navigation, a deduplicated manual-evidence queue with dependent segments,
  and direct links from segment mappings and evidence items to Base Graph edge
  inspection.
- [x] For a selected `direction_evidence_needed` segment whose only blockers
  are unknown manual-edge direction states, provide a fast reviewed action that
  marks just those edges bidirectional and persists the segment in a pending
  acceptance queue without rebuilding. One explicit batch action rebuilds
  graph/policy/V2 evidence once, verifies every queued segment, accepts only
  passing alignments, and retains failures with reasons. Keep the per-segment
  action disabled when any OSM one-way, roundabout, continuity, endpoint, or
  conflicting evidence also blocks the segment. Default the experimental
  reviewer to `ohad`, use the curator's local date, and generate a batch ID so
  review clicks require no form entry; keep the fields editable for later
  multi-reviewer use.
- [ ] Create new logical segments and existing endpoint/geometry changes in the
  unpublished workspace. Add atomic Activate/Cancel behavior; an unfinished
  segment creates no public card, runtime mapping, or promotion blocker, and an
  existing published segment stays unchanged until replacement acceptance.

### Tests and exit

- [ ] Direction selection/orientation, directed overlap, independent draft
  persistence, accept invalidation, and unavailable rationale are pure-helper
  tests.
- [ ] Editor API rejects invalid V2 data and does not partially save one tab.
- [ ] A new synthetic divided segment can be created, mapped twice, previewed,
  accepted, closed, reopened offline, and reproduced exactly.
- [ ] Road 99 alignment data can be reviewed end-to-end in this workspace before
  runtime work depends on it; runtime route acceptance remains a later gate.

Run:

```text
node tests/test-edge-pick-helpers.mjs
node tests/test-overlay-edge-migration.mjs
node tests/test-direction-review-workspace.mjs
```

## Task 4A — Bootstrap staged V2 data and curate the Road 99 pilot

**Primary data**

- Add: `data/cw-base-overlay.v2.staged.json`
- Generate: staged migration and Road 99 review reports

### Work

- [ ] Apply the reviewed V1-to-V2 migration proposal into a staged V2 authoring
  file. This becomes the editor/build input for Tasks 5–11 under an explicit
  development profile; production assets and the current production manifest
  remain V1.
- [ ] Store all unresolved opposite candidates as drafts. Publish only existing
  directions covered by an explicit reviewed migration batch and individually
  accepted asymmetric/manual cases.
- [ ] Use Direction Review to curate Road 99 segment 174 as the first real V2
  data commit: stable labeled endpoints, two complete accepted physical
  alignments, current graph/policy evidence, and no active ownership overlap.
- [ ] Keep the other active segments safely resumable in the staged file.
  Invalid/unresolved slots emit no membership; deprecated/legacy source records
  have no V2 slots.
- [ ] Add a clean command/profile that selects staged V2 for shadow builds. It
  must be impossible to mix V1 and V2 records in one output.

### Tests and exit

- [ ] Road 99's two published alignment records reopen identically in the
  editor and pass build-time policy/continuity/endpoint validation.
- [ ] A shadow build can consume staged V2 and omit unresolved membership while
  production continues reading V1.
- [ ] The staged V2 file can be regenerated/applied idempotently from the frozen
  baseline plus recorded review actions.

## Task 5 — Emit one policy-bound V2/V3 asset set

**Primary files**

- Modify: `processing/build_map.py`
- Modify: `packages/core/src/routing/compactBaseRoutingShard.js`
- Modify: `packages/core/src/routing/baseRoutingShards.js`
- Modify: `packages/core/src/data/mapAssets.js`
- Add: `public-data/routing-contract.<digest>.json` through the build
- Modify: `tests/test_osm_base_routing_asset.py`
- Modify: `tests/test-base-routing-shards.mjs`
- Modify: `tests/test-compact-base-routing-shard.mjs`
- Modify: `tests/test-map-assets.mjs`

### Work

- [ ] Validate each accepted Overlay V2 alignment independently and materialize
  `reverseOf` into a complete directed sequence.
- [ ] Emit public CW index V2 with two explicit direction slots, mapping
  digests and availability. Legacy token decoding remains exclusively bound to
  the separate immutable V1 expansion table.
- [ ] Project accepted alignment membership onto `edge.cwAlignments.forward`
  and `.reverse`. Do not emit undirected `cwSegmentIds` into enforced compact
  V3. Assert at most one active membership per directed interval and apply CW
  preference once, never once per array entry.
- [ ] Emit `cw-alignments.geojson`, one LineString per accepted alignment, with
  render ID, logical segment ID, alignment key, endpoint labels, and graph-
  derived geometry. Keep `bike_roads.geojson` one logical feature per segment.
- [ ] Add both directions' four-valued traversal states/reasons and
  direction-scoped memberships to base-routing schema V3, compact V3, shard V2,
  and manifest V2.
- [ ] Upgrade the share-ID registry to canonical identity descriptors,
  tombstones, high-water mark, prior-release comparison, and retained historical
  digests. Never rebind or reuse an ID. Build emits a staged proposal; only
  explicit promotion advances the released registry.
- [ ] Use the semantic graph/routing-context identity as runtime `graphVersion`;
  shard `generatedAt` is diagnostics only and never selects token identity.
- [ ] Compute a semantic `routingContextDigest` from graph/source, policy,
  overlay, public index, directional display, immutable legacy V1 expansion
  table, share registry, and shard semantics. Route attestations embed this
  digest.
- [ ] Compute a separate `releaseBundleDigest` from the routing context plus
  catalog sources, featured/precomputed snapshots, a canonical immutable
  release-index payload, and raw artifact hashes. Its preimage explicitly
  excludes `releaseBundleDigest`, `generatedAt`, and the mutable current-pointer
  manifest. Snapshots do not embed this bundle digest, avoiding hash
  self-reference and task-order circularity.
- [ ] Exclude `generatedAt`, filesystem paths, packaging offsets, and other
  volatile metadata from semantic digests. Keep separate raw byte hashes for
  cache/integrity validation and prove unchanged inputs rebuild to unchanged
  semantic digests.
- [ ] Mark shard boundary completeness and neighboring shard IDs. Reject mixed
  schemas/policies and conflicting duplicate boundary records instead of
  keeping the first copy.
- [ ] Publish V2/V3 under immutable digest paths while leaving the production
  manifest on the old reader during development.
- [ ] Emit a manifest-keyed `routingContract` asset containing versions,
  semantic component digests, `routingContextDigest`, legacy-table identity,
  and registry identity. Load it in `mapAssets.js`; Tasks 6–11 pass the same
  object through `useCyclewaysApp` and `ShardedRouteSession` into
  `RouteManager`, and every merged shard must match it.

### Tests and exit

- [ ] Overlay alignment, public index refs, directional memberships, and display
  geometry are exact projections of one canonical source.
- [ ] Compact encode/decode round trips states, reasons, identity, and both
  direction memberships.
- [ ] Policy/asset mismatch, duplicate disagreement, missing V3, and legacy
  policy-less data fail closed in strict mode.
- [ ] Logical map feature counts remain stable; detail alignment counts match
  accepted dispositions.
- [ ] Asset size deltas are recorded. Directional membership remains bounded
  and does not duplicate unrelated editor data into shards.

Run:

```text
python3 -m unittest discover -s tests -p 'test_osm_base_routing_asset.py'
node tests/test-base-routing-shards.mjs
node tests/test-compact-base-routing-shard.mjs
node tests/test-map-assets.mjs
```

## Task 6 — Enforce one runtime traversal verdict everywhere

**Primary files**

- Add: `packages/core/src/routing/bicycleTraversalPolicy.js`
- Modify: `packages/core/route-manager.js`
- Modify: `packages/core/src/routing/routeSnapshot.js`
- Modify: `packages/core/src/routing/routeActions.js`
- Modify: `packages/core/src/routing/routeReducer.js`
- Modify: `packages/core/src/routing/shardedRouteSession.js`
- Modify: `packages/core/src/app/useCyclewaysApp.js`
- Modify: `packages/core/src/routing/connectorCostModel.js`
- Modify: connector/rejoin modules under `packages/core/src/routing/` and
  `packages/core/src/navigation/`
- Modify: `tests/test-base-routing-network.mjs`
- Modify: `tests/test-route-manager-geometry.js`
- Modify: `tests/test-compute-connector.mjs`
- Add: `tests/test-bicycle-traversal-runtime.mjs`

### Work

- [ ] Implement the pure verdict from actual edge fractions and active policy;
  callers may not assert their own direction.
- [ ] Require the loaded routing contract before manager/session construction,
  propagate it through the shared app/session APIs, and reject any shard whose
  semantic context differs.
- [ ] Omit non-allowed full-edge adjacency, then defensively call the verdict at
  cost, partial start/target, same-edge route, Dijkstra reconstruction, exact
  replay, connector/rejoin, route transformation, and final assembly.
- [ ] Make allowed traversal the prerequisite to planner, connector, uphill,
  snap, endpoint, or CycleWays cost. No preference may widen permission.
- [ ] Replace every runtime `cwSegmentIds` read with
  `cwMembershipForTraversal`; update cost, snap preference, CycleWays distance,
  segment spans/names, connector eligibility, and diagnostics.
- [ ] Regenerate navigation geometry from validated traversal slices. Reject
  geometry-only seams, including the existing 1–25 m loop-closing chord. In
  this task an existing transform either preserves slices or fails; Task 10
  implements the complete attested transform set.
- [ ] Return the stable typed failure contract from the design and keep raw
  edge/tag data diagnostic-only.
- [ ] Make every planner result a `RouteCandidate` containing directed
  `TraversalSlice` evidence and validation context. Preserve it through
  `snapshotRouteManager`, route snapshots, reducer state, and diagnostics;
  geometry/metrics alone are insufficient.
- [ ] Add one final zero-non-allowed validator before share, Start, connector
  guidance, or rejoin guidance.

### Tests and exit

- [ ] Every traversal-producing boundary has allowed/prohibited/conditional/
  unknown tests, including partial and zero-length cases.
- [ ] The same edge can receive CycleWays preference forward and none reverse.
- [ ] Connector `snapAnyEndpoint`, CycleWays ownership, and route transforms
  cannot bypass permission.
- [ ] Full-network, merged-shard, and bounded-shard paths produce identical
  traversal fingerprints for the same fixture.

Run:

```text
node tests/test-bicycle-traversal-runtime.mjs
node tests/test-base-routing-network.mjs
node tests/test-route-manager-geometry.js
node tests/test-compute-connector.mjs
node tests/test-segment-spans.mjs
```

## Task 7 — Add correctness-grade multi-candidate and coverage search

**Primary files**

- Modify: `packages/core/route-manager.js`
- Modify: `packages/core/src/routing/baseRoutingShards.js`
- Modify: `packages/core/src/routing/shardedRouteSession.js`
- Modify: route command integration in `packages/core/src/routing/routeActions.js`
- Modify: `tests/test-route-manager-snap.js`
- Modify: `tests/test-route-manager-cw-snap.mjs`
- Modify: `tests/test-base-routing-shards.mjs`
- Add: `tests/test-multi-candidate-routing.mjs`

### Work

- [ ] Return up to four deterministic snap candidates per waypoint (hard
  maximum six), with requested coordinate, selected anchor, displacement,
  source, and policy feasibility.
- [ ] Exclude edges with no allowed direction. Keep one-direction edges only
  when they can serve the adjacent leg direction.
- [ ] Use dynamic programming over candidate pairs for consecutive legs. One
  interior candidate must serve arrival and departure; repeated coordinate
  occurrences remain independent candidates.
- [ ] Keep current click thresholds and use at most 30 m for V4/V5 coordinate
  recovery and V6 resolved-anchor alternatives. CycleWays preference is a soft
  directional score and does not make displacement free.
- [ ] Return unloaded boundary frontiers from failed searches, load the best
  neighboring shards under explicit round/shard/edge/byte budgets, and retry.
- [ ] Put coverage loading/retry and non-mutating candidate methods on
  `ShardedRouteSession`; route commands must not reach around the session to
  mutate its manager.
- [ ] Distinguish exhausted connected-component `no-permitted-path` from
  `routing-coverage-unavailable` when an unloaded frontier/budget remains.
- [ ] Make route calculation available as a non-mutating candidate result. Do
  not clear or partially update the live manager while searching.

### Tests and exit

- [ ] Road 99's coordinate on edge 370 selects the nearby allowed candidate for
  the required direction.
- [ ] `A -> B -> A` may select different candidates for the two A occurrences,
  while B cannot jump across a median without a graph path.
- [ ] A true one-way route finds a permitted detour or returns a typed failure;
  it never relaxes permission.
- [ ] Frontier exhaustion and proven no-path are stable, separate outcomes.
- [ ] Candidate ordering and final route fingerprints are deterministic.

Run:

```text
node tests/test-route-manager-snap.js
node tests/test-route-manager-cw-snap.mjs
node tests/test-multi-candidate-routing.mjs
node tests/test-base-routing-shards.mjs
```

## Task 8 — Add transactional route intent and direction commands

**Primary files**

- Modify: `packages/core/src/routing/routeReducer.js`
- Modify: `packages/core/src/routing/routeActions.js`
- Modify: `packages/core/src/routing/routeSnapshot.js`
- Modify: `packages/core/src/routing/shardedRouteSession.js`
- Modify: `packages/core/src/app/useCyclewaysApp.js`
- Add: `packages/core/src/routing/routeIntent.js`
- Modify: `tests/test-route-reducer.mjs`
- Modify: `tests/test-react-route-actions.mjs`
- Add: `tests/test-route-direction-commands.mjs`

### Work

- [ ] Model stable waypoint occurrences with requested coordinate, selected
  anchor, snap provenance, and ordered leg boundaries/purpose.
- [ ] Implement `routeFromAcceptedAlignment(segmentId, alignmentKey)` in shared
  core/session code. It expands and validates that exact published alignment,
  creates terminal occurrences and traversal evidence, and returns
  `derivation: curated-alignment`; `bToA` must never reverse `aToB` or fall back
  to unconstrained waypoint search.
- [ ] Refactor add, drag, remove, restore, and recalculation to plan into a
  temporary candidate and commit only a fully validated snapshot.
- [ ] Implement `appendReturnToStart`: append a new first-point occurrence,
  plan only after preserving the committed route, and return the valid extended
  route as a pending proposal. Commit it atomically only after the shared
  proposal-accept action.
- [ ] Implement `planOppositeDirection`: reverse waypoint occurrence order,
  run fresh directed planning, return a separate pending proposal and
  `requiresReview: true`.
- [ ] Implement graph-backed close-loop through the same planner.
- [ ] Keep exact reverse out of these search commands; it is an attested route
  transformation handled in Task 10.
- [ ] Add accept/dismiss proposal actions. Until acceptance, the old route
  remains the committed share/navigation source; dismissal is lossless.
- [ ] Bind every asynchronous proposal to the committed route fingerprint and a
  monotonically increasing request generation. Edit/reset/new-command cancels
  or supersedes older work; `commitCandidate` rejects late results with
  `route-proposal-stale`.
- [ ] Add `opposite-direction` and `return-leg` failure stages. On failure,
  preserve route geometry, share token, fingerprint, and navigation ability.
- [ ] Preserve route/leg intent through undo/redo and ensure proposed changed
  snaps are visible before replacing existing legs.

### Tests and exit

- [ ] Exact reverse, opposite planning, return extension, and close-loop cannot
  call one another implicitly.
- [ ] No-return leaves the prior state and fingerprint byte-identical.
- [ ] Road 99 A-to-B-to-A uses real distinct directional traversals and no
  forbidden edge 370 reverse.
- [ ] Selecting Road 99 `aToB` and `bToA` constructs each exact accepted
  sequence; an unavailable direction cannot produce a navigable candidate.
- [ ] Accept/dismiss and edit/reset/second-command-during-flight tests prove a
  stale return/opposite result cannot overwrite newer web/mobile core state.
- [ ] User-built and restored routes share the same command/state semantics on
  web and mobile core.

Run:

```text
node tests/test-route-reducer.mjs
node tests/test-react-route-actions.mjs
node tests/test-route-direction-commands.mjs
```

## Task 9 — Make sharing and restore policy-safe

**Primary files**

- Modify: `packages/core/src/routing/routeActions.js`
- Modify: `packages/core/src/utils/route-encoding.js`
- Modify: restore paths in `packages/core/route-manager.js`
- Modify: `packages/core/src/routing/shardedRouteSession.js`
- Modify: `packages/core/src/routing/routeSnapshot.js`
- Modify: `tests/test-route-encoding.mjs`
- Modify: `tests/test-react-route-actions.mjs`
- Add: `tests/test-policy-route-restore.mjs`

### Work

- [ ] Decode old V5/V6 CW spans only against the frozen V1 compatibility table
  tied to its graph/index digest. Never reinterpret `reversed: true` as the new
  opposite alignment.
- [ ] Obtain that table only through the manifest/routing contract. Missing,
  unbundled, or digest-mismatched compatibility data rejects exact expansion on
  web and offline mobile; replan is allowed only from independently recoverable
  anchors.
- [ ] Validate every expanded full/partial traversal, continuity, direction
  count, finite cost, endpoint edge, edge identity, and policy before exact
  commit.
- [ ] For newly shared V6 routes, emit compact CW spans only for the frozen
  legacy alignment or its proved exact reverse. Encode distinct opposite
  alignments as ordinary directed base spans.
- [ ] Do not merge spans across waypoint, turnaround, leg-purpose, or alignment
  boundaries. Preserve all three occurrences in `A -> B -> A`.
- [ ] Implement restore as `exact -> current-coordinate replan -> unavailable`,
  with temporary state and `requiresReview` on a replacement.
- [ ] Resolve V6 extant edge anchors to coordinates when canonical identity is
  proven even if the stored direction is now forbidden. Missing/unproven V6
  identity is unrecoverable; V4/V5 may use embedded coordinates within bounds.
- [ ] Bind exact replay to the immutable share registry history, not a matching
  numeric share ID or graph-version string alone.
- [ ] Keep the opened token as the active unavailable intent on failure; an
  unrelated previous route may return only through an explicit action.
- [ ] Preserve the complete `RouteCandidate` traversal evidence through exact
  and replanned restore; no restore path commits a geometry-only snapshot.
- [ ] Keep V1–V3 tokens intent-only: decode their recoverable points and always
  run current planning; never treat their historical segment geometry as
  navigable evidence.

### Tests and exit

- [ ] The historical Road 99 token rejects exact replay, then replans from its
  frozen coordinates with zero non-allowed traversals and review required.
- [ ] Old reversed CW spans reject rather than substitute a new alignment.
- [ ] Offline mobile legacy restore passes with the bundled table and fails
  closed when the table is missing or tampered.
- [ ] New asymmetric routes round-trip as base spans with waypoint/leg
  boundaries intact.
- [ ] A failed restore cannot leave partial geometry or stale navigable state.
- [ ] A future V7 alignment span remains an optional compression follow-up, not
  a cutover dependency.

Run:

```text
node tests/test-route-encoding.mjs
node tests/test-react-route-actions.mjs
node tests/test-policy-route-restore.mjs
```

## Task 10 — Attest route transforms and active navigation

**Primary files**

- Modify: `packages/core/src/navigation/navigationRoute.js`
- Modify: `packages/core/src/navigation/effectiveNavigationRoute.js`
- Modify: `packages/core/src/navigation/ridePlan.js`
- Modify: `packages/core/src/navigation/persistencePolicy.js`
- Modify: `apps/mobile/src/navigation/activeNavigationStore.js`
- Modify: `apps/mobile/src/navigation/backgroundNavigationTask.js`
- Modify: mobile resume/runtime modules under `apps/mobile/src/navigation/`
- Modify: navigation tests named below
- Modify: `packages/core/src/routing/routeSnapshot.js`
- Add: `packages/core/src/utils/canonicalHash.js`
- Add: `tests/test-canonical-hash.mjs`

### Work

- [ ] Build deterministic route attestations from validation context,
  quantized directed traversal slices, canonical geometry, transform,
  waypoint occurrences, leg boundaries, and derivation.
- [ ] Implement canonical serialization plus synchronous pure-JS SHA-256 in
  shared core so existing synchronous planning/navigation APIs remain
  synchronous on web and React Native. Verify it against standard vectors and
  Node's crypto implementation; do not rely on platform-specific serialization.
- [ ] Derive `exactReverseAllowed` by actually reversing every traversal slice.
  Remove `routeShape.type !== "one_way"` as permission evidence in core and
  mobile.
- [ ] Apply source/product restriction after policy proof. A
  `curated-alignment` route is exactly reversible only when its reversed slices
  equal the current accepted opposite alignment; unavailable or distinct
  opposite slots disable Reverse and use the selected-alignment/opposite-plan
  flows instead.
- [ ] Rebuild clipping, loop rotation, alternate start, approach composition,
  connector, and rejoin geometry from transformed traversal evidence and
  recompute fingerprints.
- [ ] Add the navigation-plan fingerprint over route content, maneuver-generator
  version, and canonical cue plan.
- [ ] Migrate active-navigation storage to V2. V1 records lose tracker/voice
  state and cannot speak or auto-resume.
- [ ] Make headless processing load the small routing contract and stop before
  session/audio/location work on missing or mismatched route/navigation
  fingerprints.
- [ ] In foreground, preserve tracker progress only for matching route content;
  preserve cue/voice memory only for a matching rebuilt navigation-plan
  fingerprint. Otherwise return a reviewable planner intent.
- [ ] Require an attestation for Start from manual, catalog, CycleWays,
  restored, connector, and rejoin sources. Geometry-only material remains
  display-only.

### Tests and exit

- [ ] Exact reverse works for a fully reversible route and returns
  `reverse-not-allowed` for Road 99 without silently replanning.
- [ ] A policy-two-way curated alignment with a reviewed-unavailable opposite
  slot cannot manufacture that missing CycleWays direction; a generic user
  route over the same allowed slices follows its own policy-derived capability.
- [ ] Every effective transform has deterministic traversal and geometry
  fingerprints.
- [ ] Forged/stale reverse selection, V1 active records, mismatched contracts,
  and changed cue plans cannot resume stale guidance or speech.
- [ ] Matching full/sharded/mobile assets produce identical route attestations.

Run:

```text
node tests/test-navigation-route.mjs
node tests/test-effective-navigation-route.mjs
node tests/test-ride-plan.mjs
node tests/test-navigation-persistence-policy.mjs
node tests/test-navigation-resume.mjs
node tests/test-navigation-lifecycle.mjs
node tests/test-navigation-voice.mjs
node tests/test-canonical-hash.mjs
```

## Task 11 — Ship the shared web/mobile segment and return UX

**Primary files**

- Modify: `packages/core/src/data/mapAssets.js`
- Add: `packages/core/src/routing/cwAlignmentPresentation.js`
- Modify: `src/map/MapSurface.jsx`
- Modify: web segment detail/build components under `src/`
- Modify: `src/components/RoutePointActions.jsx`
- Modify: `apps/mobile/src/screens/BuildScreen.jsx`
- Modify: `apps/mobile/src/planner/RideSetupSheet.jsx`
- Modify: `apps/mobile/scripts/sync-offline-assets.mjs`
- Modify: `packages/core/src/platform/bundledAssets.native.js` through the sync
  command
- Add/modify presentation, asset, and parity tests

### Work

- [ ] Load `cw-alignments.geojson` through the policy-bound manifest and bundle
  the exact same asset/digest into mobile.
- [ ] Replace the mobile sync script's hard-coded routing filenames/directories
  with traversal of the manifest/release index. It must copy every referenced
  immutable routing contract, policy, legacy table, CW index, alignment asset,
  shard manifest, and shard, then verify their semantic and raw hashes.
- [x] Keep one logical feature/card/detail page at overview scale. At detail or
  selection scale show accepted physical alignments with arrows; coincident
  reverse-of paths render as one clean bidirectional line.
- [ ] Add a compact availability badge/glyph to overview cards and selection
  state. At medium zoom, show both physical lines when they materially diverge;
  the neutral logical centerline is a low-zoom browse abstraction only.
- [x] Make either physical line select the same logical segment. Show endpoint-
  oriented availability (“toward A/B”), never storage-relative
  forward/reverse labels.
- [ ] Show a reviewed unavailable direction explicitly without presenting it as
  a claim about all possible legal roads.
- [ ] Add endpoint-oriented “ride this segment” actions that call
  `routeFromAcceptedAlignment` with the selected key. The selected alignment's
  distance, elevation gain/loss, surface, road exposure, and availability come
  from that alignment/attested route, never the logical centerline.
- [ ] Always render planned-route traversal geometry, not the logical centerline,
  for preview/navigation. Add direction and outbound/return labels not conveyed
  by color alone.
- [ ] Add an explicit Return-to-start action on web and mobile once a valid
  route has at least two points, a recoverable first occurrence, and a last
  occurrence that is not already the same return target. This is required
  because clicking an existing route point/line is currently suppressed and
  point actions only remove.
- [ ] Add a separately worded Plan-opposite-direction action for recoverable
  user-built intent. Enable Reverse only for `exactReverseAllowed`.
- [ ] Preview changed return/opposite lines and separate distance effects before
  offering “Use this route.” Keep the committed line distinguishable until the
  rider accepts; on failure state that the existing route was not changed.
- [ ] Localize policy, coverage, no-return, unavailable-direction, updated-route,
  and interrupted-navigation copy in Hebrew and English.
- [ ] Preserve keyboard/touch accessibility and web/mobile presentation-model
  parity.

### Tests and exit

- [ ] One symmetric, one divided, and one reviewed one-direction-only segment
  have matching web/mobile labels, arrows, selection, and exact route lines.
- [ ] Road 99 appears as one logical segment and two detail alignments.
- [ ] Return/opposite actions dispatch the shared core commands and retain the
  old route on failure.
- [ ] Mobile bundle contains manifest, policy identity, CW index V2, alignment
  geometry, the immutable V1 legacy expansion table, and all referenced V3
  shards with matching digests. Missing/mismatched legacy data fails exact
  restore closed offline; an independently recoverable replan may still run.
- [ ] Raw storage keys (`a`, `b`, `aToB`, `bToA`) never render. Legacy segments
  use deterministic localized compass/destination fallbacks; Road 99 and every
  manually edited/new segment use meaningful curated endpoint labels.

Run:

```text
node tests/test-map-assets.mjs
node tests/test-map-interactions.mjs
node tests/test-map-layers.mjs
node tests/test-planner-surface-parity.mjs
node tests/test-ride-plan.mjs
npm run build
npm run mobile:assets
```

## Task 12 — Curate and correct the current CycleWays network

**Primary data and reports**

- Migrate: `data/cw-base-overlay.json` through the editor command
- Review: `data/map-source.geojson` logical segment metadata only where needed
- Review/fix: `data/manual-base-edges.geojson` and
  `data/bicycle-traversal-overrides.json` through their validated workflows
- Generate: migration, policy, alignment, and route-impact reports
- Add: `scripts/check-cw-directional-migration.mjs`
- Add: `scripts/validate-offered-route-corpus.mjs`
- Add: `tests/fixtures/bicycle-traversal/offered-route-corpus.json`

### Work

- [ ] Reconfirm that the 309-overlay versus 284-public-index difference is the
  25 deprecated split-archive mappings found in the baseline audit. Keep those
  records in the frozen V1 overlay/audit snapshot, not the legacy token index;
  exclude them from V2 slots and runtime membership, and fail if any
  unexplained record remains.
- [ ] Revalidate the Road 99 pilot against the final Task 5–11 runtime, then
  review the remaining 283 active segments in this order: every currently
  offered navigation route; invalid current alignments;
  one-way/roundabout/access/manual conflicts; asymmetric opposite candidates;
  then the remainder.
- [ ] For each of the 284 active old mappings, confirm stable logical endpoints
  and place the existing sequence in the correct direction slot. Revalidate it;
  do not grandfather an unknown traversal. Full-edge explicit-access
  prohibited/conditional traversals require an explicit accepted direction
  under CW precedence; directionality remains blocking.
- [ ] Bulk-accept only unambiguous policy-valid migration/exact-reverse batches
  through an explicit recorded curator action. Review every distinct opposite
  path, invalid mapping, manual edge, ambiguity, and unavailable direction
  individually.
- [ ] For Road 99 segment 174, retain one logical product segment and author two
  complete accepted sequences. Scope share 370 membership only to its allowed
  direction and map the other carriageway as a separate sequence expected to
  include share 19 in its allowed direction.
- [ ] Where source data is wrong or missing outside a curated CW alignment, fix
  OSM input/manual-edge policy or add a reviewed override with evidence. For a
  full-edge curated alignment, the accepted V2 direction is the reviewed access
  evidence; partial restricted coverage requires splitting the base edge first.
- [ ] Give every `active + navigable` logical segment two reviewed slot
  dispositions: accepted/accepted or one accepted plus one unavailable. Otherwise
  record `display_only` explicitly or transition the logical segment out of
  active status.
- [ ] Use the exact lifecycle rules: an active `navigable` segment has at least
  one accepted alignment and two reviewed slot dispositions; active
  `display_only` emits no routing membership; Withdraw transitions the logical
  source out of `active`, normally to `deprecated`.
- [ ] Rebuild affected catalog routes and compare distance, CycleWays share,
  road exposure, endpoint behavior, and traversal fingerprint. Record
  accept/fix/withdraw rationale for material changes.
- [x] Make Promote migrate every offered-route token to the staged current
  graph before auditing it. Accept a fingerprint transition automatically only
  when exact current-policy replay succeeds, geometry and distance stay within
  one metre of the promoted snapshot, and no current CycleWays segment is lost;
  otherwise retain the review blocker and generated comparison artifacts.
- [x] Make the reported-ride gate tolerate bounded geometry-only changes on the
  exact same directed traversal path while continuing to block edge,
  direction, policy, membership, or material distance changes.
- [ ] Wire the editor route-fixture panel to the final non-mutating restore and
  candidate APIs. Show historical-token exact rejection, frozen-coordinate
  replan, both isolated directions, and A-to-B-to-A with before/after metrics
  and zero-non-allowed validation.
- [ ] Keep unresolved or invalid alignments out of runtime membership throughout
  curation; the process must be safely resumable.
- [ ] After the staged V2 file is complete, atomically replace the canonical V1
  authoring path with reviewed Overlay V2 while retaining the frozen V1 audit
  snapshot. Do not change the production current manifest yet.

### Tests and exit

- [ ] Road 99 A-to-B, B-to-A, and A-to-B-to-A previews pass visually and contain
  zero non-allowed traversals.
- [ ] Every offered route has a current attestation or an explicit withdrawal /
  display-only decision.
- [ ] No `active + navigable` segment has a missing/`needs_review` direction
  disposition; active display-only records emit no membership.
- [ ] Public index, runtime memberships, alignment geometry, and review report
  reconcile exactly after a clean rebuild.
- [ ] A second curator can reproduce the review evidence from local artifacts
  without network access; external map imagery is optional context only.

Run/check during curation:

```text
node scripts/check-cw-directional-migration.mjs --overlay data/cw-base-overlay.v2.staged.json --check
node scripts/validate-offered-route-corpus.mjs --check
node tests/test-road-99-traversal-policy.mjs
```

## Task 13 — Close regression gates and cut over atomically

**Primary files**

- Add: `tests/test-road-99-traversal-policy.mjs`
- Add/modify: route corpus and simulator scenario fixtures
- Modify: promote validation in `editor/server.mjs` and map build/promote scripts
- Modify: `/api/route-catalog/promote` staging in `editor/server.mjs`
- Modify: `scripts/lib/featuredRouteSnapshotBuilder.mjs`
- Modify: `tests/test-editor-promote-targets.mjs`
- Modify: featured snapshot build/loader tests

### Work

- [ ] Make the historical token exact-replay rejection a permanent test.
- [ ] Make the frozen-coordinate recalculation a separate permanent test. It
  must consider the nearby permitted carriageway, contain zero non-allowed
  traversals, and preserve the accepted field section unless a reviewed change
  says otherwise.
- [ ] Test isolated Road 99 directions and the full return composition. Require
  a real graph connection and forbid edge 370 reverse.
- [ ] Complete the deferred Road 99 closed-way visual acceptance when local
  editor/map access is available. In the one-way base-edge layer, verify that
  generated edges `e855779446_7` (5.5 m) and `e958921301_8` (14.6 m) close the
  two roundabouts without a visible gap and that both arrows follow legal
  forward circulation. Replay the candidate in
  `tests/fixtures/bicycle-traversal/road-99-ride-candidate.json`; confirm the
  10,111.6 m line has no gap or artificial manual connector. This check blocks
  fingerprint freeze and promotion, but does not block automated work or the
  next ride-feedback item while the curator is remote. If subsequent route
  geometry work changes the candidate, refresh these expected metrics before
  performing the deferred check.
- [ ] After curator visual acceptance, freeze the replacement traversal
  fingerprint and a simulator-accepted shared token.
- [ ] Run the complete offered-route corpus and close every correctness review
  item. Record distance, exposure, CycleWays-share, snap displacement, shard
  expansion, and failure-class changes.
- [ ] Make promotion reject Overlay/Index V1, policy-less/mixed assets,
  undirected runtime membership, stale acceptance evidence, unresolved active
  alignments, asset-projection disagreement, invalid route fixtures, or an open
  correctness queue.
- [ ] Stage and validate the entire release before touching public pointers.
  Featured/precomputed snapshot generation is blocking; no promote endpoint may
  swallow its failure. Compute the final canonical release-index digest only
  after snapshots exist, copy immutable assets first, and atomically replace the
  mutable current manifest pointer last. Apply the same order to map and route-
  catalog promotion.
- [ ] Refactor `featuredRouteSnapshotBuilder` to accept staged manifest,
  catalog, asset, and output roots; key/invalidate caches by those roots; and add
  a strict promotion mode that forbids fallback to an existing snapshot.
  Generate and validate every snapshot solely from staged assets before
  computing `releaseBundleDigest`.
- [ ] Include the staged share-ID registry proposal in promotion. Persist its
  high-water mark/history before switching the manifest pointer, and require the
  routing contract/release index to reference that exact registry digest. Never
  roll registry history back after a later promotion failure: unused allocated
  IDs become reserved/tombstoned and are never reused.
- [ ] Point the versioned current manifest to the immutable V2/V3 set and make
  the legacy mutable routing path unsupported for enforced clients. Use
  immutable URLs plus explicit manifest reload/browser-cache handling; this
  repository has no service worker. Ship mobile code and bundled assets
  together.
- [ ] Verify failure copy and Start-disabled behavior offline, on stale links,
  and after an interrupted active ride.
- [ ] Keep a rollback generation only if it is itself V3/policy-compatible. Do
  not roll production back to the known unsafe V2 semantics.
- [ ] Regenerate cues from the accepted policy-valid ride and hand that exact
  fingerprint to the separate crossing/maneuver design.

### Final validation

Run focused correctness suites first:

```text
python3 -m unittest discover -s tests -p 'test_bicycle_traversal_policy.py'
python3 -m unittest discover -s tests -p 'test_directional_cycleways_match.py'
python3 -m unittest discover -s tests -p 'test_osm_base_routing_asset.py'
node tests/test-road-99-traversal-policy.mjs
node tests/test-bicycle-traversal-runtime.mjs
node tests/test-multi-candidate-routing.mjs
node tests/test-policy-route-restore.mjs
node tests/test-route-direction-commands.mjs
node tests/test-editor-promote-targets.mjs
node tests/test-featured-route-snapshots.mjs
node tests/test-featured-route-snapshot-loader.mjs
```

Then run repository-wide gates:

```text
npm test
npm run build
npm run mobile:assets
npm run test:smoke
```

Manual acceptance on web and iOS:

- [ ] Toggle the one-way base-edge layer around the Route 90/Tel Hai and Gan
  Hatzafon roundabouts; confirm the restored closing arcs are drawn, connected,
  and arrowed in the same circulation direction as the rest of each ring.
- [ ] Replay the Road 99 ride candidate and confirm there are no visible gaps
  and no manual gap-connector features in either the editor or product map.
- [ ] Open either Road 99 carriageway and confirm one logical segment detail.
- [ ] Inspect both direction arrows and endpoint-oriented availability labels.
- [ ] Plan A-to-B and B-to-A independently.
- [ ] Add Return to start; confirm the line uses the permitted carriageway and
  displays the changed return clearly.
- [ ] Simulate no-return and coverage-unavailable cases; confirm the committed
  outbound route remains and the messages differ.
- [ ] Open the historical token; confirm exact rejection, visible replanned
  replacement, review requirement, and disabled auto-start.
- [ ] Start the accepted replacement in the SIM scenario, background/foreground
  it, and verify the route/navigation fingerprints survive only under the
  matching bundled contract.

### 2026-07-20 authoring-remap refresh amendment

- [x] Detect changed edge-reference mappings for legacy segments in the current
  authoring overlay without mutating the frozen V1 compatibility bundle.
- [x] Emit those mappings as reviewed `authoring-v1-revision` proposals.
- [x] Adopt a revision on refresh only when both existing V2 slots are untouched
  automatic drafts; preserve published and manually edited work.
- [x] Refresh the visible Direction Review alignment source when hovering an
  edge in the base-mapping list.
- [ ] Restart the editor, refresh V2 evidence, and confirm #276 shows the new
  17-edge A-to-B mapping as valid and the reverse as roundabout-blocked.

## Milestone gates

### Gate A — Truth is visible, production unchanged

- Policy normalization and baseline audits are deterministic.
- Overlay V2 migration is a proposal, not an overwrite.
- Road 99's invalid historical traversal is frozen and reproducible.

### Gate B — Curator can create correct directional data

- Direction Review works offline.
- New segments support explicit, reverse-of, and reviewed-unavailable directions.
- The staged V2 authoring file contains Road 99's two reviewed complete
  alignments and a passing policy-graph round-trip preview; production remains
  V1 until Gate D.

### Gate C — Runtime is fail-closed

- V3 assets carry policy and direction-scoped membership.
- All route-producing boundaries enforce the central verdict.
- Minimum multi-candidate search and atomic route commands pass.
- Share/restore/reverse/resume cannot execute stale or forbidden geometry.

### Gate D — Product and data are ready together

- Web/mobile present one logical segment and actual directional paths.
- Every active segment and offered route has a disposition.
- Road 99 token, coordinates, two directions, and return regressions pass.
- Code and the complete immutable asset set are promoted atomically.

### Gate E — Maneuver work may resume

- The accepted ride traversal fingerprint is frozen.
- Cue geometry is regenerated from that route.
- Crossing, duplicate-turn, via-spur, and camera work references the new
  baseline rather than the forbidden historical line.
