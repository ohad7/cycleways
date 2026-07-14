# Via-point spur avoidance design

Date: 2026-07-14
Status: implemented; Road 99 visual gate remains deferred

## Problem

An interior route point can snap exactly to a short side edge even when the
route before and after that point continues through the adjacent junction. The
two independently planned legs then traverse the same part of the side edge in
opposite directions. In the July 13 ride, the route went 5.6 m into
`e579386193_2` and immediately returned, producing a visible spur and a false
“right, then right” instruction.

This is a route-construction problem. The cue builder must not hide geometry
that the router actually selected.

## Product contract

Ordinary interior route points are shaping constraints. A click expresses the
desired corridor, but the existing multi-candidate snap planner may select a
nearby legal base edge when that produces a better route. The product does not
currently expose a distinct “must visit this exact stop” waypoint type.

The planner should therefore avoid a tiny immediate retrace when a nearby,
legal, non-reversing snap candidate is competitive. It must not delete route
geometry after planning, silently move endpoints, or remove a long or
unavoidable out-and-back.

## Decision

The shared `RouteManager` joint candidate planner will recognize an immediate
via reversal when:

- there is a completed incoming leg and a proposed outgoing leg at an interior
  point;
- the incoming leg's last traversal and outgoing leg's first traversal use the
  same base edge in opposite directions; and
- their overlap is greater than the traversal epsilon and no more than 12 m.

Such a transition receives a 100 routing-cost-unit penalty. At the existing
10 cost units per metre of snap displacement, this is a bounded preference
roughly equivalent to moving the snap by 10 m. It is large enough to select the
Road 99 ride's edge about 5.6 m away, whose unpenalized local score is only
about 31 units higher, but it cannot pull a point arbitrarily far across the
network.

The dynamic-programming state must retain the best arrival per directed edge,
not just one state per snap candidate, because the next boundary penalty
depends on how the route arrived at that candidate.

If every viable state contains the reversal, or avoiding it costs more than the
bounded penalty, the route keeps the out-and-back. The planner does not trim
traversals after the fact, so route points, leg boundaries, metrics, sharing,
and attestation remain coherent.

## Scope and safety

- Applies in shared core, so web and iOS route building behave identically.
- Applies only to coordinate-based candidate planning. Exact shared-route
  replay continues to restore its encoded traversal slices unchanged.
- Uses only candidates whose directional traversal policy already permits both
  adjacent legs. The preference cannot override one-way or bicycle-access
  restrictions.
- Start and destination points have only one adjacent leg and are unaffected.
- Connector planning uses two points in its normal form and is unaffected.
- Cue generation receives the corrected route geometry; no special cue
  suppression is added.

An explicit stop waypoint can later bypass this preference when the product has
a real stop-versus-shaping-point model. That distinction is outside this fix.

## Validation

Automated coverage must prove:

1. A short dangling-edge snap loses to a nearby non-reversing candidate.
2. A short reversal remains when it is the only candidate, proving there is no
   post-plan geometry deletion.
3. A long deliberate out-and-back remains.
4. Directional traversal validation and route attestation stay valid.
5. Recreating the July 13 route removes the reverse/forward pair on edge share
   ID 29897 and the associated false compound instruction.

The Road 99 route remains pending the already-recorded manual map review for
the two repaired closed-way joins. This fix updates the automated candidate
metrics but does not waive that visual gate.
