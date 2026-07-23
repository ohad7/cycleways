# Ways Workspace UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the editor's Ways workspace as Option A from `design.md` — two modes
(review inbox / way library) with one search, a clickable progress bar, way cards carrying
real stats, members ordered along the way, the map as the assignment surface, and a
keyboard-triaged work queue — without changing the guidance data model, its transactions,
or its validator.

**Architecture:** All new derivation logic (ordering, candidates, health sentences, unified
search, merged work queue, formatting) lands in a new pure module
`editor/lib/ways-workspace.mjs` that never touches the DOM or Mapbox, so it is unit-testable
under plain node. `editor/editor.js` keeps ownership of state, rendering, map layers and the
existing save transactions; its Ways region is rewritten to render one screen at a time from
a single derived model. Markup and CSS are replaced in place.

**Tech Stack:** Vanilla ES modules, Mapbox GL JS, node:assert test scripts run directly by
`npm test`.

## Global Constraints

- Every write still goes through `saveGuidanceDocuments()` → `POST /api/navigation-ways`
  carrying `expectedDigests`, with the 409 reload path intact. No new endpoint, no bare
  source POST.
- The shared validator stays the only source of issues; the editor must keep reporting the
  exact codes Build reports. New copy maps codes to sentences, it never invents findings.
- Guardrails preserved verbatim in behavior: last-member-of-a-way cannot be removed
  (delete the way instead), facility-class conflicts are refused before the write, changing
  `spokenName` requires the iOS-verification checkbox, `parallel-facility-risk` needs the
  explicit acknowledgment checkbox, a suggested audible form never becomes canonical.
- Way creation stays one atomic transaction: registry record + first membership.
- A stale suggestion artifact stays read-only.
- Panel copy is Hebrew, `dir="rtl"`; the panel column is 430px (`.ways-workspace .app-shell`).
- Network's `הכוונה ושם דרך` section keeps its current scope and ids.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `editor/lib/ways-workspace.mjs` (new) | Pure derivation: geometry index, member ordering + gaps, endpoint candidates, health/summary sentences, unified search, merged work queue, length formatting. |
| `tests/test-ways-workspace.mjs` (new) | Unit tests for every export above. |
| `editor/index.html` | Replace the `#ways-panel` markup with header (modes + search + progress + undo) and three screens: library, detail, review. |
| `editor/styles.css` | Replace `.ways-*` / `.way-*` / `.guidance-suggestion-*` panel styles with the new component styles. |
| `editor/editor.js` | State fields, one derived model, four screen renderers, map context source/layers, click-to-attach, keyboard triage, undo. |
| `tests/test-navigation-way-editor-wiring.mjs` | Re-point static wiring assertions at the new contract; keep every transaction/guardrail assertion. |
| `package.json` | Add `tests/test-ways-workspace.mjs` to the `test` chain. |

---

### Task 1: Pure workspace module

**Files:**
- Create: `editor/lib/ways-workspace.mjs`
- Test: `tests/test-ways-workspace.mjs`

**Interfaces — Produces:**

```js
buildGeometryIndex(source) → Map<segmentId, {
  segmentId, name, guidance, endpoints: [[lng,lat],[lng,lat]], lengthMeters }>
orderWayMembers(memberIds, index) → {
  rows: [{ segmentId, componentIndex, lengthMeters }],
  gaps: [{ afterSegmentId, beforeSegmentId, distanceMeters }],
  componentCount, totalLengthMeters }
wayCandidates(memberIds, index, { limit }) → [{
  segmentId, anchorSegmentId, distanceMeters, lengthMeters, name, occupiedByWayId }]
wayHealth(wayReport, issues) → { level: "ok"|"warning"|"blocked", label }
waySummary(way, wayReport) → string
formatLengthMeters(meters) → string
wayIssueSentence(entry) → string
searchWorkspace(query, { registry, index, limit }) → [{ type, id, title, subtitle }]
buildWorkQueue({ suggestions, index, registry, filter }) → [{
  kind: "suggestion"|"segment", key, segmentIds, group?, segmentId? }]
```

- [ ] **Step 1: Write the failing test** covering: ordering a 3-member chain end to end;
      a two-component way reporting one gap with its distance; candidates limited to
      segments touching a member endpoint within tolerance and reporting the anchor;
      health levels from a report + issue list; `formatLengthMeters` unit switch at 1 km;
      search matching both a way name and a segment id; queue merging suggestion groups
      with unreviewed segments and honoring the `no-suggestion` filter.
- [ ] **Step 2:** `node tests/test-ways-workspace.mjs` → FAIL (module not found).
- [ ] **Step 3:** Implement the module. Reuse the 25 m endpoint tolerance and the
      metre-per-degree constants already used by `navigation-ways.mjs`.
- [ ] **Step 4:** `node tests/test-ways-workspace.mjs` → PASS.
- [ ] **Step 5:** Add the test to `package.json`'s `test` chain, ahead of
      `test-navigation-way-editor.mjs`. Commit.

### Task 2: Panel markup

**Files:** Modify `editor/index.html` (`#ways-panel`)

Structure: `header.ways-header` (mode switch `#ways-mode-review` / `#ways-mode-library`,
one `#ways-search` + `#ways-search-results`, `#ways-progress` with `#ways-coverage`,
`#ways-warning-filter`, `#ways-blocker-filter`, and `#ways-undo`), then three sibling
screens — `#ways-library` (`#ways-list`, `#ways-create`), `#ways-detail`
(`#way-detail-back`, `#way-detail-menu` overflow holding `#way-editor-fit` and
`#way-editor-delete`, `#way-editor-name` as the inline title, `#way-detail-stats`,
`#way-detail-health`, `#way-details-fields` disclosure holding `#way-editor-id`,
`#way-editor-kind`, `#way-editor-ref`, `#way-editor-spoken-name`,
`#way-editor-audible-verified`, `#way-editor-save`, `#way-editor-cancel`,
`#way-editor-issues`, `#way-editor-members`, `#way-candidates`) and `#ways-review`
(`#ways-queue-filters`, `#guidance-suggestion-binding`, `#guidance-suggestion-list`,
`#ways-queue-next`, `#ways-queue-refresh`).

- [ ] Replace the markup; delete `#ways-segment-*`, `#ways-selected-segment`,
      `#guidance-suggestion-search`, `#guidance-suggestion-filter`,
      `#guidance-suggestion-refresh`, `#guidance-review-badge`.
- [ ] Keep `#ways-panel`, `#ways-search`, `#ways-list`, `#ways-create`, `#ways-coverage`
      and every `way-editor-*` id so unchanged wiring keeps working.

### Task 3: Panel styles

**Files:** Modify `editor/styles.css`

- [ ] Add `.ways-header`, `.ways-modes`, `.ways-mode`, `.ways-progress`, `.ways-bar`,
      `.ways-chip`, `.ways-undo`, `.ways-search-results`, `.way-card`, `.way-health`,
      `.way-detail-*`, `.way-member-row` (grid: id / label / length / remove),
      `.way-gap-row`, `.way-candidate-row`, `.ways-queue-card`, `.ways-queue-filters`,
      `.ways-kbd`; keep `.guidance-*` selectors the Network panel still uses.

### Task 4: Editor state, model, and screen renderers

**Files:** Modify `editor/editor.js`

- [ ] Extend `state.guidance` with `panelMode` (`"library"|"detail"|"review"`), `search`,
      `queueIndex`, `queueFilter`, `undo`, `identityDirty`, `geometryIndex`,
      `geometryIndexSource`.
- [ ] Add `waysWorkspaceModel()` deriving index, ways with reports/health, ordered members,
      candidates, queue, and coverage once per render.
- [ ] Replace `renderWaysManager()` with an orchestrator calling `renderWaysHeader`,
      `renderWaysLibrary`, `renderWayDetail`, `renderWaysReview`, `renderWaysSearchResults`.
- [ ] Delete `renderWaysSegmentAssignment`, `populateWaysSegmentWayOptions`, and their
      element-map entries; keep `assignSelectedSegmentToGuidanceWay` (retargeted to take a
      segment id + way id), `unassignSelectedSegmentGuidance`, `removeSegmentFromGuidanceWay`,
      `deleteSelectedGuidanceWay`, `beginCreateGuidanceWay`.

### Task 5: Map as assignment surface

**Files:** Modify `editor/editor.js`

- [ ] Add `ways-context` source + `ways-taken-layer`, `ways-candidate-layer` (dashed),
      `ways-member-layer`; show them only in ways mode from
      `updateWorkspaceLayerVisibility()`.
- [ ] `waysContextFeatureCollection()` tags every active feature `member` / `candidate` /
      `taken` / `other`.
- [ ] Ways-mode branch of the `segments-layer` click: candidate → attach (confirm only when
      taken elsewhere), member → select + offer remove, otherwise focus its way.
- [ ] Record `state.guidance.undo` on every membership write and wire `#ways-undo`.

### Task 6: Keyboard triage and wiring test

**Files:** Modify `editor/editor.js`, `tests/test-navigation-way-editor-wiring.mjs`

- [ ] `/` focuses search, `Enter` accepts, `Backspace` rejects, `ArrowRight`/`ArrowLeft`
      moves the queue, `Escape` returns to the library — all ignored while a field has focus.
- [ ] Re-point the wiring test at the new ids/selectors, keeping every transaction,
      digest, 409, atomicity, last-member, audible-verification and server assertion.
- [ ] Run `node tests/test-navigation-way-editor-wiring.mjs`, `node tests/test-ways-workspace.mjs`,
      `node tests/test-navigation-way-editor.mjs`, `node tests/test-navigation-ways.mjs`,
      then the full `npm test`. Commit.
