# Navigation hand-off implementation plan

**Date:** 2026-07-13
**Design:** [design.md](./design.md)
**Status:** Phases 1–2 and repository validation from Phase 3 implemented;
signed-device and post-deployment checks remain release tasks. Phase 4 is
deferred until App Store launch.

**Goal:** Replace user-facing native `cycleways:///` route shares with canonical
HTTPS Universal Links, associate the production website with the iOS app, and
retain automatic mobile-web fallback without showing pre-launch app promotion.

## Phase 1 — Canonical public route sharing

1. Add a platform share-location adapter separate from the routing-shard
   loader location.
   - Web continues to build links relative to its current page location.
   - Native always uses `https://www.cycleways.app/`.
2. Make the shared application controller pass the share location to
   `buildShareInfo` instead of passing the shard-loader location.
3. Keep custom-scheme parsing and launch support for backward compatibility.
4. Add regression coverage proving native public sharing uses HTTPS while its
   internal location remains `cycleways:///`.

Expected result: iOS Share emits
`https://www.cycleways.app/?route=<token>`; web sharing and route encoding are
unchanged.

## Phase 2 — Website/app association

1. Add `public/.well-known/apple-app-site-association` for
   `9K5YBKH2UN.app.cycleways.mobile`.
2. Match only non-empty root `route` links, `/routes/*`, and `/featured/*`.
3. Add `applinks:www.cycleways.app` to `expo.ios.associatedDomains`.
4. Add repository tests for the AASA identity, URL scope, and Expo associated
   domain so the website and app halves cannot drift.
5. Confirm a production web build copies the extensionless AASA file to the
   correct `dist/.well-known/` path.

Human release prerequisite: enable Associated Domains for the Apple App ID,
regenerate/install the provisioning profile if necessary, and produce a newly
signed build. The entitlement cannot be retrofitted into an already installed
IPA.

## Phase 3 — Inbound link verification

1. Extend launch-target tests with canonical HTTPS route-token, route-detail,
   and featured-detail URLs.
2. Verify malformed/external hosts continue to fall back safely.
3. Run the focused Node tests, Expo configuration inspection, and the web
   production build.
4. After deployment, verify the live AASA endpoint returns `200`, JSON content,
   and no redirect.
5. On a freshly installed signed simulator/device build, tap links from Notes
   or Messages and test:
   - cold `/?route=...` launch → Build with the route restored;
   - warm `/?route=...` launch → Build with the new route;
   - `/routes/<slug>` and `/featured/<slug>` → RouteDetail;
   - app absent → the equivalent mobile-web content.

Do not use Safari address-bar entry as a pass/fail test.

## Phase 4 — App Store launch (deferred)

1. Once the App Store ID is final, add the Apple Smart App Banner and route
   app argument behind a launch-ready configuration switch.
2. Add the three contextual app entry points from the design without removing
   web/GPX alternatives.
3. Validate same-domain Safari behavior. If an explicit CTA needs stronger
   hand-off than the Smart App Banner provides, design and host
   `open.cycleways.app` with its own direct AASA response and canonical web
   fallback.
4. Add hand-off analytics before expanding promotion.

No Phase 4 UI or metadata ships in the pre-App Store implementation.
