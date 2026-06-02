# Featured Route — Mobile-Web Layout: Implementation Plan

Date: 2026-06-02
Design: `plans/featured-mobile-layout/design.md`

Scope: mobile-web editorial polish of the featured route page, plus removal of
the fullscreen map button. Desktop must not regress. No native app work.

## Step 0 — Remove the "מפה מלאה" fullscreen map button (web + desktop)

- `src/components/featured/FeaturedRouteMap.jsx`: remove the fullscreen trigger
  button, the fullscreen overlay (`role="dialog"`), and the now-unused
  fullscreen state/effects (body-scroll lock, Escape handler, focus
  restore, `triggerRef`/`closeRef`). Keep the inline interactive map. The
  `allowFullscreen` prop becomes a no-op/removed.
- `src/featured/sovev-beit-hillel.jsx`: drop the `allowFullscreen` prop on the
  side map.
- `src/components/featured/featured.css`: remove `.featured-map-fullscreen-btn`,
  `.featured-map-fullscreen-overlay`, `.featured-map-fullscreen-close`,
  `.featured-map-inline--hidden`.
- `tests/e2e/featured-route-layout.spec.mjs`: remove the fullscreen test
  case(s) that click `.featured-map-fullscreen-btn` / assert the overlay.

## Step 1 — Header editorial title block (mobile)

In the `max-width: 980px` block of `featured.css`:
- Add `kicker` to the header-body `grid-template-areas` (currently missing).
- Override `.featured-route-video-first .featured-route-stats` for mobile:
  `flex-direction: row`, wrap, remove `border-inline-start`/`padding-inline-start`,
  add a hairline `border-top`, even spacing, tabular numerals.
- Tighten header padding and title clamp for narrow widths.

## Step 2 — On-video POI preview overlay (mobile)

- Scale `.sbh-video-poi-preview` down on phones: smaller image
  (`grid-template-columns`), reduced font sizes, capped width, tighter padding,
  so it does not cover the video.

## Step 3 — Map (mobile)

- Ensure `.sbh-mobile-map.featured-map-inline` has a comfortable fixed height
  and full-width treatment; confirm marker taps / video-cursor still work inline
  now that fullscreen is gone.

## Step 4 — Route blurb + "על המסלול" (mobile)

- Reduce `.sbh-route-about` padding on mobile; set a readable measure; confirm
  single-column collapse (already added to the 980 breakpoint).
- Check `.sbh-route-panel` mobile box styling reads well with the shortened copy.

## Step 5 — POI story cards (mobile)

- In the `max-width: 767px` block: refine `.sbh-poi-story` padding (~16px),
  `.sbh-poi-story-images` aspect ratios, and `.sbh-poi-story-kicker`/`h3` sizing.
- Confirm alternating layout stays neutralized (single column) — already handled.

## Step 6 — Safe areas & top nav

- `styles.css`: add `env(safe-area-inset-top)` to the fixed `.header` padding and
  `env(safe-area-inset-bottom)` to the page bottom, guarded so desktop is
  unaffected.
- Verify featured nav links open/scroll/close correctly from the mobile
  hamburger menu.

## Step 7 — Vertical rhythm

- Normalize section top-margins/padding across header → video → map → blurb →
  about → stories so spacing is consistent on phones.

## Verification

- Screenshots at 390px and ~768px after each visual step; a 1440px desktop check
  to confirm no regression.
- `npm test` is unaffected (pure presentation); run the featured e2e specs
  (`tests/e2e/featured-route-*.spec.mjs`) to confirm the fullscreen removal is
  reflected and nothing else broke.

## Out of scope / deferred

- Native RN featured screen (future phase; see design doc). Includes relocating
  `videoSync.js` into `@cycleways/core` when that work starts.
