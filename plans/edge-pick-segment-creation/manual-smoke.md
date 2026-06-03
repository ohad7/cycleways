# Edge-Pick Segment Creation — Manual Smoke Checklist

Run after implementation lands. Boot the editor and `data/cw-base-overlay.json` is the file to inspect for overlay-mapping results.

```bash
EDITOR_PORT=8899 node editor/server.mjs
# open http://127.0.0.1:8899/editor/
```

## Happy path
- [ ] Switch to Segments mode, click **Add**. Toolbar shows Done / Undo last / Draw freehand / Cancel.
- [ ] Base graph edges become clickable.
- [ ] Hover an unpicked edge → cursor is `copy`. Hover an already-picked edge → cursor is `not-allowed`.
- [ ] Click two contiguous edges → draft chain renders in orange with order numbers `1` and `2`; side panel shows `✓ continuous (2 edges)` and `✓ exclusive`.
- [ ] Click **Done** → segment appears in the list, selected on the map, status line: `Accepted <name> with 2 base edges.`.
- [ ] `data/cw-base-overlay.json` contains the new segment's id under `segments` with `source: "edge_pick"` and `status: "accepted_edge_set"`.
- [ ] Save button enables. Save and verify the source file gains the new feature with stitched coordinates.

## Validation: continuity gap
- [ ] **Add** → click two distant edges → status panel shows `Gap between edge 1 and 2 (...m)`.
- [ ] **Done** → status line: `Created <name> but mapping needs edit: Gap ...`.
- [ ] Overlay mapping has `status: "needs_edit"`, `failureClass: "edge_pick_gap"`.

## Validation: conflict
- [ ] **Add** → click a base edge already owned by an accepted segment → status panel shows `Edge ... already owned by ...`.
- [ ] **Done** → segment created, overlay mapping has `status: "needs_edit"`, `failureClass: "edge_pick_conflict"`.

## Compose interactions
- [ ] **Add** → click two edges → **Undo last** → status `Removed last edge ... from draft.`; the chain shrinks.
- [ ] **Add** → press **Esc** → status `Drawing cancelled.`; no source or overlay mutation.
- [ ] **Add** → press **Backspace/Delete** with at least one edge → behaves like Undo last.
- [ ] **Add** → **Draw freehand** → confirm dialog. After confirm, toolbar swaps to point-drawing; draw two points → Done → segment created with no overlay mapping (legacy point-drawn behavior).

## Stale graph gate
- [ ] Make the base graph stale (e.g. by adding a manual base edge but not running Recalculate). Click **Add** → status error `Run Recalculate Graph + Matches before adding a segment.` (no compose mode entered).

## Edit edge-picked segments
- [ ] Select a freshly-created edge-picked segment. The side panel shows **Add/remove edges** and **Split at edge boundary**. Vertex tools (Extend / Delete / Split / Insert) are hidden.
- [ ] Click **Add/remove edges** → base graph clickable. Click one of the segment's current edges → it's removed; the segment's source LineString shrinks; the mapping persists. Click again → re-added.
- [ ] Toggle the button off → status `Exited edge-edit mode.`.
- [ ] Click **Split at edge boundary** → status prompt; click an internal edge of the segment → two child edge-picked segments are created; parent is deprecated with `routeAnchors`; both children's overlay mappings are saved.

## Legacy regression
- [ ] Select an existing accepted point-drawn segment (`source` is not `edge_pick`). Confirm Extend / Delete / Split / Insert still work; vertex drag still works. Confirm **Add/remove edges** and **Split at edge boundary** are NOT shown.
