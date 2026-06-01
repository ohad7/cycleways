# CycleWays-edge snap preference

Date: 2026-06-01
Status: approved, implementing

## Problem

Snapping a clicked or dragged route point picks the **geometrically closest**
base-graph edge (`route-manager.js` → `_snapToBaseRoutingNetwork`), with no
class preference. Where a CycleWays path runs alongside or near a road, the
endpoint snaps to whichever line is physically closest — often the road — so the
route can ignore the parallel cycleway entirely. (Routing *traversal* already
prefers CW via `_baseRoutingCostMultiplier`, but endpoint *attachment* does not.)

## Decisions

- **Scope:** shared core (`packages/core/route-manager.js`). The snap is reached
  through `useCyclewaysApp`, which drives **both** the website (`src/App.jsx`)
  and the iPhone app (`apps/mobile/src/MapScreen.jsx`), so the fix applies to
  both. No mobile-only divergence.
- **Strategy — tolerance tie-break:** while scanning candidate edges, track both
  the closest edge overall and the closest **CW** edge. If the closest CW edge is
  within `CW_SNAP_PREFERENCE_MARGIN_METERS` (default **20 m**, tunable) of the
  closest edge overall, snap to the CW edge; otherwise snap to the truly-closest.
  This favours the CycleWays network when it is a plausible alternative without
  yanking the point onto a cycleway that is clearly far away.
- **CW edge definition:** `edge.cwSegmentIds.length > 0` (matched to a real
  CycleWays segment).
- **Surface:** only `_snapToBaseRoutingNetwork` (the active base-routing path).
  The legacy `_snapToNearestSegment` is unchanged. Because click and
  drag-release share the same snap, both gain the preference.

## Testing

New `tests/test-route-manager-cw-snap.mjs`:

1. A road edge is geometrically nearer than a parallel CW edge, but the CW edge
   is within the margin → snaps to the CW edge.
2. The CW edge is beyond the margin while a road is right under the click →
   snaps to the road (fallback preserved).

Keep `test-route-manager-snap.js` and `test-base-routing-network.mjs` green; add
the new test to the `test` script.
