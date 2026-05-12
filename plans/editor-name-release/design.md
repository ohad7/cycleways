# Editor Name Release Design

## Goal

Make segment names reusable after split/deprecation without breaking old route
links or weakening the current name-keyed site data model.

The current stack still requires globally unique segment names because:

- `segments.json` is keyed by segment name.
- The public site joins GeoJSON features to metadata by name.
- The processor builds source metadata with a name-keyed dictionary.
- The editor server rejects duplicate names before saving.

So deprecated records cannot keep a user-facing name if an active segment should
reuse it.

## Decision

Keep names globally unique, but add an editor workflow that renames inactive
records out of the way.

When a segment is split:

```text
Before:
  active parent: "דרך המנפטה", id 15

After:
  deprecated parent: "דרך המנפטה [split archive 15]", id 15
  first child:        "דרך המנפטה"
  second child:       "דרך המנפטה - 2"
```

The deprecated parent keeps:

- its stable `id`
- `status: "deprecated"`
- `deprecated: true`
- `originalName`
- `routeAnchors`

Route compatibility keeps working because old route URLs decode by segment ID,
not by name.

## Manual Release

If an old inactive record already blocks a name, the editor should expose a
`Release archived name` action next to the selected active segment name.

Behavior:

- The action appears only when the selected segment's current name is also held
  by inactive records.
- Clicking it renames those inactive records to unique archive names.
- The old name is preserved in `originalName` if that field is missing.
- The selected active segment keeps the desired name.

Example:

```text
inactive: "שביל חום", id 44
active:   "שביל חום", id 201

after release:
inactive: "שביל חום [archive 44]", originalName: "שביל חום"
active:   "שביל חום"
```

## Non-Goals

- Do not show all deprecated records in the main segment list.
- Do not allow duplicate names.
- Do not migrate the public site to ID-keyed joins in this slice.

