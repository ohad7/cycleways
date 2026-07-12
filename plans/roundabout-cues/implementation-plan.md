# Roundabout Detection and Direction Cues — Implementation Plan

**Date:** 2026-07-12
**Goal:** Implement `plans/roundabout-cues/design.md` C1–C7: local candidate
extraction from the saved OSM snapshot, editor-owned human review, reviewed
shape-based runtime data, route-relative traversal records, and one
direction-only cue per complete roundabout traversal.

**Architecture:** A local-only `osm:roundabouts` command produces deterministic
candidates from the existing saved Overpass response/query without fetching or
rebuilding the base graph. The editor displays every candidate, source coverage,
and accept/reject decisions. Build joins candidates with reviews, blocks
publication on pending/stale decisions, and publishes only accepted shapes
through the manifest. A pure core matcher turns accepted shapes into
route-relative traversal intervals; navigation cues suppress interval corners
and announce at entry. The manifest—not file existence—is the runtime
availability authority.

**Tech stack:** Python 3 processing scripts and plain-assert tests; editor
Node server + vanilla browser UI/Mapbox; `@cycleways/core`; React Native mobile
offline assets; node test scripts under `tests/`.

**Implementation status (2026-07-12):** Code and automated tests are complete.
`npm run osm:roundabouts` produced 349 candidates from the saved snapshot, with
mini coverage correctly reported as `not-requested-by-source`. The editor view
was visually verified with no browser errors. Owner accept/reject review,
Build/Promote of the reviewed artifact, asset sync after promotion, and
TestFlight ride validation remain operational rollout steps. `npm run build`,
the roundabout suites, and the navigation-camera suite pass. The full `npm test`
run reaches an unrelated existing typography-guard failure in
`src/pages/StickerRedirectPage.jsx`.

## Global Constraints

- Never hand-edit generated files under `build/` or `public-data/`.
- Human decisions belong only in `data/roundabout-review.json` and are written
  atomically by the editor.
- Preserve existing website behavior and routing-shard formats.
- Do not modify `fetch_osm_network.py`, invoke `osm:fetch`, contact Overpass, or
  replace/rebuild the current OSM/base graph in this plan.
- Records without `kind` in restored routes remain legacy plain junctions.
- Use exact shape/progress calculations in pure modules; keep server/UI layers
  thin and testable.
- Commit generated mobile asset maps only when the repository's existing
  offline-asset workflow requires them; never add a `require()` for a missing
  optional asset.
- Finish with `node tests/test-mobile-undefined-references.mjs` and the full
  relevant node/Python suites.

---

## Task 1 — Local snapshot command and coverage contract (C1)

**Files**

- Create `processing/build_roundabouts.py`.
- Create `processing/test_build_roundabouts.py`.
- Modify `package.json` to add only the independent `osm:roundabouts` target.

**Steps**

- [ ] Add `npm run osm:roundabouts` as
  `python3 processing/build_roundabouts.py`. Do not append it to `osm:fetch` or
  any Build dependency chain.
- [ ] Give the script local defaults for
  `build/osm/overpass-response.json`, `build/osm/overpass-query.ql`, and
  `build/osm/roundabout-candidates.json`.
- [ ] Fail clearly when the saved response/query is absent. The error may tell
  the owner that an existing OSM snapshot is required, but must never fetch it.
- [ ] Compute response and query digests. Determine coverage from the saved
  query: ordinary/circular ways are available when their encompassing highway
  way query is present; minis are `available` only when the query explicitly
  requested `highway=mini_roundabout`, otherwise
  `not-requested-by-source`.
- [ ] Emit schema/version/source/coverage metadata even when no candidates of an
  available class are found, so “zero found” and “not requested” remain distinct.
- [ ] Add tests that patch/guard network APIs or otherwise prove the command has
  no network path; test missing files, present/absent mini selector, digests,
  and deterministic coverage output.

**Acceptance**

- Running `osm:roundabouts` changes only its derived candidate output.
- It does not change raw OSM, intersections, the base graph, or matches.
- The current snapshot reports mini coverage as `not-requested-by-source`
  rather than an authoritative zero.

---

## Task 2 — Deterministic candidate extraction and accurate shape model (C1–C2)

**Files**

- Continue `processing/build_roundabouts.py` and its focused test.

**Interfaces**

```text
extract_roundabout_candidates(overpass_data, source_coverage)
  -> { schemaVersion, sourceDigest, queryDigest, coverage, roundabouts }

CLI:
  --overpass build/osm/overpass-response.json
  --query build/osm/overpass-query.ql
  --out build/osm/roundabout-candidates.json
```

**Steps**

- [ ] Normalize selected ways from their OSM node-id list and `geometry`.
  Reject malformed/non-finite elements with a counted warning rather than
  emitting unusable runtime records.
- [ ] Group roundabout ways only through shared OSM node ids using union-find.
  Do not proximity-merge separate groups.
- [ ] Order connected member-way coordinates into deterministic path
  components. Preserve separate components explicitly if malformed topology
  cannot form one chain; add a `disconnected_components` warning.
- [ ] Emit stable ids from sorted member way ids (`osm-ways:...`). When mini
  coverage is available, emit minis from their node id (`osm-node:...`).
- [ ] Derive center, maximum display radius, bbox, compact `[lat,lng]` paths,
  classification, member ids, warnings, and candidate-only review tags
  (`junction`, `highway`, `name`, `oneway`, source id). When present, minis use
  a fixed 10 m radius.
- [ ] Compute `fingerprint` from normalized classification/member ids/geometry,
  and `sourceDigest` from normalized relevant saved-response elements. Preserve
  Task 1's query digest and coverage; sort all output deterministically.
- [ ] Warn—without merging—when candidate bounds overlap or candidates are
  unusually close, unusually large, disconnected, or non-closed.
- [ ] Add fixture tests for shared-node split rings, close but distinct rings,
  `junction=circular`, optional mini nodes when coverage is available,
  deterministic ordering/fingerprints, changed-geometry fingerprint
  invalidation, malformed geometry, and warnings.

**Acceptance**

- Re-running unchanged input is byte-stable except `generatedAt` (or tests
  compare the deterministic content excluding it).
- No network or base-graph output changes when the calculation runs.
- Candidate paths visibly follow tagged OSM road centerlines.

---

## Task 3 — Review model and validation join (C2–C3)

**Files**

- Create `processing/roundabout_review.py` (pure normalization/join helpers).
- Create `processing/test_roundabout_review.py`.
- Create `data/roundabout-review.json` with schema version 1 and empty reviews.
- Create `tests/fixtures/roundabout-review-cases.json` as language-neutral
  conformance cases for Python Build code and the JavaScript editor helper.

**Interfaces**

```text
join_roundabout_reviews(candidates, review_data)
  -> {
       accepted,
       rejected,
       pending,
       stale,
       orphaned,
       warnings,
       blockingIssues
     }
```

**Steps**

- [ ] Validate review schema and normalize records keyed by stable candidate id.
- [ ] A decision applies only when its fingerprint exactly matches the current
  candidate. Missing decisions are pending; mismatches are stale.
- [ ] Accepted candidates feed runtime output; rejected candidates do not.
  Orphaned reviews warn but do not block.
- [ ] Invalid status, duplicate ids, invalid fingerprints, and invalid accepted
  geometry are blocking issues.
- [ ] Test every state transition, including an accepted candidate becoming
  stale after geometry changes and returning to accepted after re-review.
- [ ] Put the canonical accepted/rejected/pending/stale/orphaned cases and
  expected summary/blocker results in the shared fixture. Task 4's JavaScript
  helper must pass the same cases, preventing the editor display and Build gate
  from assigning different states.

**Acceptance**

- The join result is deterministic and contains enough detail for both the
  editor summary and Build/Promote validation.

---

## Task 4 — Editor Roundabouts validation view (C3)

**Files**

- Modify `editor/server.mjs`.
- Modify `editor/index.html`, `editor/editor.js`, and `editor/styles.css`.
- Add a small pure editor helper if useful, for example
  `editor/lib/roundaboutReview.mjs`.
- Add/extend focused editor API and UI-helper node tests.

**Server API**

- `GET /api/roundabouts/review` reads candidates plus reviews, runs the review
  join, and returns candidate GeoJSON/display data, individual review states,
  summary counts, warnings, source freshness, and coverage.
- `POST /api/roundabouts/review` accepts one `{ id, fingerprint, status, note }`
  decision, validates it against the current candidate, merges it without
  dropping other decisions, updates `reviewedAt`, and atomically writes
  `data/roundabout-review.json`.
- Reject unknown ids, stale fingerprints, invalid statuses, and oversized
  notes with `400`. Do not expose arbitrary file paths.

**Editor UI**

- [ ] Add a **Roundabouts** workspace/view using the existing editor map and
  workspace conventions.
- [ ] Draw ring centerlines prominently plus the proposed 12 m matching
  corridor over the base graph; draw minis as points with 10 m circles.
- [ ] Color accepted green, rejected red, pending/stale amber. Warnings get a
  visible badge or casing independent of review status.
- [ ] Add All / Pending / Accepted / Rejected / Warnings filters and counts.
- [ ] Add a persistent source-coverage banner. In the current snapshot it must
  say that ordinary/circular tagged ways are covered and mini-roundabout nodes
  were not requested; do not present minis as a verified zero.
- [ ] Add a keyboard-friendly review list. Selecting a row fits the candidate
  and opens details: id, classification, member ids with OpenStreetMap links,
  relevant tags, radius, warning list, fingerprint state, status, and note.
- [ ] Add Accept, Reject, Previous, and Next. Saving advances to the next item
  under the active filter so reviewing the full area is fast.
- [ ] Never edit generated candidate geometry from this view.
- [ ] Handle missing/stale candidate files with an explicit “run
  `npm run osm:roundabouts`” state rather than an empty-success state. Never
  offer or trigger a network fetch from this view.

**Tests and manual check**

- [ ] Test API read/join, atomic decision merge, validation failures, and that
  one update preserves unrelated reviews.
- [ ] Test the JavaScript review join against
  `tests/fixtures/roundabout-review-cases.json`, then test pure
  filter/count/color/view-model helpers.
- [ ] Open the editor, scan all candidates at whole-area zoom, then review a
  small accepted/rejected/pending fixture set and confirm filters and Next work.

**Acceptance**

- The owner can review every candidate without opening raw JSON or another map.
- Re-running the local calculation keeps unchanged decisions. If an OSM
  snapshot is explicitly replaced in the future, changed candidates clearly
  return to stale/pending review.

---

## Task 5 — Build, manifest, Promote, and offline lifecycle (C3–C4)

**Files**

- Modify `processing/build_map.py` and its focused tests.
- Modify `editor/server.mjs` and `tests/test-editor-promote-targets.mjs`.
- Modify `apps/mobile/scripts/sync-offline-assets.mjs` and its tests.
- Modify `packages/core/src/data/mapAssets.js` and
  `tests/test-map-assets.mjs`.

**Steps**

- [ ] During Build, load current candidates and reviews via the Task 3 join.
  Include review counts and blocking issues in the validation report.
- [ ] Prove candidate `sourceDigest` and `queryDigest` correspond to the current
  saved Overpass response/query. Missing/stale candidates and pending/stale
  reviews block promotion.
- [ ] Include coverage in the validation report and runtime artifact metadata.
  `miniRoundaboutNodes: not-requested-by-source` is a prominent warning but not
  a blocker for reviewed ordinary/circular candidates.
- [ ] Write compact `build/public-data/roundabouts.json` from accepted records
  only. Exclude candidate-only source tags, review status/note, and rejected
  candidates.
- [ ] Add `roundabouts` and `hashes.roundabouts` to `map-manifest.json`; include
  the file in the combined version digest.
- [ ] Add a conditional single-file Promote target. When the new manifest
  intentionally omits the optional key, remove an older unreferenced
  `public-data/roundabouts.json` during Promote cleanup.
- [ ] Extend Promote tests for present, absent, blocking-review, and stale-file
  cases.
- [ ] Make `loadMapAssets` load the manifest-relative/versioned file only when
  `manifest.roundabouts` exists and expose `roundaboutsData`; on absence expose
  `null`. Do not probe a fixed filename.
- [ ] Make offline sync derive the optional entry from the manifest. Track only
  successfully copied assets when generating `bundledAssets.native.js`, so an
  absent optional file never creates a broken `require()`.
- [ ] Test web/native injected asset loading and offline sync with the artifact
  present, absent, and formerly present.

**Acceptance**

- Manifest absence means no runtime data even if an obsolete physical file was
  present before Promote.
- Changing accepted roundabout data changes the manifest version.
- Promote cannot publish unreviewed or changed classifications.

---

## Task 6 — Shape matcher and route-relative traversal records (C5)

**Files**

- Create `packages/core/src/routing/roundaboutsOnRoute.js`.
- Create `tests/test-roundabouts-on-route.mjs`.

**Interface**

```text
roundaboutsOnRoute(roundabouts, routeGeometry, options?)
  -> one { kind: "roundabout", roundaboutId, lat, lng,
           entryMeters, exitMeters, entryBearingDeg, exitBearingDeg,
           complete } per maximal traversal interval
```

Use exported defaults `RING_MATCH_M = 12`, `MIN_MATCHED_ROUTE_M = 8`, and
`COURSE_SAMPLE_OFFSET_M = 20`.

**Steps**

- [ ] Reuse existing route-progress interpolation/projection utilities where
  their contracts fit; add small pure local-metre helpers rather than vertex
  approximations where they do not.
- [ ] Bucket candidates by bbox/grid cells, then calculate detailed proximity
  between route segments and ring-path segments. Minis use the 10 m point
  circle.
- [ ] Clip/interpolate boundary crossings into exact route-progress distances.
  Produce every maximal matched interval, not merely the first candidate hit.
- [ ] Reject complete intervals whose matched route length is below
  `MIN_MATCHED_ROUTE_M`.
- [ ] Sample entry/exit course at `COURSE_SAMPLE_OFFSET_M` outside the interval.
  Mark start-inside/end-inside intervals incomplete when a course is missing.
- [ ] Return a separate record when the route encounters the same id again.
- [ ] Ignore malformed records safely and keep deterministic route order.

**Tests**

- Ordinary ring traversal with interpolated boundaries.
- Sparse segment crossing the shape.
- Tangent and short perpendicular crossing rejected.
- Nearby parallel road rejected.
- Mini-roundabout traversal.
- Two visits to the same roundabout produce two records.
- Start-inside and end-inside produce incomplete records.
- Multiple nearby candidates remain distinct.
- Degenerate geometry and malformed artifact records are safe.
- A representative long route × real candidate-count performance check stays
  comfortably within ride-confirm latency; record the measured threshold in
  the test or task notes.

---

## Task 7 — Bake traversals into `route.junctions` (C5 wiring)

**Files**

- Modify `packages/core/src/routing/junctionsNearRoute.js`.
- Modify `packages/core/src/app/useCyclewaysApp.js`.
- Extend `tests/test-junctions-near-route.mjs` and app/controller tests.

**Steps**

- [ ] Add `kind: "junction"` to newly computed plain junction records. Treat
  restored records without `kind` as plain junctions elsewhere.
- [ ] Read reviewed runtime data from `state.assets.roundaboutsData`; do not add
  an independent fixed-path loader or second cache.
- [ ] `computeRouteJunctions(geometry)` awaits ordinary junctions, computes all
  roundabout traversal records with Task 6, and returns their concatenation.
  Missing/null data returns today's junction result unchanged apart from the
  additive `kind` on newly computed records.
- [ ] Verify built, restored, featured/recommended, and edited routes all pass
  through the same ride-confirm baking path or add the missing wiring/tests.

**Acceptance**

- Every navigation route contains the traversal records it needs without
  retaining the nationwide artifact.
- Missing data and legacy persisted routes remain safe.

---

## Task 8 — Interval-based cue generation (C6)

**Files**

- Modify `packages/core/src/navigation/navigationCues.js`.
- Extend `tests/test-navigation-cues.mjs`.

**Steps**

- [ ] Split plain junctions from `kind: "roundabout"` traversal records;
  records without kind remain plain.
- [ ] Suppress turn/bend corners whose route-progress distance lies inside any
  traversal interval plus a small exported route-distance suppression pad.
- [ ] For every complete traversal, compute signed entry→exit bearing delta and
  emit one `{ type: "roundabout", direction, distanceMeters: entryMeters }`.
- [ ] Implement/test exact thresholds: `< 40` straight, `40..130` left/right,
  `> 130` U-turn.
- [ ] Do not emit a direction cue for incomplete traversals, but still suppress
  their internal geometry noise.
- [ ] Give `roundabout` turn selection/sort priority. Ensure span-boundary merge
  logic does not attach or duplicate an enter-segment cue inside a traversal.

**Tests**

- Straight, right, left, and U-turn.
- Exactly 40° and 130°.
- Two traversals of the same id produce two cues.
- Incomplete start/end traversal suppression without a false cue.
- Existing near-roundabout corner cues are unchanged when no traversal record
  was baked.
- Missing roundabout data reproduces pre-feature cues byte-for-byte.
- Navigation session and haptics safely carry the new cue type.

---

## Task 9 — Voice and presentation (C7)

**Files**

- Modify `packages/core/src/navigation/navigationVoice.js`.
- Modify `packages/core/src/navigation/navigationPresentation.js`.
- Extend `tests/test-navigation-voice.mjs` and
  `tests/test-navigation-presentation.mjs`.

**Steps**

- [ ] Add Hebrew and English fallback phrases for straight/right/left/U-turn.
- [ ] Reuse the existing preview distance-prefix behavior.
- [ ] Add a roundabout cue-card case with the same Hebrew primary text and the
  closest verified icon from the current app icon set.
- [ ] Test all four directions, preview/final voice behavior, text, icon, and
  unknown-direction defensive fallback.

---

## Task 10 — Full validation and rollout

- [ ] Run all focused Python tests from `processing/` and all affected node
  tests from the repository root.
- [ ] Run the complete node test suite and
  `node tests/test-mobile-undefined-references.mjs`.
- [ ] Run `npm run osm:roundabouts` against the existing saved snapshot; inspect
  count, coverage, warnings, largest radii, closest pairs, and malformed
  records. Confirm timestamps/digests for raw OSM and base-graph files are
  unchanged.
- [ ] In the editor Roundabouts view, have the owner accept/reject every pending
  or stale candidate, acknowledge source coverage, and scan warning-bearing
  candidates. Record coverage plus accepted/rejected/warning counts in the task
  completion note.
- [ ] Build locally and confirm validation counts, manifest hash/version, and
  accepted-only runtime output. Do not Promote unless the owner requests it.
- [ ] Run representative navigation scenarios for straight/right/left/U-turn
  and a repeated traversal if the local network contains one.
- [ ] For TestFlight, sync offline assets after reviewed data is promoted. Ride
  at least one straight-through and one right-exit roundabout and confirm one
  correct instruction per traversal with no corner-noise pair.

## Rollout Order

The app can ship before the reviewed artifact: manifest absence preserves
today's behavior. The artifact may also be promoted before an app understands
it: older clients ignore the manifest key. After the first reviewed artifact is
published, future OSM changes become pending/stale in the editor and block
promotion until reviewed, preventing silent classification drift.

## Explicitly Deferred — `osm:update`

Do not implement OSM fetching/diff/application as part of these tasks. A future
plan should add an independent `osm:update` workflow that fetches into staging,
calculates identity/tag/geometry and manual-override impact diffs, shows Current
/ Staged / Diff editor layers, and requires explicit Apply before replacing the
current snapshot. The design document records its required safety contract.
