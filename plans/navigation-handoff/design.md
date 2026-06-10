# Navigation hand-off — the app owns navigation, the web hands routes to it

**Date:** 2026-06-10
**Status:** design (not yet planned; app not yet in production)
**Related:** [discovery-surface](../discovery-surface/design.md), [planning-surface](../planning-surface/design.md), `rn-mobile-route-restore/`, `rn-mobile-location/`, `route-sharing-v4/`

## Context

Decided June 2026: **navigation and ride recording are app-only.** Mobile-web
geolocation cannot sustain navigation — no background location (GPS stops
when the screen locks), throttled updates, unreliable audio cues, and battery
behavior we don't control. A bad web-navigation experience would become the
product's reputation. One-shot location for discovery stays on the web
(discovery-surface D1); anything continuous lives in the native app
(`apps/mobile`, not yet in production).

This document designs the *bridge*: how the three surfaces — mobile-web
discovery, desktop planning, app navigation — feel like one product, and the
rules that keep the hand-off from damaging the web experience before and
after the app ships.

The target flow is: **plan on desktop Sunday evening → the route is on the
phone Monday morning → navigate it in the app.**

## Design decisions

### D1. The `?route=` encoding is the universal currency

The compact encoded-route string (per `route-sharing-v4/`) is the single
hand-off format between all surfaces: share links, QR codes
(planning-surface D3), localStorage drafts/recents (planning-surface D1), and
app deep links. No new transfer format, no server hand-off store. Any surface
that can produce a route produces this string; any surface that can consume a
route accepts it.

### D2. Universal/app links into the app

When the app is in production:

- `https://www.cycleways.app/?route=...` (and `/featured/<slug>`,
  `/routes/<slug>`) register as iOS Universal Links / Android App Links, so
  a tap on any shared CycleWays URL on a phone with the app installed opens
  the route *in the app*, already loaded.
- The app already restores `?route=` deep links (`rn-mobile-route-restore/`);
  this extends that to OS-level link claiming, plus the featured/catalog
  route pages.
- Without the app installed, the same URL is simply the mobile-web page —
  the fallback is automatic by construction.

### D3. Hand-off is additive, never a wall

Hard rules, in force from day one:

- **No dead-end app redirects.** Every "open in app" affordance sits next to
  a fully working web alternative (view the route, download GPX, share).
  No interstitials, no feature-gating of existing web functionality behind
  the app.
- **Nothing app-related ships on the web before the app is in production.**
  Until then the web stays self-sufficient; mobile-web Build keeps working
  (planning-surface D4).
- After launch, app entry points appear in exactly three places:
  1. A route loaded on mobile web → "פתחו באפליקציה לניווט" button beside
     GPX/share.
  2. The desktop Build panel's send-to-phone QR (planning-surface D3) — the
     QR encodes the same universal link, so it opens the app when installed
     and mobile web when not.
  3. Featured/route story pages on mobile → the same button in the route
     stats/actions block.

### D4. Division of navigation responsibilities

- **App:** continuous GPS, follow/heading camera, off-route awareness, ride
  recording, offline assets (`rn-offline-assets/`), audio cues. All future
  navigation design happens in `rn-*` plans, not here.
- **Web:** never claims navigation. The planner's playback ("נגן מסלול על
  המפה") stays a *preview*, and copy should keep it clearly so.
- **GPX stays forever** as the escape hatch for Garmin/Wahoo riders — the
  app is an addition to, not a replacement for, the GPX path.

## Non-goals

- The navigation feature set itself (off-route logic, voice, recording) —
  designed in `rn-*` plans.
- Accounts/sync. The link-based hand-off deliberately requires none; if
  accounts arrive later, the recents strip (planning-surface D1) is the
  migration point.
- App-store/marketing pages, install banners, smart app banners — decide at
  app launch, within the D3 rules.

## Sequencing (proposed)

1. **Now (pre-app):** nothing ships on the web under this plan. The
   prerequisites ride in the other two plans: send-to-phone QR
   (planning-surface D3) and seamless `?route=` loading on mobile web
   (discovery-surface D3) — both fully useful without the app.
2. **At app production launch:** Universal/App Link registration + the three
   web entry points (D3), and app-side claiming of featured/catalog URLs
   (extending `rn-mobile-route-restore/`).
3. **Post-launch:** measure hand-off (QR scans, app-link opens vs. web
   fallbacks) before adding any further app promotion.

Steps 2–3 get implementation plans when the app's production date is real.
