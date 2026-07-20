# Network Editor Workflow Consolidation — Design

Date: 2026-07-20

Status: Approved

## Summary

Consolidate the editor's accumulated CycleWays, base-network, mapping, and
direction-review controls into one object-centered **Network** workspace.

The curator chooses what they want to see and edit:

- **CW network** — logical CycleWays segments are prominent and interactive;
- **Base network** — routing edges and their permitted directions are prominent
  and interactive; and
- **Show other network for context** — optionally draws the non-focused network
  as a faint, non-interactive reference.

The editor, rather than the curator, keeps graph topology, segment matching,
directional proposals, evidence, and validation synchronized after an edit.
Ordinary, mechanically proved bidirectional segments become current
automatically. The curator is interrupted only when there is a meaningful
choice, a policy exception, or a defect that cannot be repaired safely.

The existing strict traversal policy and promotion checks remain in force.
This is a workflow and authoring-authority change, not a relaxation of routing
safety.

## Relationship to existing plans

This design supersedes the curator-facing workflow portions of:

- `map-editor-workflow/` — explicit Save Source as the normal commit step;
- `osm-base-network-navigation/` — separate Base Graph and CW Overlay authoring
  workspaces;
- `bicycle-traversal-policy/` — routine use of V1 acceptance, V2 evidence
  refresh, per-direction revalidation, and repeated direction acceptance; and
- `base-network-data-explorer/` — separate top-level Base Network and CW Overlay
  surfaces.

It does **not** supersede their data, policy, or runtime contracts:

- `data/map-source.geojson` remains the logical CycleWays source;
- OSM plus `data/manual-base-edges.geojson` remains the base topology source;
- reviewed OSM overrides and manual traversal policies remain authoritative
  evidence;
- Overlay V2 remains the directional CycleWays mapping model;
- route planning and navigation continue to enforce normalized per-direction
  traversal policy; and
- Build and Promote remain explicit release operations with fail-closed gates.

Roundabout and crossing decisions retain their specialized schemas. They may
use the shared Network map and inspector shell without becoming CycleWays
alignment records.

## Problem

The editor exposes the historical processing pipeline as a sequence of curator
actions:

```text
edit source
  -> Save Source
  -> rebuild graph
  -> recalculate V1 match
  -> Accept V1 mapping
  -> refresh V2 evidence
  -> revalidate A->B
  -> accept A->B
  -> revalidate B->A
  -> accept B->A
  -> Build
  -> inspect a second issue list
  -> Promote
```

Those steps were useful while each layer was introduced, but they are not
independent product decisions. They create several recurring failures:

- a correct automatic match is visible but not used because it was not accepted
  into the next layer;
- graph refresh can make previously completed work appear to disappear;
- an accepted direction can block a revised proposal for the other direction;
- the same segment appears differently in Base Overlay, Direction Review, and
  Build issues;
- new segments and obviously bidirectional manual edges require redundant
  direction approval;
- the curator cannot tell whether a disabled button means stale evidence,
  invalid endpoints, continuity failure, policy failure, or missing publication;
- CycleWays lines can obscure the base edges that need to be edited; and
- fixing one base edge can require a slow full refresh and repeated work on every
  dependent segment.

The model is intentionally powerful. The UI should hide its mechanical stages
without hiding the facts that affect routing.

## Goals

- Make the choice between editing the CW network and the base network explicit.
- Preserve camera, search, and object context while switching network focus.
- Automatically persist deliberate edits and refresh only their dependencies.
- Automatically apply unambiguous, structurally valid, policy-safe mappings.
- Avoid showing directionality controls when both directions are an exact safe
  reverse of one path.
- Present one current state and one issue list for each object.
- Require at most one curator decision for one meaningful route choice.
- Explain blocked cases on the map with a concrete cause and repair target.
- Preserve accepted work when unrelated graph data changes.
- Keep Build and Promote explicit and make Build issues navigable.
- Retain complete provenance for automatic and manual authoring decisions.

## Non-goals

- Relaxing bicycle access or direction enforcement.
- Making `unknown`, `conditional`, or prohibited edges silently routable.
- Treating every automatic match as trustworthy.
- Replacing the base graph, Overlay V2 schema, roundabout schema, or crossing
  schema in the first implementation.
- Incrementally rebuilding the public routing shards after every edit.
- Removing release Build or Promote.
- Hiding unresolved data merely to obtain a clean promotion report.
- Redesigning Route Catalog, Video Sync, or public route-building UI.

## Product model

### One Network workspace, two focus modes

The primary editor navigation becomes:

```text
Network | Roundabouts | Crossings | Video Sync | Route Catalog
```

The Network workspace begins with a persistent segmented control:

```text
[ CW network | Base network ]  [ ] Show other network for context
```

The modes control visibility, styling, hit testing, and editing ownership—not
which data is loaded.

#### CW network focus

- CW segments are prominent and clickable.
- Base edges are hidden by default.
- With context enabled, base edges are faint and non-interactive except for a
  selected segment's mapping preview.
- Segment geometry, metadata, mappings, and routeability are edited here.

#### Base network focus

- Base edges and direction arrows are prominent and clickable.
- CW segments are hidden by default.
- With context enabled, CW segments are faint outlines and non-interactive.
- Manual geometry and reviewed traversal evidence are edited here.

Switching focus preserves the camera. When possible it also preserves useful
context: selecting segment #62 and switching to Base network keeps #62 as a
faint corridor while exposing its supporting edges. Selecting a base edge and
switching to CW network shows the segments that use it.

Only the focused layer owns normal map clicks. This prevents a highlighted CW
line from stealing clicks intended for a base edge.

### Object-centered inspector

The inspector represents the selected object, not a processing stage.

For a CW segment it contains:

- identity and editable metadata;
- a compact routing summary;
- its rideable path or paths;
- issues, if any; and
- an advanced audit view containing edge references and evidence provenance.

For a base edge it contains:

- source identity and geometry;
- forward and reverse bicycle traversal verdicts;
- raw tags and normalized reasons;
- manual or reviewed override controls where applicable;
- CycleWays segments using the edge; and
- affected derived features such as roundabouts and crossings.

For a junction-derived feature it opens the appropriate roundabout or crossing
lens inside the same map context.

### One comprehensible status

Every selected CW segment has one user-facing status:

- **Updating** — a recent edit is being saved and evaluated;
- **Current** — the applied mapping matches current source and evidence;
- **Needs a decision** — more than one safe interpretation or an intentional
  policy exception requires curator judgment; or
- **Blocked** — no valid result can be applied until topology, endpoints, or
  traversal evidence is corrected.

Internal draft, published, accepted, migration, and evidence-digest fields can
remain in the stored schema. They do not become competing user-facing states.

Examples:

```text
Current · Bidirectional · 3 base edges · 100% coverage
Current · Two directional paths · 41 base edges
Needs a decision · Two valid B->A paths
Blocked · 15 m continuity gap
```

The inspector never says merely “invalid” when a more specific diagnosis is
available.

## Authoring and synchronization

### Transactional autosave

There is no routine **Save Source** button.

The browser may keep transient geometry while a drag or drawing gesture is in
progress. A completed, deliberate action is one transaction:

- finishing a vertex drag;
- pressing **Done** after drawing or selecting edges;
- changing a metadata field and leaving the field;
- saving a manual edge policy; or
- choosing a proposed exceptional route.

The server validates and atomically writes the directly edited source file. If
the write fails, the editor retains the local edit, marks it unsaved, and gives
the curator Retry/Discard choices. It must not pretend the derived state is
current.

Undo remains an authoring action and produces a new transaction. Release Build
is not part of autosave.

### Dependency-driven refresh

After a successful source transaction, the server determines which derived
work is required.

| Change | Required authoring refresh |
| --- | --- |
| CW metadata only | Rebuild segment presentation state only |
| CW geometry/endpoints | Rematch and validate that segment |
| Manual base-edge geometry | Refresh base topology, policy, and affected segments |
| Base-edge traversal evidence | Refresh policy and affected segments |
| Explicit CW edge selection | Validate and apply that segment's directional paths |
| Unrelated source change | Preserve unaffected segment state |

Jobs are revisioned and coalesced. A late result from revision 12 cannot replace
revision 13. Multiple edits to the same dependency may collapse into one run.
Only affected objects show Updating.

The implementation may initially rebuild the full local base graph when a base
source changes, but the user-facing contract is still one automatic refresh.
It must not run elevation processing or a public release build. Incremental
graph generation is a performance optimization, not a prerequisite for the
workflow.

### Overlay V2 is the mutable mapping authority

Overlay V2 becomes the only current directional authoring authority.

- `data/cw-base-overlay.v2.staged.json` stores current directional alignments,
  working proposals, evidence bindings, and provenance.
- The V1 `data/cw-base-overlay.json` remains a read-only compatibility and audit
  input during migration.
- New edits never require writing V1 and then importing it into V2.
- Public build code may continue to emit or consume compatibility projections
  until all consumers use V2.

An idempotent migration will seed missing V2 state from V1 without replacing
newer V2 authoring. Thereafter, V1 cannot block or overwrite a current V2
direction.

### Evidence is scoped to what changed

An applied alignment records a digest of:

- its normalized ordered directed edge references;
- referenced edge geometry;
- referenced traversal policy;
- relevant endpoint zones; and
- any roundabout repair or CW access-precedence decision it relies on.

Unrelated graph changes do not invalidate the alignment. If only A->B evidence
changes, a published B->A alignment does not block adoption or review of A->B.
The status and decision binding are direction-scoped even though the inspector
normally presents a single bidirectional path.

## Automatic application policy

### Ordinary bidirectional path

An automatically matched path becomes current in both directions without a
curator acceptance step only when all of the following are true:

1. endpoint zones are valid;
2. the ordered base-edge sequence is continuous;
3. coverage and distance-quality thresholds pass;
4. every selected traversal is `allowed`;
5. every reverse traversal is also `allowed`;
6. the reverse mapping is the exact continuous reverse of the forward mapping;
7. no directed ownership conflict exists;
8. no restricted, conditional, unknown, or CW-precedence exception is needed;
9. no roundabout alternate-path repair is needed, unless the repair is uniquely
   determined by the roundabout topology rule;
10. no materially competitive parallel path exists; and
11. the segment is not already marked intentionally asymmetric.

The stored provenance records that it was mechanically auto-applied, including
the algorithm version and evidence digest. Automatic does not mean unaudited.

This is the normal path for dirt roads, simple two-way roads, and segment #62.
Such segments do not appear in Direction Review.

### Direct curator authoring

Explicit edge picking is already a curator decision. Pressing **Done** validates
and applies the chosen path. The curator is not asked to accept the same path a
second time.

If its exact reverse is safe, both directions become current. If the reverse is
not safe, the editor exposes the unresolved direction and asks only for that
directional choice.

### Cases that require a decision

The editor creates one review item when:

- two or more materially different valid paths compete;
- A->B and B->A require different carriageways;
- only one direction is available;
- a route needs restricted, conditional, or unknown traversal;
- a new or changed alignment needs CW precedence over source `bicycle=no` or
  another explicit access prohibition;
- a directed ownership conflict needs resolution;
- a roundabout has more than one plausible legal reverse repair; or
- an automatic proposal changes a previously intentional asymmetric decision.

The review shows the relevant alternative or pair on the map and ends with one
**Use this path** or **Done** action. Reviewer and date are filled from the local
editor identity and current date.

### Cases that are blocked, not reviewable

The editor does not offer acceptance when:

- the base-edge sequence is disconnected;
- endpoint zones fail;
- a referenced edge is missing;
- a required direction is prohibited with no explicit allowed exception;
- no path meets the quality thresholds; or
- the base topology is stale or failed to rebuild.

Instead it identifies the defect and provides a repair action such as **Show
gap in Base network** or **Review base-edge direction**.

## Progressive disclosure of directionality

Most segments show one row:

```text
Rideable path: Bidirectional · 3 edges
```

The A->B and B->A distinction appears only when:

- the directions use different base-edge sequences;
- one direction is unavailable;
- one direction has a policy or validation issue;
- a roundabout requires an alternate reverse route;
- evidence changed for only one direction; or
- the curator chooses **Show directions** in the advanced audit view.

Directional arrows are always visible when reviewing a directional choice.
They are not routine form fields for a symmetric segment.

## Issue model and review queue

There is one **Issues** entry point. It is a filtered list of current object
states, not a second authoring database.

Each issue contains:

- affected object ID and name;
- plain-language title;
- severity: decision, blocker, or release warning;
- exact evidence or geometry involved;
- one primary next action; and
- the source revision that produced it.

Useful issue types include:

- continuity gap, including exact edge pair and distance;
- endpoint drift, including start/end distances and allowed zones;
- ambiguous path;
- asymmetric path decision;
- missing directional path;
- traversal evidence needed;
- access-precedence decision;
- directed ownership conflict;
- stale reviewed evidence; and
- derived roundabout/crossing decision.

Selecting an issue opens the same object inspector used during ordinary map
editing. Search by segment ID, edge ID, OSM way ID, or name is shared across the
map and Issues list.

Build issues use the same deep links and labels. A segment cannot be absent
from the editor issue list while the current authoring state says it is blocked.

## Base-network editing rules

### Manual edges

- A newly drawn manual edge defaults to reviewed bidirectional traversal,
  attributed to the configured local curator and current date.
- A manual edge copied from OSM inherits the source edge's normalized direction;
  it does not erase a known one-way restriction.
- A split manual edge inherits its parent's policy.
- Changing geometry or policy automatically refreshes the graph and affected CW
  segments.
- Deleting an edge reports every dependent segment and automatically rematches
  those with a safe alternative.

### OSM-derived edges

OSM geometry and tags remain read-only. A curator correction creates the
existing reviewed override with evidence and provenance. Saving the correction
automatically refreshes every affected split edge and CW segment.

### Impact summary

After a base edit, the editor reports the result without requiring each
dependent object to be opened:

```text
Base edge updated · 4 segments refreshed · 3 current · 1 needs a decision
```

The summary links to the exceptional segment.

## Roundabouts, crossings, and access conflicts

### Roundabouts

When an exact edge reversal would traverse a roundabout illegally, the matcher
tries the reviewed roundabout topology repair. A unique valid repair is applied
automatically and labeled in the audit view. Competing repairs create one
directional review item.

The dedicated Roundabouts lens remains available for inspecting and correcting
roundabout classification evidence.

### Crossings

Crossing candidates and decisions remain separate from path alignment. The
Crossings lens uses the same network-focus switch, search, map selection, and
inspector conventions. Updating relevant base geometry refreshes affected
crossing evidence automatically; it does not silently accept a new semantic
crossing decision.

### Accepted CW access precedence

An unchanged accepted CW alignment may continue to provide the explicit
CycleWays access-precedence evidence defined by the traversal-policy design.

A new or materially changed mapping over an explicitly prohibited source edge
does not auto-apply. The curator sees the conflict on the map and makes one
decision to use the intentional CW alignment despite the source tag. That
decision, rather than generic CycleWays membership, is stored as precedence
evidence.

## Release workflow

Authoring synchronization and release generation are separate.

A compact persistent release control reports:

```text
Authoring current · 4 release blockers       [Build release]
Last build: 14:32 · not promoted             [Promote]
```

### Build release

Build remains explicit because it performs expensive and broad work such as
elevation processing, public asset generation, complete policy audit, routing
shards, compatibility artifacts, and release reporting.

Build does not repair stale editor state. The authoring state must already be
current. It produces issues linked back to the Network workspace.

### Promote

Promote remains explicit and fail-closed. It requires a fresh successful build
whose source revision equals the current authoring revision and whose required
blocker count is zero.

## Common scenarios

| Scenario | Curator action | Editor result |
| --- | --- | --- |
| Simple bidirectional segment (#62) | Adjust CW geometry/endpoints and finish | Rematches, applies exact reverse, shows Current; no direction review |
| Fix manual base edge | Switch to Base network and edit once | Saves, refreshes topology and dependent segments, reports exceptions |
| New ordinary CW segment | Draw and press Done | Finds and applies safe bidirectional mapping automatically |
| Divided road (#174/Road 99) | Review the two carriageway paths once | Stores distinct A->B/B->A mappings and shows both directions |
| Roundabout reverse (#276) | Edit the segment | Unique legal reverse is repaired automatically; ambiguity is reviewed |
| Mapping continuity gap (#63 history) | Open the issue | Switches to Base network and highlights the exact edge pair and gap |
| Bicycle access conflict (#19) | Inspect source evidence and decide once | Stores explicit CW precedence or leaves the segment blocked |

## Failure and recovery behavior

- Failed source write: retain the local edit and show Retry/Discard.
- Failed graph refresh: keep the last known applied data, mark affected objects
  Blocked by stale topology, and never claim they are current.
- Superseded refresh: discard the late result by revision token.
- Browser reload during a job: reload persisted source plus server job status;
  do not require the curator to restart the editor.
- Server restart: recover from source files, retained V2 state, and the last
  completed derived revision; rerun incomplete derived work idempotently.
- Invalid automatic proposal: keep the current valid alignment if its evidence
  is unchanged, show the new proposal as unresolved, and never replace valid
  published data with invalid data.

## Accessibility and usability

- The focus switch and context toggle are keyboard accessible and have visible
  selected states independent of color.
- Direction uses repeated arrowheads, not color alone.
- Focused versus contextual networks differ by width, opacity, and hit testing.
- Every map-only diagnosis has equivalent inspector text.
- Progress reports the affected object and stage without exposing V1/V2 jargon.
- Disabled actions include a visible explanation; exceptional review actions
  are not shown until their prerequisites exist.

## Observability and audit

Each authoring transaction and derived refresh records:

- source revision;
- object IDs changed;
- initiating action and curator identity;
- dependency stages run;
- algorithm/schema versions;
- automatic versus curator-applied outcome;
- evidence digest before and after;
- duration and failure stage; and
- affected-object summary.

The advanced audit view can expose these details. Routine editing shows only
the understandable result.

## Decisions settled by this design

- CW and base networks are explicit peer focus modes in one Network workspace.
- The non-focused network can be shown only as non-interactive context.
- Discrete edits are transactionally autosaved.
- Derived authoring state refreshes automatically and dependency-first.
- Overlay V2 is the only mutable directional mapping authority.
- V1 remains read-only compatibility/audit data during migration.
- Safe, deterministic bidirectional matches are auto-applied.
- Explicit edge selection is approved by Done and is never accepted twice.
- Directional controls are progressively disclosed.
- One issue list and one object inspector replace pipeline-specific queues.
- Roundabout reverse repair may auto-apply only when uniquely determined.
- New access-precedence decisions remain explicit.
- Build and Promote remain explicit release operations.

## Deferred decisions

- Whether persistent multi-session undo is worth storing beyond the existing
  editor session.
- Whether full base-graph regeneration needs an incremental implementation after
  measuring the coalesced automatic workflow.
- When V1 compatibility output can be deleted entirely.
- When Roundabouts and Crossings should cease being top-level lenses.
- Whether Route Catalog and Video Sync should later adopt the same transaction
  coordinator.

## Editing-loop refinement — 2026-07-21

Base Network focus is itself the editing boundary. The additional permanent
**Explore / Edit-review** switch is removed: an ordinary map click still only
selects and inspects, while mutations require a concrete action such as moving
a selected manual vertex, New/Copy/Delete/Split, or Save direction policy.
This keeps the safety boundary attached to the action that changes data instead
of requiring a second workspace mode.

Autosave uses a short trailing debounce and a latest-state-wins coordinator:

- edits made before work begins collapse into one update;
- there is at most one active update and one pending latest revision per object;
- an edit made during an active update is never deleted when the older update
  completes;
- source features and explicit edge selections are immutable snapshots for the
  lifetime of one update;
- a locally superseded source revision is retried automatically rather than
  shown as a terminal authoring failure; and
- a base edit made during a full evidence refresh guarantees one later refresh
  instead of being lost or creating an unbounded queue.

The editor shows the current stage and selected segment while updating. Each
completed browser-side run records per-stage durations, and server logs record
request durations for source save, segment matching, match persistence, V2
validation, metadata updates, and full evidence refresh. Performance work is
chosen from these measurements; the first likely candidate is avoiding a new
Python process and full graph load for every single-segment match.
