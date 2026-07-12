# Cycleways Sticker Studio Implementation Plan

**Date:** 2026-07-11

## Phase 1: Sticker generation (implemented)

1. Preserve the supplied assets and add non-destructive adult, child, teen, and
   commuter rider templates for men/women and boys/girls.
2. Implement pure helpers for destinations, caption wrapping, filenames, pixel
   dimensions, and physical QR module validation.
3. Build the local Sticker Studio form and live SVG preview.
4. Add self-contained SVG, print-resolution PNG, and repeated A4 print output.
5. Cover the pure helpers with Node tests.
6. Run the tests and production build, then visually verify representative male,
   female, Hebrew, and QR configurations in the browser.

## Phase 2: Placement map MVP (implemented 2026-07-11)

1. Define schema-versioned pure models and validators for campaigns, locations,
   design versions, placements, status events, and verification records.
2. Add fixtures and unit tests for valid lifecycle transitions, replacements,
   derived verification state, immutable design versions, and GeoJSON export.
3. Create `marketing/sticker-data/registry.json` with an empty version-1 registry.
4. Add a small local Node persistence service with validated reads, atomic writes,
   revision conflict detection, backup-on-write, and JSON/GeoJSON export.
5. Add Create/Locations workspace navigation without changing the current
   generator behavior.
6. Load Mapbox GL using the existing token convention and render locations as a
   clustered GeoJSON source with status-derived pin styling.
7. Implement map click/current-location creation, search, filters, and a location
   detail drawer with permission and planning fields.
8. Implement placement assignment and the planned → assigned → placed lifecycle,
   requiring timestamps and actual coordinate confirmation at the appropriate
   transitions.
9. Add verification records, derived current/overdue/failed state, and the field
   quick actions for placed, verified, needs-attention, missing, and removed.
10. Connect the generator to a selected placement so export creates/reuses an
    immutable design version and records the encoded QR identity/destination.
11. Implement replacement history and a print manifest for individually assigned
    placements.
12. Add browser coverage for map creation, filters, lifecycle guards, version
    assignment, reload persistence, and revision conflicts.

## Phase 3: Tracking and field operations (partially superseded by serverless design)

1. Add placement short-code redirect records and a static-deployment route for
   `cycleways.app/s/:code`. **Implemented.**
2. Add privacy-preserving aggregate scan events without scanner geolocation or
   fingerprinting. **The local endpoint exists for development, but it is not a
   production feature and must be replaced by the Phase 4 client-side GA event.**
3. Add optimized field-photo ingestion and a storage migration path.
   **Implemented with full + thumbnail WebP output and relative references.**
4. Add mobile field mode and explicit revision-conflict UI. **Implemented as a
   responsive field surface with safe conflict reload; live multi-device sync is
   intentionally out of scope for the repository-backed serverless model.**
5. Add verification rides, campaign dashboards, inventory/batch tracking, and
   candidate coverage scoring. **Implemented.**

## Phase 4: Complete serverless tracking and lifecycle

1. Make the generated placement URL prominent immediately after code creation,
   with copy, open/test, destination, active state, and publish-state messaging.
2. Extend the privacy-minimized static redirect artifact with analytics-safe
   campaign, destination, and design-variant fields; continue excluding all
   coordinates and private/free-form data.
3. On `/s/:code`, emit one client-side GA4 `sticker_scan` event, then navigate on
   event callback or a 500–800 ms fallback timeout. Redirect even when GA is
   unavailable or blocked.
4. Append `utm_source=physical_sticker`, `utm_medium=qr`, and stable campaign/code
   values to Cycleways destinations without overwriting intentional destination
   parameters.
5. Remove production reliance and UI claims around the writable scan endpoint;
   label analytics as measured visits rather than exact scans.
6. Add a Studio analytics guide covering custom-dimension registration,
   Realtime/DebugView validation, a placement-comparison Exploration, and
   interpretation by days installed.
7. Add `archivedAt`/`archivedReason` to locations, Archive/Restore actions,
   archived filtering, and a guard requiring all placements to be inactive.
8. Add permanent deletion only for completely unused location drafts, with
   model-level guards, named confirmation, and unit/browser tests.
9. Ensure removed codes resolve to a friendly retired-sticker screen and are
   never reassigned or attributed to replacements.
10. Update Hebrew and English privacy disclosures to match the existing GA tag
    and the new sticker event before release.
11. Add tests for public-artifact privacy, immutable/unreused codes, UTM merging,
    GA failure/timeout navigation, inactive links, archive/restore, and safe
    draft deletion.
12. Browser-test the complete plan → URL → design → place → verify → remove →
    archive flow at desktop and mobile breakpoints.

Expected validation:

- Route slugs resolve to canonical `/routes/:slug` URLs.
- Invalid custom URLs block QR generation rather than silently encoding bad data.
- QR output always includes a four-module quiet zone.
- The UI warns when a dense QR produces modules below 0.4 mm at print size.
- PNG dimensions match the selected millimetres and DPI.
- Hebrew captions keep their direction and never exceed two generated lines.
- Denied locations cannot be assigned an active placement.
- A placed sticker has an actual coordinate and placement timestamp.
- Verification records preserve expected and observed QR destinations.
- Replacements preserve the complete prior placement and design history.
- Reloading the registry preserves locations and rejects stale conflicting saves.
- GeoJSON export includes operational state but excludes private notes/photos by
  default.
