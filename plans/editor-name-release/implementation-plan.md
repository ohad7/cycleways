# Editor Name Release Implementation Plan

## Phase 1: Split Parent Archive Naming

- Rename split parents to a generated archive name.
- Preserve `originalName`.
- Let the first child reuse the original segment name when available.
- Keep the second child on a numbered name.

Acceptance criteria:

- Splitting a segment frees the original name.
- Route compatibility fields remain on the deprecated parent.

## Phase 2: Release Archived Name Action

- Add a `Release archived name` button near the segment name field.
- Detect inactive records that have the same name as the selected active record.
- Rename those inactive records to unique archive names.
- Preserve their previous name in `originalName`.
- Mark the source dirty and keep the selected active segment selected.

Acceptance criteria:

- A selected segment can reuse a name held by deprecated/legacy/draft records.
- Active duplicate conflicts are not silently changed.

## Phase 3: Validation

- Keep editor/server duplicate-name validation unchanged.
- Warn when active split children still use generated trailing-number names such
  as `Segment - 1`.
- Block Promote while those generated split-child names remain.
- Run source build validation after implementation.
- Run route-manager tests to confirm route IDs are unaffected.
