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

## Phase 3: Tracking and field operations (repository implementation complete 2026-07-11)

1. Add placement short-code redirect records and a static-deployment route for
   `cycleways.app/s/:code`. **Implemented.**
2. Add privacy-preserving aggregate scan events without scanner geolocation or
   fingerprinting. **Implemented in the local/compatible API; production static
   hosting requires a configured writable endpoint.**
3. Add optimized field-photo ingestion and a storage migration path.
   **Implemented with full + thumbnail WebP output and relative references.**
4. Add mobile field mode and explicit revision-conflict UI. **Implemented as a
   responsive field surface with safe conflict reload; offline mutation queue is
   deferred until a hosted multi-device store exists.**
5. Add verification rides, campaign dashboards, inventory/batch tracking, and
   candidate coverage scoring. **Implemented.**

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
