# Edge-Pick Segment Creation Design

## Goal

Replace the current point-drawing flow for new CW segments in the editor with
direct base-edge selection. New segments are composed by clicking base graph
edges (OSM-derived and manual) on the map, rather than by drawing free
coordinates and recalculating a match afterward.

This is now possible because every active segment has an accepted base-edge
overlay mapping. The base graph is therefore complete enough to be the
authoring substrate for new segments, not only the matching target for
post-hoc snapping.

## Status

Design only. No code written yet.

Scope is intentionally narrow: new segments and edits to segments created by
this flow. Existing point-drawn segments are not migrated and keep their
current toolset.

## Decisions

The major decisions, taken with the user during brainstorming:

- **Scope.** Edge-picking replaces point-drawing as the default for Add
  Segment. Point-drawing remains as an in-flow escape hatch for areas with no
  base coverage.
- **Pick model.** Click each base edge to toggle it in or out of the
  in-progress segment, identical to today's CW Overlay edge-toggle.
- **Workspace.** The flow lives in the Segments workspace, behind the
  existing Add Segment button.
- **Source geometry.** On commit, the segment's source `LineString` is
  stitched from the picked edges (respecting edge direction). Source and
  overlay agree from the moment the segment is created.
- **Editing.** Segments created by edge-pick lose the vertex tools
  (drag/insert/delete/extend). Editing is "add/remove edges" and "split at
  edge boundary". Vertex tools remain available on existing point-drawn
  segments.
- **Accept gate.** A committed mapping is auto-accepted iff editor-side
  validation passes (non-empty, continuous, exclusive). Otherwise it is saved
  as `needs_edit` with a specific failure class and the segment is created
  anyway so the user can fix it in place.
- **Gap fallback.** If the user discovers a missing base edge mid-flow, they
  cancel, switch to Base Graph mode, add a manual edge, run Recalculate
  Graph + Matches, then return and start the segment again. v1 does not
  preserve in-progress drafts across this round-trip.
- **Existing segments.** Untouched. Their flows are unchanged.

## Architecture

### Persistence

No new persisted concepts, no schema changes, no new server endpoints.

The flow produces the same artifacts as today's Add Segment + Recalculate
Selected + Accept sequence:

- a new feature in `data/map-source.geojson` with a stitched `LineString`
- a new overlay mapping under `data/cw-base-overlay.json`
  `segments[<id>]`, with `source: "edge_pick"`,
  `status: "accepted_edge_set"` (or `"needs_edit"` on validation failure),
  and `edgeRefs` set to the normalized picked edges

Build, Promote, public display-geometry derivation, KML export, and routing
shard production are unchanged.

### Transient composition state

While composing, all state lives on `state.draw`:

- `state.draw.type === "newSegmentEdges"`
- `state.draw.edgeRefs: EdgeRef[]` — in click order; normalized for render
  and validation via the existing `normalizeOverlayEdgeRefs`
  (editor.js:1059), which produces a directed, connectivity-sorted chain
- `state.draw.freehand: false` — flag flipped by the escape-hatch button to
  swap into today's `"new"` (point-drawing) draw type for the remainder of
  this composition

Nothing is written to disk until **Done**.

### Map rendering during composition

A new transient layer renders the draft chain by styling the picked base
edges distinctly from the accepted CW Overlay layer (so the user can tell
in-progress from committed). Edge midpoints carry small order numbers for
the first few edges so direction is visible.

Base graph edges (OSM + manual) become visible and clickable in Segments
mode **only while composing**. When not composing, Segments mode looks
exactly as it does today.

Hover styling indicates whether a clicked edge would be added or removed.

### Commit (Done)

A single in-memory operation, then one overlay save:

1. Assign `nextSegmentId()`.
2. Compute the normalized `edgeRefs` and stitch
   `geometry.coordinates` by walking edges in order and concatenating their
   coords (respecting `direction: "reverse"`), de-duplicating shared
   endpoints between consecutive edges.
3. Build the source feature with default properties: generated name via
   `uniqueSegmentName("New segment")`, `status: "active"`,
   `roadType: "paved"`, `quality: defaultQuality()`.
4. Run `validateEdgePickMapping(segmentId, edgeRefs)`.
5. Build the overlay mapping: `source: "edge_pick"`, `edgeRefs`,
   `segmentId`, `segmentName`, and either
   `status: "accepted_edge_set"` (validation passes) or
   `status: "needs_edit"` with `failureClass` and message
   (validation fails).
6. Push the feature into `state.source`, write the overlay mapping into
   `state.baseOverlay.overlay.segments[id]`, mark source dirty, save the
   overlay file with the existing `saveBaseOverlay`.

The source file save itself is the user's normal Save action, matching
today's Add Segment behavior.

## UI

### Add Segment button

Position and label unchanged. Clicking it now enters
`newSegmentEdges` mode instead of point-drawing.

### Compose toolbar

Replaces the current Done/Cancel pair while
`state.draw.type === "newSegmentEdges"`:

- **Done** — disabled until `edgeRefs.length >= 1`; tooltip explains why
  when disabled.
- **Cancel** — discards `state.draw`, no writes. Bound to Esc.
- **Undo last** — pops the last picked edge. Bound to Backspace/Delete,
  mirroring today's point-drawing affordance.
- **Draw freehand instead** — escape hatch. Confirms first, then discards
  picked edges and switches `state.draw.type` to today's `"new"`. One-way
  per composition in v1 (no toggling back).

### Side panel — live validation

While composing, the Segments side panel shows:

- current edge count
- continuity result: `✓ continuous` or `gap between edge N and N+1` with a
  link that pans to the gap
- exclusivity result: `✓ exclusive` or `edge X already owned by segment Y`
  with a link that selects segment Y

The same panel is shown post-commit when the saved mapping is `needs_edit`.

### Post-commit edit tools

The distinction is driven by the segment's overlay mapping:
`source === "edge_pick"` ⇒ edge-picked, else legacy point-drawn.

For edge-picked segments in Segments mode:

- **Hidden:** drag-vertex, insert-vertex, delete-vertex, extend-segment.
- **Shown:**
  - `Add/remove edges` — enters an edge-edit mode that reuses today's
    `toggleSelectedOverlayBaseEdge` (editor.js:2330) flow.
  - `Split at edge boundary` — pick an internal edge boundary; the segment
    splits into two child edge-picked segments. Parent is deprecated with
    compact `routeAnchors` (same migration shape today's vertex-split
    produces).

Legacy segments keep their existing toolset unchanged.

## Interaction Flows

### Happy path

1. Segments mode → **Add Segment**. Map switches to compose state; toolbar
   shows Done / Cancel / Undo last / Draw freehand instead.
2. User clicks base edges in any order. Each click toggles inclusion; draft
   chain renders in a distinct style with order numbers; side-panel
   validation updates live.
3. User clicks **Done**. Editor stitches coords, creates the source feature
   with default props, writes the overlay mapping. Validation passes →
   overlay status `accepted_edge_set`; segment becomes selected; status
   line: `Added <name> with N base edges.` Source marked dirty for the
   user's normal Save.

### Validation-fails path

1. Same as happy path through step 2.
2. On Done, continuity or exclusivity check fails. Segment is still
   created; overlay mapping written as `needs_edit` with
   `failureClass: "edge_pick_gap"` or `"edge_pick_conflict"` and a
   human-readable message.
3. User fixes by entering edge-edit mode on the new segment
   (Add/remove edges) and re-attempts. No separate re-validation gate — the
   mapping flips back to `accepted_edge_set` automatically on the next save
   once validation passes (same code path as the commit-time check).

### Gap-in-base-graph path

1. While composing, user realises the corridor needs a base edge OSM does
   not have.
2. User clicks **Cancel** → switches to Base Graph workspace → draws manual
   base edge → runs Recalculate Graph + Matches → returns to Segments →
   **Add Segment** → continues.
3. v1 does not preserve the in-progress edge selection across this
   round-trip. Status line at Cancel: "Draft discarded. To add a missing
   path, use Base Graph mode."

### Freehand escape-hatch path

1. While composing, user clicks **Draw freehand instead**. Confirmation
   toast: "Switch to freehand? Picked edges will be discarded."
2. On confirm, `state.draw.edgeRefs` is cleared and `state.draw.type`
   becomes today's `"new"`. Toolbar swaps to point-drawing controls.
3. Flow continues exactly like today's point-drawing Add Segment: click
   points → Done → existing `commitNewDrawnSegment` (editor.js:3823)
   creates the segment. No overlay mapping is written; the segment behaves
   like a legacy point-drawn segment and the user runs Recalculate Selected
   later as today.

### Cancel path

- Click Cancel or press Esc: `state.draw` discarded, no writes, map returns
  to Segments select mode, status: "Discarded segment draft."

### Edit existing edge-picked segment

- Select the segment → side panel shows `Add/remove edges` and
  `Split at edge boundary`.
- Add/remove edges: base graph becomes clickable, picked edges highlighted;
  each toggle saves the updated mapping and re-runs validation; status line
  reflects the mapping's resulting status.
- Split at edge boundary: pick a boundary; two new edge-picked child
  segments are created; parent deprecated with `routeAnchors`.

## Validation Rules

Validation runs at commit and after every edge-edit mutation on an
edge-picked segment. On any failure the mapping is `needs_edit` with a
specific `failureClass`.

A shared helper `validateEdgePickMapping(segmentId, edgeRefs)` is used by
both paths so commit-time and edit-time results match exactly.

### Checks (v1)

1. **Non-empty.** `edgeRefs.length >= 1`. Empty is blocked at the UI level
   (Done disabled); this should never reach the persistence path.
2. **Continuity.** After `normalizeOverlayEdgeRefs`, walk the chain: each
   edge's end node must equal the next edge's start node (respecting
   `direction`). Failure: `failureClass: "edge_pick_gap"`; message lists
   the `(i, i+1)` pair and unmatched node ids; side panel links to the gap
   location on the map. Single-edge chains pass trivially. Reuses
   `edgeRefContinuityGaps` (editor.js:1962).
3. **Exclusivity.** For each `edgeRef`, no *other* accepted overlay
   mapping in `state.baseOverlay.overlay.segments` already references that
   edge. Failure: `failureClass: "edge_pick_conflict"`; message names the
   conflicting segment id/name; link selects that segment. Implemented by
   a new helper `conflictingSegmentForEdge(edgeId, excludeSegmentId)`.
   Edges held only by `needs_edit` mappings do not block (they are not yet
   committed owners).

### Not validated in v1 (deferred to Build)

- Edge direction monotonicity beyond pairwise continuity. Build's stricter
  direction checks remain authoritative.
- Graph staleness. If `isBaseGraphStale()` is true at commit, Done is
  blocked with the existing "Run Recalculate Graph + Matches" prompt — the
  same gate used by `recalculateSelectedOverlayMatch` today
  (editor.js:5094). Reused, not re-implemented.
- Manual base edges referenced but not yet in the graph: covered by the
  stale-graph gate above.

The commit-time editor validation is a guardrail to flag obvious mistakes
immediately. Build remains the source of truth at promote time.

## Error Handling and Edge Cases

- **Click during compose hits no base edge feature.** No-op, no status
  toast (avoids noise).
- **Manual base edges saved to disk while a compose is active.**
  In-progress `edgeRefs` are not affected (edges referenced by id); on next
  render their geometry refreshes from `state.baseOverlay.manualBaseEdges`.
- **Selected segment changes during compose.** Not possible: compose locks
  side-panel selection until Done/Cancel, mirroring today's draw-mode
  behavior (`isDrawing()` already guards `selectFeatureByActiveIndex`).
- **Browser refresh during compose.** Draft is lost. Acceptable — same as
  today's point-drawing flow.
- **Network failure saving overlay on Done.** The source feature was
  already pushed into in-memory `state.source`; the failure surfaces as an
  error toast and the user can retry Done. The segment id was assigned
  upfront so the retry is idempotent.

## Testing

### Unit (pure JS, no map)

- `stitchCoordsFromEdgeRefs(edgeRefs, graphEdgeLookup)` — fixtures: forward
  chain, reverse chain, mixed direction, single edge, duplicate endpoint
  dedup. Asserts coordinate sequence.
- `validateEdgePickMapping` — table-driven: empty; single edge; continuous
  chain; gap mid-chain; edge owned by another accepted segment; edge in
  another segment whose mapping is `needs_edit` (passes — only *accepted*
  mappings block).
- `nextSegmentId` collision: a freshly committed edge-picked segment
  increments past the highest existing id.

### Editor integration

- Add Segment → click two contiguous base edges → Done → segment exists in
  `state.source` with stitched geometry; overlay mapping is
  `accepted_edge_set`; source dirty flag set.
- Add Segment → click two non-contiguous edges → Done → segment created;
  overlay mapping is `needs_edit` with `failureClass: "edge_pick_gap"`;
  status panel shows the gap message.
- Add Segment → click edge already owned by an accepted segment → Done →
  `needs_edit` with `failureClass: "edge_pick_conflict"`; link selects the
  conflicting segment.
- Add Segment → Cancel → no source mutation, no overlay write, draw state
  cleared.
- Add Segment → Draw freehand instead → confirm → toolbar swaps; click
  points; Done → segment created via existing `commitNewDrawnSegment`; no
  overlay mapping written.
- Edge-picked segment → Add/remove edges → toggle one edge off → save →
  overlay mapping updated; validation re-runs; status updates.
- Edge-picked segment → Split at edge boundary → two child edge-picked
  segments exist; parent deprecated with `routeAnchors`.
- Stale base graph at commit → Done shows the existing "Run Recalculate
  Graph + Matches" prompt and does not write the segment.

### Playwright e2e

One happy-path scenario: boot editor against a test fixture, Add Segment,
click two visible base edges, Done, assert the new segment appears in the
segments list and renders on the map.

## Out of Scope

Called out so reviewers see it:

- No migration of existing point-drawn segments to edge-picked.
- No undo *of a committed* segment beyond delete; mid-compose Undo only.
- No multi-segment batch composition.
- No preserving in-progress draft across a "go fix base graph" round-trip.
- No re-implementation of Build's full validation in the editor; commit-
  time validation is a guardrail, Build remains authoritative at promote.

## Affected Files (informational)

- `editor/editor.js` — new compose mode, new draft layer, new toolbar
  buttons, new commit path, shared `validateEdgePickMapping`,
  `conflictingSegmentForEdge`, `stitchCoordsFromEdgeRefs`; segment edit
  tools gated by `source === "edge_pick"`.
- `editor/styles.css` — draft chain styling, hover affordance, validation
  panel rows.
- `editor/index.html` — new toolbar buttons (Undo last, Draw freehand
  instead), `Add/remove edges` and `Split at edge boundary` controls in
  the Segments side panel.
- `editor/README.md` — update "Current Editing Scope" to describe the new
  default flow and the freehand escape hatch.
- `tests/` — new unit fixtures and integration scenarios; one Playwright
  case.

No server-side changes (`editor/server.mjs`), no schema changes, no new
endpoints.
