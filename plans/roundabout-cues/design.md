# Roundabout Detection and Direction Cues — Design

**Date:** 2026-07-12
**Source:** Owner test-ride feedback on TestFlight build 5 (2026-07-11), item 6
of six ("roundabouts are not detected... sometimes it says right and then left
when you really need to continue straight"). Deferred from
`plans/navigation-ride-feedback-2/` as its own topic.

## Problem

Navigation cues are generated from route geometry corners gated by junction
nodes (`navigationCues.js`, `JUNCTION_GATE_M`). A roundabout traversal is two
arbitrary geometry corners near junction nodes, so riders hear "turn right…
turn left" where the real instruction is "straight through the roundabout".
Nothing in the pipeline knows what a roundabout is: `fetch_osm_network.py`
retains all OSM tags (including `junction=roundabout`) in the raw network,
but the compact routing shards keep only selected fields, so the information
never reaches the app.

Owner decisions during brainstorming: **direction-only instructions** (no
exit numbers), and **no shard format change** — roundabout data is app-only
(the website never navigates), so it ships as a separate artifact rather than
bloating and re-versioning all 115 shard files.

## Decisions

**C1 — Offline, tag-based detection; no geometry heuristics.**
A new processing step (`processing/build_roundabouts.py`) reads the fetched
OSM network (tags already retained), selects ways tagged
`junction=roundabout` or `junction=circular` plus nodes tagged
`highway=mini_roundabout`, merges connected/nearby rings (rings sharing nodes
or within a small merge distance are one roundabout), and emits one record
per roundabout: `{ center: { lat, lng }, radiusM }`. Mini-roundabout nodes
get a fixed small radius (10 m). No circle-detection heuristics — OSM tags
are authoritative.

**C2 — Separate promoted artifact, shards untouched.**
Output is `public-data/roundabouts.json` (compact JSON list + schemaVersion),
registered in `public-data/map-manifest.json` and included in the mobile
offline-assets sync like the routing shards. Expected size: a few thousand
records, tens of KB. The shard format, shared decoder, and website payloads
are unchanged; existing clients are unaffected.

**C3 — Route baking: roundabout clusters join `route.junctions`.**
A small pure core module (`packages/core/src/routing/roundaboutsOnRoute.js`)
exposes `roundaboutsOnRoute(clusters, routeGeometry)` — plain
point-in-circle matching of route vertices/segments against cluster circles
(with the existing grid-bucket pattern from `junctionsNearRoute.js` for
scale). At ride-confirm, where junctions are baked today
(`computeRouteJunctions` → `route.junctions`), matching clusters are appended
as `{ kind: "roundabout", lat, lng, radiusM }`; plain junction nodes gain
`kind: "junction"`. Consumers that ignore `kind` behave exactly as before.

**C4 — One entry-anchored direction cue per traversal.**
In `navigationCues.js`: corners falling inside a roundabout cluster (corner
point within `radiusM + JUNCTION_GATE_M` of the center) are suppressed and
replaced by a single cue at the route's **entry point** into the cluster —
`{ type: "roundabout", direction }`. Direction comes from the net bearing
change between the route's course entering the cluster and its course
leaving it: |Δ| < 40° → `straight`; 40–130° → `right`/`left` by sign;
> 130° → `u-turn`. A route passing near-but-not-through a cluster (no corner
inside) is untouched. Distance anchoring and announce thresholds match turn
cues.

**C5 — Voice and card copy.**
Hebrew, matching the existing turn phrasing: "בכיכר, המשיכו ישר" /
"בכיכר, פנו ימינה" / "בכיכר, פנו שמאלה" / "בכיכר, חזרו לאחור", with the same
distance prefixes as turns ("בעוד 100 מטר — בכיכר, פנו ימינה"). The cue card
shows the roundabout state with a roundabout icon and the same text.

**C6 — Rollout via the pipeline.**
`build_roundabouts.py` joins the processing chain; `roundabouts.json` reaches
production only through Build + Promote (pipeline-owned data — never
hand-edited). The app treats a missing artifact as "no roundabout data":
cues degrade to today's corner behavior, so app and data can ship in either
order.

## Non-goals

- Exit-number instructions ("צאו ביציאה השנייה") — explicitly declined; the
  artifact carries no edge topology, so upgrading later means revisiting C1/C2
  (the JSON format can grow fields without breaking).
- Shard format or shared-decoder changes.
- Lane guidance, roundabout rendering/styling on the map.
- Website changes of any kind.

## Testing

- Pipeline: `build_roundabouts.py` unit-tested on a fixture OSM extract (two
  tagged rings sharing a node merge into one cluster; a mini-roundabout node
  becomes a 10 m cluster; untagged circles are ignored). Spot-check the real
  output against a known Israeli roundabout's coordinates.
- Core (node tests): `roundaboutsOnRoute` matches a route crossing a cluster
  and rejects a route passing 30 m outside it; `navigationCues` fixtures — a
  synthetic straight-through traversal yields one `roundabout`/`straight` cue
  and no turn cues; a 90° exit yields `right`; entering and leaving the same
  leg yields `u-turn`; a route near but outside a cluster keeps its corner
  cues; missing roundabout data reproduces today's cues byte-for-byte.
- Voice/presentation: planner formats the four directions with distance
  prefixes.
- Device validation: ride a route with at least one straight-through
  roundabout and one right-exit; confirm a single correct instruction per
  roundabout and no "right… left" artifacts.
