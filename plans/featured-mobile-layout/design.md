# Featured Route — Mobile-Web Layout & App-Sharing Design

Date: 2026-06-02

## Goal

Bring the Sovev Beit Hillel featured-route page (currently desktop-tuned) to a
fully polished **mobile-web** experience, and define how — and how much of — this
screen can be shared with the **React Native iPhone app**.

## Context

The featured page (`src/featured/sovev-beit-hillel.jsx` +
`src/components/featured/*`) is a web React + CSS screen:

- Map: `mapbox-gl-js` (`MapView`).
- Video: YouTube **iframe** with a custom scrubber, synced to route position.
- Layout: a "video-first" desktop composition (large video, right rail with a
  short route blurb + compact map + live distance), a full-width "על המסלול"
  route description, and a below-fold POI story list.

The iPhone app (`apps/mobile`) is **React Native / Expo**, using
`@rnmapbox/maps` natively and sharing `@cycleways/core` for data and route
logic. It does **not** render web DOM/CSS.

### What can be shared web ↔ native

| Layer | Shareable? |
|-------|-----------|
| Data, copy, route geometry, POIs | Yes — `@cycleways/core` + `public-data` |
| Video↔route sync math (`videoSync.js`) | Yes, once moved into `@cycleways/core` |
| Design language (palette, type, spacing, rhythm) | Conceptually, re-expressed in RN |
| Component UI (DOM + CSS) | **No** — must be rebuilt in RN, or embedded via WebView |

Conclusion: the *layout* cannot be literally shared across web and RN at the
component level. We share data + sync logic + design intent, and the native
screen is a separate implementation.

## Decisions

- **This pass = mobile web only**, pushed to full editorial polish. Desktop must
  not regress.
- **iPhone app = future native reimplementation** (Option B), deferred until a
  discovery path to featured routes exists in the app. We keep the shared pieces
  reusable: data/copy via core/public-data, and we plan to relocate `videoSync`
  into `@cycleways/core` so the native screen can import it.
- **Remove the "מפה מלאה" (fullscreen map) button** from the featured map on both
  mobile and desktop. The current fullscreen overlay is not the right approach;
  it is removed for now (button + overlay + related state), to be revisited
  separately.

## Mobile-web design

Phone-tailored single-column layout (not a forced desktop mirror), preserving
the same content order: header → video → map → short route blurb → "על המסלול"
→ POI stories.

1. **Header (editorial title block).** Single-column on phones with an explicit
   `kicker` row. Stats become a clean horizontal metric row under the title
   (no inline-start divider/padding; a hairline top rule), tabular and evenly
   spaced. Tighter padding and title clamp.

2. **Video + POI preview overlay.** Keep the 16:9 video; refine frame
   radius/margins. Shrink the transient on-video POI preview overlay on phones
   (smaller thumbnail, tighter copy, capped width) so it never buries the video.

3. **Map.** Comfortable fixed height, full-width, no fullscreen button. The map
   remains interactive (pan/zoom, marker taps, video-cursor) inline.

4. **Route blurb + "על המסלול".** Reduced padding and a readable measure on
   small screens; the about section collapses to a single column.

5. **POI story cards.** Single column (alternating layout neutralized), lead
   photo dominant then copy; refined padding (~16px), image aspect ratios, and
   the "תחנה N · distance" kicker sizing.

6. **Safe areas & top nav.** Add `env(safe-area-inset-*)` padding to the fixed
   top nav and page bottom for iOS Safari / standalone PWA. The featured nav
   links work from the mobile hamburger menu and close it on tap (already wired).

7. **Vertical rhythm.** One consistent section spacing/padding scale across the
   page so it reads as one designed screen on phones.

## Non-goals

- No change to the video-sync behavior, route geometry, or POI data.
- No native app implementation in this pass (documented as a deferred phase).
- No new discovery/navigation path into featured routes in the app.
- Editor/pipeline-owned data files are untouched.

## Verification

Real-render screenshots at 390px (phone) and ~768px (tablet) for each step, plus
a desktop check to confirm no regression. Update the featured e2e specs that
referenced the removed fullscreen button.

## Future phase (deferred): native featured screen

When a discovery path exists in the app, build a native RN featured screen:
`@rnmapbox/maps` for the map, a native YouTube/video component, RN layout
mirroring this design, reusing core data and the relocated `videoSync` logic.
Tracked as a follow-up; not part of this implementation.
