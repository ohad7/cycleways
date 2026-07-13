# Navigation hand-off — the app owns navigation, the web hands routes to it

**Date:** 2026-06-10 (updated 2026-07-13)
**Status:** accepted; pre-App Store repository slice implemented
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

Universal Link plumbing may ship before the app is publicly available:

- `https://www.cycleways.app/?route=...` (and `/featured/<slug>`,
  `/routes/<slug>`) register as iOS Universal Links / Android App Links, so
  a tap on any shared CycleWays URL on a phone with the app installed opens
  the route *in the app*, already loaded.
- The app already restores `?route=` deep links (`rn-mobile-route-restore/`);
  this extends that to OS-level link claiming, plus the featured/catalog
  route pages.
- Without the app installed, the same URL is simply the mobile-web page —
  the fallback is automatic by construction.
- A TestFlight or locally signed app can therefore exercise the production
  hand-off before App Store launch without exposing any install promotion on
  the website.

The custom `cycleways:///` scheme remains supported as an internal and
backward-compatible launch format, but it is never emitted by a user-facing
share action. Native shares use the same canonical HTTPS URL as web shares.

### D3. Hand-off is additive, never a wall

Hard rules, in force from day one:

- **No dead-end app redirects.** Every "open in app" affordance sits next to
  a fully working web alternative (view the route, download GPX, share).
  No interstitials, no feature-gating of existing web functionality behind
  the app.
- **No visible app promotion ships on the web before the app is in
  production.** The invisible AASA association file may ship early so signed
  development/TestFlight builds can be verified. Until launch the web stays
  self-sufficient; mobile-web Build keeps working (planning-surface D4).
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

### D5. Canonical public link origin is `www`

The public hand-off origin is `https://www.cycleways.app`, specifically:

```text
https://www.cycleways.app/?route=<encoded-route>
```

Use HTTPS, never HTTP. Although `https://cycleways.app` is a valid public
entry point, the current GitHub Pages configuration redirects it to
`https://www.cycleways.app`. Apple requires the
`/.well-known/apple-app-site-association` (AASA) endpoint to be served without
a redirect, so the app claims `www.cycleways.app` directly. Supporting the
apex domain as an associated domain is deferred unless its hosting can serve
its own AASA file with a direct `200` response.

Share URL construction must not reuse the native asset-loader or synthetic
location URL. The native routing environment deliberately uses
`cycleways:///`; public link generation uses a separate platform share
location whose native value is the canonical HTTPS site.

### D6. Claim content links, not the whole website

The iOS AASA file associates `9K5YBKH2UN.app.cycleways.mobile` with:

- `/` only when it contains a non-empty `route` query item;
- `/routes/*`;
- `/featured/*`.

Ordinary home-page visits, legal/support pages, and `/s/*` sticker redirects
stay on the website. The app continues to validate the host, path, slug, and
route token after launch; AASA matching is routing policy, not an input trust
boundary.

The Expo source configuration declares
`applinks:www.cycleways.app`. A new signed native build is required after this
entitlement changes, and the Associated Domains capability must be enabled for
the Apple App ID before generating the provisioning profile.

### D7. Correct iOS test model

Typing or pasting a URL into Safari's address bar is not a Universal Link
test: direct browser navigation stays in Safari. A same-domain link tapped
while already browsing `www.cycleways.app` may also stay in Safari by design.

Test a newly installed signed build by tapping the HTTPS URL from Notes,
Messages, or Mail, covering both cold and warm launches. Reinstall after AASA
or entitlement changes because iOS and Apple's associated-domain CDN cache the
association.

### D8. App Store launch promotion

Before App Store launch, do not add the `apple-itunes-app` meta tag, an install
banner, or an "open in app" CTA.

At launch:

- add an Apple Smart App Banner with the final App Store ID and the current
  route URL as its app argument;
- enable the three contextual entry points in D3;
- preserve the adjacent web and GPX actions.

An explicit button rendered on `www.cycleways.app` must not assume that a
same-domain Universal Link will leave Safari. Prefer the Smart App Banner. If
product testing later calls for a stronger explicit hand-off, create a
separately hosted and associated domain such as `open.cycleways.app`; it must
serve its own AASA file without redirect and fall back to the canonical web
route when the app is absent.

## Non-goals

- The navigation feature set itself (off-route logic, voice, recording) —
  designed in `rn-*` plans.
- Accounts/sync. The link-based hand-off deliberately requires none; if
  accounts arrive later, the recents strip (planning-surface D1) is the
  migration point.
- App-store/marketing pages and the final install-promotion presentation. D8
  records the launch architecture, but this implementation does not ship it.

## Sequencing (proposed)

1. **Now (pre-app):** ship canonical HTTPS sharing, the AASA file, the app
   entitlement, and app-side handling/tests. Keep all web promotion hidden.
   Send-to-phone QR and seamless `?route=` loading remain fully useful without
   the app.
2. **At app production launch:** add the Smart App Banner and the three web
   entry points (D3), using the same universal route URL and respecting D8's
   same-domain Safari constraint.
3. **Post-launch:** measure hand-off (QR scans, app-link opens vs. web
   fallbacks) before adding any further app promotion.
