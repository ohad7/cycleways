# Mobile planner drawer UX — implementation plan

**Date:** 2026-07-02
**Status:** Implementing first web slice.

## Scope

Implement the mobile-web drawer fixes from `design.md` without changing desktop
or native-app behavior:

- route-loaded snap policy;
- measured peek height;
- single fixed mobile playback transport;
- mobile planner viewport ownership;
- richer route-ready peek summary with mobile share;
- mobile hint toast placement;
- focused RTL/touch/copy fixes.

No app-specific CTA ships in this slice. Until the app is published, mobile
handoff actions are web-native share/copy, route details, and GPX. Desktop keeps
the QR-based "שלחו לטלפון" action.

## Tasks

1. **Documentation alignment**
   - Update `design.md` so it reflects current entry points: direct `?route=`,
     `/routes` "פתח במפה", route-story edit/open actions, browser history, and
     future in-place preview.
   - Record that this supersedes the web auto-dock-on-play decision from
     `plans/route-playback-dock/`.

2. **Snap policy**
   - Open Build entry with an empty route at `half`.
   - Keep hand-built 0→route-ready transitions at `half`, unless the user has
     manually snapped the sheet elsewhere in the current route session.
   - Keep Discover route cards linked to `/routes/<slug>`; planner entry for
     catalog routes happens from route-page CTAs or direct `?route=` links.
   - Detect route-param restore/select fit requests and auto-open to `half` on
     mobile.
   - Remove mobile play→`half` auto-snap.
   - Route-loaded auto-snaps reset the manual snap lock; same-session manual
     sheet snaps block later automatic snap changes.

3. **Measured peek**
   - Extend `offsetsForHeight(shellHeight, peekHeight)` and update the unit
     tests.
   - Measure handle + peek content inside `BottomSheet`.
   - Set `--front-sheet-peek-height` on the `front-shell` parent from the same
     measurement so map overlays and route-point actions use the real value.

4. **Playback transport**
   - Do not render the Build-panel playback copy on mobile.
   - Keep one map-level playback transport on mobile and position it fixed
     above the drawer using snap-specific offsets (`peek` measured height,
     `half` as `50dvh`).
   - Hide the mobile map-level playback transport at `full` snap.

5. **Mobile planner viewport**
   - Hide `ContentSections` while the mobile planner map/sheet is mounted.
   - Lock body scrolling for the mobile planner view; Discover home keeps its
     existing scrolling page.
   - Keep the compact mobile Build topbar ("מסלולים" back control and
     "בניית מסלול" header) above the route content.

6. **Peek summary and actions**
   - Fix point-count Hebrew singular.
   - Show route distance + ascent once a route is ready.
   - Keep the route-page chip for catalog routes.
   - Add a compact mobile share button in the route-ready peek row.
   - Use native `navigator.share` when available, falling back to clipboard.

7. **Hints and elevation touch/RTL**
   - Move mobile hints to a bottom toast above the transport/peek stack.
   - Auto-hide mobile hints session-locally; only explicit dismiss or progress
     marks them permanently seen.
   - Add touch highlight handling for elevation grade bands.
   - Wrap elevation cursor numeric/unit runs with LTR isolation.

8. **Validation**
   - Update affected unit and Playwright tests:
     - `tests/test-sheet-snap.mjs`;
     - mobile sheet route-load snap expectations;
     - mobile playback expects the fixed map transport, not panel transport.
   - Run focused node tests and mobile Playwright specs.
