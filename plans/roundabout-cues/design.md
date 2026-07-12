# Roundabout Detection and Direction Cues — Design

**Date:** 2026-07-12
**Source:** Owner test-ride feedback on TestFlight build 5 (2026-07-11), item 6
of six ("roundabouts are not detected... sometimes it says right and then left
when you really need to continue straight"). Deferred from
`plans/navigation-ride-feedback-2/` as its own topic.

## Problem

Navigation cues are generated from route-geometry corners gated by junction
nodes (`navigationCues.js`, `JUNCTION_GATE_M`). A roundabout traversal appears
as multiple geometry corners, so riders can hear "turn right… turn left" where
the useful instruction is "continue straight through the roundabout". The
current saved OSM snapshot retains `junction=roundabout` /
`junction=circular` way tags, but the compact routing shards do not retain
those tags. Its Overpass query did not request standalone mini-roundabout
nodes.

Owner decisions during brainstorming:

- Direction-only instructions; no exit numbers.
- No routing-shard format change.
- The target area is small enough that extracted candidates can be reviewed
  visually in the editor. Human review should therefore be an explicit data
  quality gate, not merely a one-off spot-check.

## Goals

- Detect OSM-tagged roundabouts offline without geometry classification.
- Make every published classification inspectable and manually accepted or
  rejected.
- Match routes against the tagged roundabout road shape accurately enough to
  avoid broad-circle false positives.
- Produce one entry-anchored direction cue for every complete traversal,
  including repeated visits to the same roundabout.
- Preserve today's cues when the reviewed artifact is unavailable.

## Decisions

### C1 — Local calculation from the existing OSM snapshot

Roundabout work does not fetch or update OSM. A new local-only command,
`npm run osm:roundabouts`, reads the already saved
`build/osm/overpass-response.json` plus `build/osm/overpass-query.ql` and writes
derived candidates. It never contacts Overpass, replaces the raw ways, or
rebuilds the base graph. If the saved response is absent, it fails with an
explicit instruction that an existing OSM snapshot is required; it does not
silently invoke `osm:fetch`.

`processing/build_roundabouts.py` selects available:

- ways tagged `junction=roundabout` or `junction=circular`; and
- nodes tagged `highway=mini_roundabout`, if the saved query/response contains
  them.

Ways are grouped only when they share an OSM node id. There is no automatic
"nearby within N metres" merge: proximity can merge two real neighboring
roundabouts and is better surfaced as a review warning. When mini nodes are
available, a mini close to a ring is likewise kept separate and flagged for
review. Untagged circular geometry is ignored.

The extractor records source coverage rather than treating an empty result as
proof that a class does not exist:

```json
{
  "coverage": {
    "roundaboutWays": "available",
    "circularWays": "available",
    "miniRoundaboutNodes": "not-requested-by-source"
  }
}
```

The saved query establishes whether minis were requested. Missing mini coverage
is a visible editor/Build warning but does not block reviewed ordinary
roundabouts from being published. Mini support becomes active automatically
when a future reviewed OSM snapshot includes those nodes.

### C2 — Generated candidates and human review are separate

The extractor writes the pipeline-owned file
`build/osm/roundabout-candidates.json`:

```json
{
  "schemaVersion": 1,
  "generatedAt": "...",
  "sourceDigest": "sha256:...",
  "queryDigest": "sha256:...",
  "coverage": {
    "roundaboutWays": "available",
    "circularWays": "available",
    "miniRoundaboutNodes": "not-requested-by-source"
  },
  "roundabouts": [
    {
      "id": "osm-ways:123,456",
      "fingerprint": "sha256:...",
      "classification": "roundabout",
      "memberWayIds": [123, 456],
      "sourceTags": [
        { "osmWayId": 123, "junction": "roundabout", "highway": "residential" }
      ],
      "center": { "lat": 33.1, "lng": 35.6 },
      "radiusM": 22.4,
      "bbox": [35.5997, 33.0998, 35.6003, 33.1002],
      "paths": [[[33.1, 35.5998], [33.1002, 35.6]]],
      "warnings": []
    }
  ]
}
```

For a ring, `paths` contains one or more ordered OSM road-centerline components;
it is the matching authority. The nested shape is intentional so malformed or
disconnected tagged components can be displayed and reviewed without inventing
a connecting segment.
`center`, `radiusM`, and `bbox` are derived display/index fields, not the sole
classification geometry. When mini coverage is available, a mini-roundabout
uses `classification: "mini_roundabout"`, an empty `memberWayIds`, its OSM node
id, empty `paths`, and its center point with a fixed 10 m matching radius.

`sourceTags` retains the small review-relevant subset (`junction`, `highway`,
`name`, `oneway`, and source element id); it is candidate-only and is not sent
to the app. The stable `id` is based on sorted OSM member ids. `fingerprint`
covers the classification, member ids, relevant tags, and normalized geometry.
A geometry/tag change keeps the logical id where possible but invalidates the
prior review.

Human decisions live in source-controlled, editor-owned
`data/roundabout-review.json`:

```json
{
  "schemaVersion": 1,
  "reviews": {
    "osm-ways:123,456": {
      "fingerprint": "sha256:...",
      "status": "accepted",
      "note": "",
      "reviewedAt": "..."
    }
  }
}
```

Allowed statuses are `accepted` and `rejected`. Missing decisions and
fingerprint mismatches are `pending`; review entries whose ids no longer exist
are `orphaned`. Review data never edits the generated candidates.

### C3 — Editor review is the publication gate

The editor gets a **Roundabouts** validation view with read-only candidate
geometry and a small editable review panel:

- all candidates are visible at once;
- accepted candidates are green, rejected red, pending/stale amber;
- ring centerlines and the proposed 12 m matching corridor are drawn over the
  base graph, while minis use a point marker and 10 m circle; this makes nearby
  parallel/crossing roads visible during review;
- filters show All / Pending / Accepted / Rejected / Warnings;
- selecting a row fits the map to the candidate and shows classification,
  source OSM ids/links and relevant tags, radius, fingerprint state, warnings,
  and note;
- Accept, Reject, optional note, Previous, and Next make a full review quick;
- summary counts show total, accepted, rejected, pending, stale, orphaned, and
  warning-bearing candidates; and
- a source-coverage banner states whether ordinary, circular, and mini
  roundabouts were available in the saved snapshot.

The editor API reads `build/osm/roundabout-candidates.json` and atomically
writes only `data/roundabout-review.json`. It does not mutate OSM output.

Build joins candidates with the review file. Promotion is blocked if any
candidate is pending/stale, if accepted geometry is invalid, or if the
candidate `sourceDigest` / `queryDigest` do not match the current saved OSM
response/query. Orphaned reviews warn but do not block. Rejected candidates are
deliberately omitted from runtime data.
This makes manual validation repeatable after every local recalculation and
after any future explicitly applied OSM update: unchanged fingerprints stay
accepted; only new or changed candidates require attention.

### C4 — Separate promoted runtime artifact; manifest is authoritative

Build writes `build/public-data/roundabouts.json` containing only accepted
records. Runtime records retain `id`, `classification`, `center`, `radiusM`,
`bbox`, and compact `paths`; review notes and rejected records are excluded.

The file is registered as `roundabouts` in `map-manifest.json`, its digest is in
`hashes.roundabouts`, and it participates in the manifest `version` digest.
Promote copies it like other single-file artifacts. The mobile offline sync
reads the manifest entry and generates a native `require()` only for an asset
that was actually copied.

The manifest is the only authority for availability. Neither web nor native
loads a fixed `public-data/roundabouts.json` path when `manifest.roundabouts` is
absent. Promote removes an older unreferenced runtime file when a current
manifest intentionally omits it, preventing stale-data resurrection.

The artifact is optional during rollout: an app whose manifest has no
`roundabouts` entry behaves exactly as today. The website does not consume the
data.

### C5 — Shape-based route matching produces traversal records

A pure core module,
`packages/core/src/routing/roundaboutsOnRoute.js`, matches accepted runtime
records to route geometry.

Ring candidates match by proximity to their OSM centerline, not by whether the
route enters a broad center/radius disk. A route section is inside a ring while
it stays within `RING_MATCH_M` of `paths`. Mini-roundabouts use their 10 m point
circle. Candidate lookup uses bbox/grid buckets; detailed matching uses
point/segment distance in local metres.

To reject crossings, tangencies, parallel roads, and grade-separated geometry
that only touch the shape briefly, a complete ring traversal must have a
contiguous matched route length of at least `MIN_MATCHED_ROUTE_M`. The initial
constants are conservative and exported for tests:

```text
RING_MATCH_M = 12
MIN_MATCHED_ROUTE_M = 8
COURSE_SAMPLE_OFFSET_M = 20
```

The real reviewed data and editor view are used to tune these before device
release; changing them requires fixture and scenario evidence.

Segment/shape intersections are interpolated, so entry and exit are exact
route-progress distances rather than nearest vertex indices. Each maximal
outside → inside → outside interval becomes its own route-baked record:

```json
{
  "kind": "roundabout",
  "roundaboutId": "osm-ways:123,456",
  "lat": 33.1,
  "lng": 35.6,
  "entryMeters": 410.5,
  "exitMeters": 463.2,
  "entryBearingDeg": 87.0,
  "exitBearingDeg": 91.5
}
```

Courses are sampled 20 route-metres before entry and after exit rather than
from tangent segments on the ring. If a route starts inside or ends inside,
the incomplete interval suppresses internal corner noise but does not produce
a direction cue because one course is unknowable. A route that visits the same
roundabout twice produces two records.

Plain junction nodes in `route.junctions` gain `kind: "junction"`; legacy
records without `kind` remain plain junctions.

### C6 — One entry-anchored direction cue per complete traversal

`navigationCues.js` consumes the baked traversal records. Geometry corners
whose `distanceFromStartMeters` falls between a traversal's entry and exit
(with a small exported route-distance suppression pad) emit no turn/bend cue.
Each complete traversal emits one cue at `entryMeters`:

```json
{ "type": "roundabout", "direction": "straight", "distanceMeters": 410.5 }
```

Direction is the signed bearing change from sampled entry course to sampled
exit course:

- `|Δ| < 40°` → `straight`;
- `40° ≤ |Δ| ≤ 130°` → `right` / `left` by sign;
- `|Δ| > 130°` → `u-turn`.

The inclusive boundary behavior above is deliberate and tested. Roundabout
cues have turn selection priority and use the existing turn preview/final
announcement distances.

### C7 — Voice and card copy

Hebrew copy, matching current turn phrasing:

- `straight`: "בכיכר, המשיכו ישר"
- `right`: "בכיכר, פנו ימינה"
- `left`: "בכיכר, פנו שמאלה"
- `u-turn`: "בכיכר, חזרו לאחור"

Voice uses the same distance prefixes as turns. The cue card uses the same text
and a roundabout/rotation icon already available in the app icon set. English
fallback phrases are provided by the voice planner.

## Non-goals

- Exit-number instructions or lane guidance.
- Inferring untagged circles from geometry.
- Editing OSM classifications from the CycleWays editor. Rejecting a candidate
  is a local runtime decision; upstream OSM correction is separate.
- Routing-shard or shared-decoder changes.
- Roundabout styling in the public website or mobile map.
- Fetching fresh OSM data, replacing the current OSM snapshot, calculating a
  whole-network OSM diff, or reconciling changed upstream edges with manual
  base-network edits. Those belong to the separate staged update workflow
  below.

## Deferred Follow-up — Staged OSM Update

A future `npm run osm:update` must not overwrite the current base-network source
as part of fetching. It should:

1. Fetch into a staging directory such as `build/osm-update/staged/`.
2. Compare current and staged data by OSM element id plus normalized tag and
   geometry fingerprints.
3. Report added, removed, tag-changed, and geometry-changed ways/nodes.
4. Identify accepted overlay references and manual overrides affected by those
   changes, using OSM identity rather than unstable generated slice indices.
5. Show Current / Staged / Diff layers and an affected-items list in the editor.
6. Require an explicit **Apply OSM Update** action before atomically replacing
   the current snapshot and rebuilding graph/matches.
7. Return changed roundabout fingerprints to pending/stale review.

This workflow is intentionally not implemented by the roundabout-cues plan.
Until it exists, `osm:fetch` remains an explicit owner action with its current
behavior, and `osm:roundabouts` remains strictly local.

## Validation and Testing

### Pipeline and review

- Local-source tests prove `osm:roundabouts` performs no network operation,
  fails clearly without a saved response, and reports mini coverage from the
  saved query rather than guessing from a zero count.
- Extraction fixtures cover split ways sharing node ids, nearby distinct rings,
  circular junctions, optional minis when present, stable fingerprints,
  malformed geometry, and deterministic output.
- Review join tests cover accepted, rejected, pending, stale, and orphaned
  decisions; pending/stale blocks Promote.
- Build/manifest tests cover digest/version participation and current-source
  provenance.
- Promote and offline-sync tests cover present, absent, and formerly-present
  artifacts without stale files or broken native `require()` calls.
- Initial owner review in the editor accepts/rejects every candidate, checks
  every warning-bearing record, and acknowledges the displayed source coverage
  before the first promotion.

### Core and navigation

- Shape matcher tests: ordinary traversal, sparse segment interpolation,
  tangent rejection, short crossing rejection, nearby parallel road, optional
  mini fixture, repeated traversal, start-inside, end-inside, and malformed
  records.
- Cue tests: straight/right/left/u-turn, exactly 40° and 130°, one cue per
  traversal, interval-based corner suppression, incomplete traversals, and
  missing-data byte-for-byte compatibility.
- Voice/presentation tests cover four directions and preview distance prefixes.

### Manual release validation

1. In the editor Roundabouts view, review all pending/stale candidates and scan
   the accepted set at whole-area zoom for obvious duplicates or bad extents;
   confirm the source-coverage banner states the expected mini limitation.
2. Build; confirm the report shows zero pending/stale reviews and the accepted /
   rejected counts match the editor.
3. In navigation scenarios, inspect at least one accepted straight, right,
   left, and repeated traversal if present in local data.
4. On the next TestFlight ride, ride a straight-through roundabout and a
   right-exit roundabout; confirm one correct instruction per traversal and no
   "right… left" artifacts.
