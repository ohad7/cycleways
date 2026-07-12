# Reported Route Cue Verification

Date: 2026-07-10

The two rider-provided share tokens were decoded with the current production
route decoder and inspected with `scripts/inspect-route-cues.mjs`. The script
loaded every compact base-routing shard intersecting a 0.01-degree padded route
bounds and compared legacy cue generation (`junctions: null`) with cues built
from the derived, complete junction set.

## Token `T4kEVAKs8H14e89Eo5k65VDmVm9ueEqbt5imKejv5W2pjqVA33x`

- Geometry: 17 points, 1,271 m.
- Network input: 4 shards; 2 degree-3-or-greater junctions within 50 m of the
  route.
- Legacy result: 4 cues total — start, two turns, arrival.
- Legacy turn details: left 44° at 355 m and left 52° at 894 m.
- Junction-gated result: 2 cues total — start and arrival. Neither reported
  turn survives.

Both legacy turns are moderate road-shape changes away from a qualifying
junction. They are correctly silenced by junction gating rather than presented
as decisions.

## Token `Cr66s6zHjRufS8zsGz6phqBokJuYUDmyEpRH3vm2iyY`

- Geometry: 37 points, 1,433 m.
- Network input: 2 shards; no degree-3-or-greater junctions within 50 m of the
  route.
- Legacy result: 8 cues total — start, six turns, arrival.
- Legacy turn details: right 47° at 250 m; left 52° at 889 m; right 55° at
  1,085 m; left 54° at 1,188 m followed by right 54° at 1,229 m; and left 44°
  at 1,375 m.
- Junction-gated result: 2 cues total — start and arrival. None of the six
  turns survives.

All six changes are below the 75° open-road bend threshold and none occurs at a
qualifying junction, so suppressing them is consistent with the design.

## Conclusion

The reported false instructions are reproduced under legacy all-corners cue
generation and fully removed by junction gating: eight legacy turn cues across
the two routes become zero. No suspicious turn survives, so these examples do
not indicate a need to tune the 40° turn or 75° bend thresholds.

This result depends on complete shard coverage. The app integration therefore
uses `null` (legacy behavior) on any coverage failure and reserves an empty
array for the authoritative “coverage complete, no nearby junctions” result.
