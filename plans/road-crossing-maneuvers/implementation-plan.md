# First-class road-crossing maneuvers — implementation plan

**Date:** 2026-07-14
**Status:** planned; implementation not started
**Design:** `plans/road-crossing-maneuvers/design.md`

## Delivery strategy

Implement the narration concept without changing route search cost. Land the
work in vertical slices so route-context propagation, cue semantics and rider
presentation each have deterministic tests before the real-ride replay is
updated.

The likely production changes are concentrated in:

- `packages/core/route-manager.js`;
- shared route snapshot/reducer/action/navigation-route modules;
- `packages/core/src/navigation/effectiveNavigationRoute.js`;
- a new `packages/core/src/navigation/roadCrossings.js`;
- cue, voice, presentation, haptic and camera shared-core modules;
- `apps/mobile/src/planner/ManeuverIcon.jsx`;
- navigation unit, scenario and Road 99 replay tests.

## Phase 0 — lock the corrected baseline

- [ ] Preserve the current strict Road 99 coordinate replay as the integration
      fixture: about 10,111.6 m, directionally attested, no old via-point gap or
      spur.
- [ ] Record the current maneuver facts before modifying the builder:
      19 ordinary turns; the remaining right/left pair around
      3,822–3,838 m; the following straight roundabout.
- [ ] Add or retain small geometry fixtures for the original pure 87°/87°
      crossing even though the corrected route no longer traverses that old
      path.
- [ ] Run the cue, voice, presentation, haptic, camera, effective-route and
      navigation-scenario suites as a baseline.

**Exit:** failures after this point can be attributed to the crossing change,
not to stale expectations from the earlier route.

## Phase 1 — add route-context spans

- [ ] Add a pure `buildRouteContextSpans(traversals)` helper next to
      `buildSegmentSpans`.
- [ ] Derive deterministic fields: start/end meters, route class, highway,
      road type, source, CW-network membership and stable edge share IDs.
- [ ] Merge only adjacent spans whose classification fields match; do not
      change the name-oriented merge semantics of `segmentSpans`.
- [ ] Return the spans from every successful `RouteManager.getRouteInfo()`
      path, including restored base routes.
- [ ] Propagate and clone the field through:
  - [ ] empty route state and route reducer;
  - [ ] route snapshots/actions and the app controller snapshot boundary;
  - [ ] built/catalog navigation-route construction;
  - [ ] any scenario/fixture route shape that explicitly models the full
        navigation-route contract.
- [ ] Reconcile span distance totals against navigation geometry as is done
      for `segmentSpans`.
- [ ] Include the normalized spans in `navigationPlanFingerprint`.

**Tests**

- [ ] Ordered spans have continuous, monotonic distances and end at route
      distance.
- [ ] A track → short manual paved connector → trunk road produces separate
      spans.
- [ ] Metadata-only changes alter the navigation-plan fingerprint.
- [ ] Legacy routes with no spans remain valid.

**Exit:** the current Road 99 replay exposes road context across the remaining
crossing without changing route geometry or attestation.

## Phase 2 — make context survive effective-route transforms

- [ ] Generalize or reuse span transform helpers in
      `effectiveNavigationRoute.js` for `routeContextSpans`.
- [ ] Reverse ordering and distances on exact reverse.
- [ ] Clip spans for a selected linear start point.
- [ ] Split/rotate spans for a selected start on a circular route.
- [ ] Clone spans rather than sharing mutable references between source and
      effective routes.
- [ ] Ensure an app-owned approach or rejoin route carries spans when its
      computed route info provides them.

**Tests**

- [ ] forward clone, exact reverse, mid-route clip and loop rotation;
- [ ] a span crossing the loop seam splits into two valid intervals;
- [ ] no output span lies outside effective route distance;
- [ ] invalid reverse policy still fails for policy reasons, not because of
      context metadata.

**Exit:** crossing detection can always run against the geometry actually being
navigated.

## Phase 3 — implement the pure detector

- [ ] Create `roadCrossings.js` with named, documented calibration constants.
- [ ] Accept cleaned cue geometry, raw corner candidates, roundabout intervals
      and optional route-context spans.
- [ ] Compute robust incoming/outgoing bearings over distance arms rather than
      adjacent vertices.
- [ ] Recognize only opposite-direction pairs within the length and angle
      envelope.
- [ ] Implement the two confidence paths:
  - [ ] general envelope plus motor-road context;
  - [ ] stricter near-zero-net geometry fallback.
- [ ] Reject roundabout overlap, same-direction pairs, U-shapes, insufficient
      arms and non-consecutive decisions.
- [ ] Return stable `source`, `confidence` and `reasonCode` diagnostics for
      accepted candidates.
- [ ] Keep rejected-candidate diagnostics available to tests/replay tooling,
      but do not place them in normal cue lists.

**Positive tests**

- [ ] 87° right + 87° left, 12 m apart, zero net change;
- [ ] mirror-direction version;
- [ ] current 112° right + 74° left with road context;
- [ ] a crossing drawn inside a single CW polyline that meets the strict
      geometry-only gate;
- [ ] deterministic output with sub-metre duplicates already removed.

**Negative tests**

- [ ] same-direction split turn;
- [ ] normal S-bend/chicane without road context;
- [ ] switchback/U-shape;
- [ ] two decisions at adjacent junctions;
- [ ] pair too long or too short;
- [ ] pair with excessive net heading change;
- [ ] corner inside a roundabout interval;
- [ ] paved path with no evidence of a crossed road;
- [ ] truncated effective route containing only one side of a crossing.

**Exit:** classification is pure, explainable and conservative before it can
change any rider output.

## Phase 4 — integrate the cue model

- [ ] Run crossing recognition after corner/roundabout extraction and before
      same-direction merge and compound linking.
- [ ] Replace both accepted corner cues with one `crossing` cue; never mutate
      route geometry.
- [ ] Preserve start and completion distances and the diagnostic entry
      direction.
- [ ] Add `crossing` to maneuver priority and active-cue selection.
- [ ] Treat crossing as compound-capable, measuring the following gap from
      `completionDistanceMeters`.
- [ ] Support crossing → turn and crossing → roundabout in `thenManeuver`.
- [ ] Keep the following cue in the cue list and retain guarded follow-up
      suppression.
- [ ] Let named-segment merge logic consider crossing completion where relevant
      without attaching a fake left/right direction.
- [ ] Bump `maneuverGeneratorVersion` from `navigation-cues-v2` to
      `navigation-cues-v3` and update fallback/default expectations.

**Tests**

- [ ] one accepted pair becomes exactly one cue;
- [ ] crossing completion controls compound distance;
- [ ] crossing followed by a 60 m-away roundabout compounds; 60 m + epsilon
      does not;
- [ ] the following cue remains independently selectable;
- [ ] persisted v2/v3 fingerprints differ deterministically;
- [ ] no cue contains raw edge IDs.

**Exit:** the shared cue list expresses the maneuver correctly and survives
restore/version boundaries.

## Phase 5 — voice and presentation

- [ ] Add Hebrew and English crossing phrases to `navigationVoice.js`.
- [ ] Add crossing handling to compound phrase generation in both source and
      following positions where supported.
- [ ] Verify preview includes formatted distance and final does not.
- [ ] Preserve the existing rule that a following cue is suppressed only after
      the compound source utterance was accepted.
- [ ] Add crossing text and maneuver descriptors to
      `navigationPresentation.js`.
- [ ] Represent the following turn/roundabout in the secondary card row.
- [ ] Add a dedicated transverse-road crossing glyph to
      `ManeuverIcon.jsx`; include an accessible textual label at the card level
      even though the SVG remains decorative.
- [ ] Keep a safe generic fallback for any renderer that has not added the
      glyph yet.

**Tests**

- [ ] Hebrew/English preview and final copy;
- [ ] crossing → straight roundabout and crossing → left/right turn copy;
- [ ] voice dedupe IDs use `crossing` and remain phase-specific;
- [ ] rejected/unsaid compound source does not silence the following cue;
- [ ] primary and secondary presentation descriptors match the cue contract.

**Exit:** the rider sees and hears “cross the road,” never a turn arrow or
right/left phrase for an accepted crossing.

## Phase 6 — haptics and camera

- [ ] Confirm the generic maneuver haptic path yields light preview and medium
      final for `crossing`; add explicit tests so future defaults cannot change
      it accidentally.
- [ ] Include `crossing` in camera-director near-maneuver eligibility.
- [ ] Focus the pre-maneuver camera at crossing start without adding a new
      camera owner/stage.
- [ ] Ensure the C1 500 ms padding transition continues uninterrupted when a
      crossing becomes the first active maneuver.

**Tests**

- [ ] haptic preview/final intensity and cooldown;
- [ ] camera stage transition and target distance;
- [ ] no camera snap regression when the crossing preview becomes active.

**Exit:** crossing feels like a normal important maneuver and reuses the
settled camera architecture.

## Phase 7 — real-route and shared-path validation

- [ ] Recreate the current Road 99 route from the recorded coordinates using
      strict directed routing.
- [ ] Assert route distance remains within the existing replay tolerance around
      10,111.6 m and route attestation remains valid.
- [ ] Assert around 3,822–3,838 m:
  - [ ] no literal right/left pair remains;
  - [ ] exactly one road-crossing cue exists;
  - [ ] the following straight roundabout exists;
  - [ ] compound text includes both actions when scheduled from the crossing.
- [ ] Assert the cue delta is 19 → 17 ordinary turns plus one crossing; do not
      weaken the test to a total-count-only assertion.
- [ ] Assert the old Tel Hai false cue stays absent.
- [ ] Exercise the same cue builder through:
  - [ ] a main navigation route;
  - [ ] an app-owned approach leg;
  - [ ] a routed rejoin leg;
  - [ ] exact reverse where policy permits;
  - [ ] restored route/session construction.
- [ ] Protect the successful field-navigation portion of the original ride
      from new crossing false positives.

**Exit:** the change solves the actual remaining ride symptom without changing
the route or other good guidance.

## Phase 8 — corpus calibration and regression gate

- [ ] Add a deterministic audit command/test helper that prints each accepted
      candidate with route name, distances, geometry metrics, context and reason
      code.
- [ ] Run it across navigation scenarios, recommended/catalog route fixtures
      that can be restored offline, and the original ride replay.
- [ ] Treat unexpected geometry-only acceptances as release blockers until
      represented by a named positive fixture or rejected by a refined rule.
- [ ] Add every discovered false positive as a permanent negative fixture.
- [ ] Run focused tests followed by full `npm test` and `git diff --check`.
- [ ] Update the original discussion status and record exact replay results.

**Exit:** automated evidence supports the detector thresholds; there are no
unexplained accepted candidates in the available offline corpus.

## Phase 9 — manual acceptance (explicitly pending while remote)

- [ ] In SIM, approach the crossing at normal replay speed and verify preview
      timing, card hierarchy, glyph, compound roundabout reminder and camera
      framing.
- [ ] Listen once with the screen active and once with lock-screen/background
      voice enabled.
- [ ] Confirm the roundabout is still announced if the crossing utterance is
      skipped, interrupted or starts inside the final window.
- [ ] Record device/simulator version, route fingerprint and result in the
      implementation record.

This gate may remain marked pending until local access is available. Automated
completion must not be presented as physical/manual acceptance.

## Deferred follow-up — confirmed crossing topology and route cost

Do not implement a routing penalty in the phases above. Open a separate design
update only after the maneuver detector and audit have produced useful crossing
candidates. That update must specify:

- the logical crossing registry and multiple-base-edge mapping format;
- editor candidate/confirmed/rejected workflow;
- build artifact and digest/version propagation;
- cost application in route building, approach and rejoin;
- route-delta, no-path and two-crossing far-side-network reports;
- click-snap interaction across parallel carriageways.

Only confirmed records may affect path search. Inferred cue candidates remain
non-authoritative.

## Completion checklist

- [ ] Design invariants are represented by tests, not comments alone.
- [ ] No route-choice cost changed.
- [ ] Road 99 route length and legal attestation are unchanged.
- [ ] Remaining false turn pair is one crossing cue.
- [ ] Following roundabout remains independently safe to announce.
- [ ] Main, approach and rejoin cue paths are covered.
- [ ] Navigation cue version/fingerprint is bumped.
- [ ] Focused and full automated suites pass.
- [ ] Corpus audit has no unexplained acceptance.
- [ ] Manual SIM/device validation is recorded or explicitly pending.
