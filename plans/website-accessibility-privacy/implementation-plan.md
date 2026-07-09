# Website Accessibility and Privacy Compliance — Implementation Plan

**Date:** 2026-07-10  
**Status:** Ready for implementation after the owner inputs in Task 0  
**Design:** `plans/website-accessibility-privacy/design.md`

## Objective

Implement the accepted website accessibility, exemption, privacy, analytics,
and legal-disclosure design without adding a banner, a user-consent flow, an
accessibility overlay, or a major UX/UI change.

The release should leave the website visually familiar while making the legal
pages truthful, reducing unnecessary analytics disclosure, publishing the
low-turnover accessibility exemption and alternatives, and repairing important
first-party accessibility barriers that can be fixed without redesigning the
map-first experience.

## Non-negotiable guardrails

- Do not add a cookie or analytics banner.
- Do not add a consent prompt, checkbox, modal, first-visit choice, or consent
  settings screen.
- Do not add a floating accessibility button, widget, or overlay.
- Do not claim full AA compliance or certification.
- Do not send route query payloads, search coordinates, precise location, or
  user-entered content to Google Analytics.
- Do not make a major map, navigation, visual, or information-architecture
  redesign.
- Keep Google Analytics active on production web pages.
- Keep native-app accessibility out of this website implementation.
- Treat the consent banner described in the design as future work only.

## Release strategy

The repository work may be developed in ordered slices, but Tasks 2–5 must ship
as one production release. In particular, do not publish a privacy statement
claiming sanitized Analytics behavior before that behavior is deployed.

Use the existing production/local/automation Analytics gating: production may
load Analytics, while localhost, private development hosts, native app embeds,
and automated Playwright browsers remain excluded.

## Task 0 — Obtain owner inputs and record the compliance baseline

### Owner inputs

Before legal copy is finalized, obtain:

- the individual operator's exact legal name for the privacy controller
  disclosure;
- confirmation that `cycleways.app@gmail.com` remains the public privacy,
  accessibility, and support contact;
- confirmation that the operator still has no revenue and no employees;
- access to the Google Analytics property settings;
- access to edit the public Google Form; and
- approval of a feedback-response retention rule. The recommended default is:
  remove the sender's personal identifiers no later than 12 months after the
  report is resolved, while retaining any resulting non-personal map fact.

Do not publish the operator's home address by default. Escalate that question to
Israeli counsel if a mailing address is considered necessary.

### Baseline record

- Record the current GA4 measurement ID and property name privately.
- Confirm whether Google Signals, Ads linking, remarketing, and data-sharing
  settings are currently enabled.
- Capture the current Google Form fields and which are required.
- Confirm the current production behavior described in the design:
  - `index.html` starts GA4 automatically;
  - `PrivacyPage.jsx` says there is no analytics;
  - search-success events send exact `lat` and `lng` values; and
  - default page views can receive the full URL including `?route=`.
- Keep evidence supporting the low-turnover exemption outside the public
  repository. Do not commit tax or personal financial records.

### Exit criteria

- The operator name/contact and retention decision are available for copy.
- The owner can perform the external Google tasks in Task 5.
- The exemption facts have been re-confirmed as of implementation time.

## Task 1 — Add canonical legal metadata and reusable legal navigation

### Shared configuration

Update `packages/core/src/config/appLinks.js`:

- add `ACCESSIBILITY_URL = ${SITE_ORIGIN}/accessibility`;
- add a single canonical operator-name value after Task 0 supplies it; and
- keep the existing privacy, terms, support, feedback-form, and email constants.

Update `tests/test-app-links.mjs` to assert the accessibility URL, operator name
presence, existing URLs, and contact email format.

### Shared legal links

Create small reusable web components, for example:

- `src/components/SiteLegalLinks.jsx` — semantic navigation with Privacy,
  Terms, Accessibility, and Support links; and
- `src/components/SiteFooter.jsx` — the existing footer presentation composed
  around `SiteLegalLinks`.

Refactor `src/components/ContentSections.jsx` to use the shared footer instead
of duplicating the links.

Update `src/components/PageShell.jsx` so document/catalog/route pages can use
the shared footer. The planner `App` must explicitly suppress the PageShell
footer because its desktop content already owns a footer and its mobile shell
is viewport-constrained.

For the full-screen mobile Discover and Build surfaces, place the compact legal
links at the end of the existing scrollable panel content, not in a fixed bar:

- pass an optional compact legal-links slot from `App.jsx` to
  `DiscoverPanel.jsx` and `BuildPanel.jsx`; and
- render the slot only in the mobile full-screen/sheet presentation so desktop
  panel chrome does not gain another visible legal block.

Keep the presentation visually subordinate and reuse current typography and
link colours. Ensure the mobile Build/Discover action controls do not obscure
the links at the end of the scroll area.

### Tests

Extend `tests/e2e/legal-pages.spec.mjs` to verify:

- all four legal/support destinations appear in the desktop home footer;
- document and route pages expose the same links;
- the mobile Discover and Build scroll surfaces expose the compact legal links;
- there is no first-visit consent dialog/banner; and
- links have stable accessible names and correct `href` values.

### Exit criteria

- Accessibility has a canonical URL.
- Legal links are reusable rather than copied across pages.
- All public surfaces have a practical path to the Accessibility page without
  introducing fixed UI or a banner.

## Task 2 — Minimize and sanitize Google Analytics collection

This task changes collection behavior but does not add consent UI.

### Prevent automatic unsafe page views

Update the inline Google tag bootstrap in `index.html`:

- retain the current production/local/embed/automation gating;
- configure GA4 with `send_page_view: false` so the default page view cannot
  transmit the raw `window.location.href`;
- set `allow_google_signals: false`;
- set `allow_ad_personalization_signals: false`; and
- keep the measurement ID in one explicit constant used by the bootstrap.

Do not add Consent Mode commands, a CMP, or consent-state storage in this
implementation.

### Add sanitized SPA page-view tracking

Update `packages/core/src/platform/analytics.js` with pure/testable helpers:

- `analyticsPageLocation(locationLike)` returns only `origin + pathname`;
- it must discard `search` and `hash` unconditionally;
- `trackPageView(locationLike)` queues a GA4 `page_view` containing only the
  sanitized location/path and non-sensitive page metadata; and
- local/private/automation gating remains centralized.

Add a small location observer under the React router in `src/main.jsx` that
calls `trackPageView` for the initial route and each client-side pathname
change. It must not include query-string changes as distinct page-view data and
must not emit a duplicate initial page view.

If product analytics still needs to know that a shared route was opened, retain
only an aggregate boolean such as `has_route`; never send the parameter value or
the full URL.

### Remove precise and user-derived event parameters

Refactor `packages/core/src/platform/analytics.js` and
`packages/core/src/app/useCyclewaysApp.js` so event helpers construct explicit
safe schemas instead of blindly spreading arbitrary `additionalParams`.

At minimum:

- `location_search_success` may include `query_length`, `has_route`, and
  `within_bounds`;
- remove exact `lat` and `lng` from both in-bounds and out-of-bounds search
  success events;
- route load may include only a boolean/count/encoded-length measurement, not
  the encoded route;
- download/share/reset/edit events may retain aggregate counts and rounded
  distance;
- never send the search string, route point coordinates, current-device
  location, message text, email, name, URL, or route geometry; and
- site-authored segment/warning categories may remain only if they cannot carry
  arbitrary user input.

Prefer explicit per-event parameter construction over a blacklist. If the
generic `trackEvent` export remains, document that it accepts only schema-
approved aggregate parameters and cover all current call sites in tests.

Keep `packages/core/src/platform/analytics.native.js` as a no-op; this plan does
not add native analytics.

### Tests

Expand `tests/test-analytics-parity.mjs` or split focused tests as needed:

- `analyticsPageLocation` strips a long `?route=...` and `#fragment`;
- page-view events never contain `?`, `#`, route payloads, or full raw URLs;
- search success contains `within_bounds` but no `lat`/`lng`;
- permitted aggregate events keep their current names and useful counts;
- forbidden parameter keys and representative sensitive values never reach the
  `gtag` spy;
- localhost, private hosts, and automation still suppress tracking; and
- production host tracking still emits events.

Add a focused source/build guard that fails if `index.html` restores an
automatic default page view without `send_page_view: false`.

### Exit criteria

- GA remains active in production.
- No page-view payload receives query or hash data.
- No current custom event receives precise coordinates or user-entered text.
- No consent/banner behavior exists.

## Task 3 — Publish the Accessibility page and exemption notice

### Page and route

Create `src/pages/AccessibilityPage.jsx` using the existing `LegalPage` shell
and styling. Add a lazy `/accessibility` route in `src/main.jsx` and add the URL
to `sitemap.xml`.

The Hebrew page is authoritative for the local audience. Keep an English
summary consistent with the Hebrew text.

### Required content

The page should:

- explain that CycleWays is a free project operated by an individual;
- state that the operator relies on the low-turnover exemption in Regulation
  35ו(ז), based on current annual turnover below NIS 100,000;
- state that no formal accessibility coordinator is appointed because there
  are no employees and the 25-employee threshold is not met;
- say that accessibility improvements are nevertheless made voluntarily;
- describe actual current features only after they are verified;
- disclose known limitations of the interactive map, arbitrary map-based route
  construction, Mapbox, YouTube, and third-party content;
- list available alternatives: route catalog/detail text, warnings, route
  statistics, GPX output, and assistance by email;
- give the accessibility contact email and a useful reporting checklist;
- promise a practical response and alternative assistance without inventing a
  statutory response time that does not apply to the exemption; and
- show the last review date.

Do not use the phrases “fully accessible,” “certified,” “meets every AA
requirement,” or similar absolute claims.

Update `src/pages/SupportPage.jsx` so its “additional documents” section links
to Accessibility.

### Tests

Extend `tests/e2e/legal-pages.spec.mjs`:

- `/accessibility` renders the correct Hebrew H1;
- it contains the exemption basis, contact email, known limitations, and
  alternative access information;
- it contains no full-compliance/certification claim; and
- it is linked from Support and every shared legal-links surface.

### Exit criteria

- The exemption and available alternatives are publicly documented.
- The page is prominent but visually consistent with the existing legal pages.
- The wording does not overstate compliance.

## Task 4 — Make Privacy, Terms, and Support match reality

Complete this task after Task 2 so every technical statement can be verified.

### Privacy policy

Rewrite `src/pages/PrivacyPage.jsx` to identify the individual operator and
accurately describe:

- automatic Google Analytics use for aggregate measurement;
- the absence of an on-site consent prompt as the accepted current posture;
- Analytics data categories, storage/cookies, Google as recipient/provider,
  retention, browser controls, and Google's opt-out mechanism;
- that query strings, URL fragments, and encoded routes are excluded from
  Analytics;
- that custom events exclude search text, exact search coordinates, precise
  device location, route geometry, names, emails, and feedback content;
- Mapbox network requests and requested map area;
- when YouTube code/player requests are made, using wording that matches actual
  loading behavior rather than saying data is sent only after pressing Play if
  that is not true;
- GitHub Pages hosting/access logs and externally hosted fonts/assets;
- local browser storage for drafts, recents, preferences, and recovery guards;
- Google Forms collection of email, optional name, and message;
- the purpose, voluntary nature, consequences of not submitting, recipients,
  retention/deletion rule, and international processing for feedback;
- access/correction request rights and the support email; and
- the no-account/no-first-party-server architecture without falsely claiming
  that no personal information is collected anywhere.

Include a plain statement that continued use is subject to the policy, but do
not claim that the sentence guarantees legally valid consent.

Do not create a separate cookie-policy page.

### Terms of use

Update `src/pages/TermsPage.jsx`:

- identify the individual operator;
- preserve the route-information, safety, changing-conditions, applicable-law,
  and contact sections;
- keep limitations of liability qualified by mandatory law;
- distinguish original site content, Mapbox, OpenStreetMap/ODbL, YouTube, and
  any future repository licence;
- avoid describing the repository as open source until an explicit licence is
  selected and added; and
- ensure the English summary does not contradict the Hebrew terms.

### Support page

Update `src/pages/SupportPage.jsx`:

- add accessibility reporting instructions/link;
- link to Privacy, Terms, and Accessibility;
- keep map-data attribution; and
- make contact wording consistent across all pages.

### Dates and copy consistency

- Update each page's “last updated” date to the actual release date.
- Search the built/source tree for stale claims such as “no analytics,” “no
  tracking,” “never sent,” or “no first-party collection.”
- Ensure Hebrew and English summaries describe the same data flow.

### Tests

Extend legal-page E2E coverage to assert the presence of:

- Google Analytics and automatic aggregate measurement;
- route/query exclusion;
- Google Forms collection;
- rights/contact text;
- the operator identity;
- Mapbox, YouTube, and GitHub Pages disclosures; and
- updated cross-links.

Add negative assertions for the stale “no analytics/tracking” claims.

### Exit criteria

- Public legal copy matches the verified production behavior.
- The terms do not make an unsupported open-source licensing claim.
- No consent banner or consent control has been introduced.

## Task 5 — Complete external Google Form and GA4 owner actions

These steps cannot be completed solely by repository code. They are required
before the combined release is declared complete.

### Google Form

In the public CycleWays Google Form:

- add a concise Hebrew collection notice above the fields;
- identify the operator and `cycleways.app@gmail.com`;
- state that submission is voluntary and intended for support/map feedback;
- explain that Google provides the form/storage infrastructure;
- state the approved retention/deletion rule;
- explain how to request access or correction; and
- remove the full-name field or make it optional.

Suggested structure, with the operator name and retention period filled in:

> מסירת הפרטים בטופס תלויה ברצונך ואינה חובה על פי דין. המידע ישמש את
> [שם המפעיל], מפעיל CycleWays, לצורך טיפול בפנייה ובמשוב על המפה והמסלולים.
> הטופס והמידע נשמרים באמצעות Google. ללא כתובת דוא״ל ותוכן פנייה לא נוכל
> לקבל את הפנייה או להשיב עליה. לבקשת עיון או תיקון אפשר לפנות אל
> cycleways.app@gmail.com. פרטים אישיים יימחקו בהתאם למדיניות הפרטיות של
> CycleWays.

The final wording must match whether email remains required and the chosen
retention rule.

### Google account and GA4 property

The owner should:

- enable multi-factor authentication on the Google account;
- restrict Analytics and Form access to the minimum necessary accounts;
- disable Google Signals;
- confirm no Google Ads property is linked;
- disable advertising personalization/remarketing features;
- choose the shortest practical event/user-data retention option;
- review account/property data-sharing switches and disable nonessential
  sharing; and
- record the review date privately for the annual compliance check.

### Verification

- Open the public form signed out and verify the notice is visible before
  submission.
- Confirm the full-name field is optional or removed.
- Verify the privacy-policy wording matches the form exactly.
- Verify GA4 Admin shows the intended Signals, Ads, retention, and data-sharing
  settings.

### Exit criteria

- Form visitors receive the collection notice at the point of collection.
- External Google settings match the privacy policy.
- No consent banner or form consent checkbox is added.

## Task 6 — Add low-impact semantic navigation foundations

These are voluntary first-party improvements within the accepted exemption and
no-redesign constraint.

### Skip target and route focus

Update `src/components/PageShell.jsx` and shared CSS:

- add a “דלג לתוכן הראשי” link as the first focusable item;
- keep it visually hidden until keyboard focus;
- point it to one stable `#main-content` target in the PageShell content
  container; and
- make the target programmatically focusable without adding a visible outline
  during pointer use.

Add router-level focus handling in `src/main.jsx` so client-side pathname
changes move focus to the new page's primary heading or main-content target
after rendering. Preserve hash-link behavior and do not steal focus during
ordinary in-page state changes.

### Heading and landmark cleanup

- Change the fixed TopBar site title from a repeated page-level H1 to a
  non-heading brand element with the same visual class.
- Give each document/catalog/route page one meaningful H1.
- Convert repeated section H1s in `ContentSections.jsx` to the appropriate H2
  level without changing their visual style.
- Ensure breadcrumbs remain a labelled navigation landmark.
- Avoid nested `<main>` landmarks; use the PageShell target as a focus target
  even where a child page already owns its `<main>`.

### Mobile menu semantics

Update `src/components/TopBar.jsx`:

- add `aria-expanded` and `aria-controls` to the menu button;
- change its accessible name between open and close states;
- close on Escape and restore focus to the toggle;
- close after navigation; and
- expose the active route with `aria-current="page"` where applicable.

### Tests

Add Playwright coverage that:

- first Tab reveals and focuses the skip link;
- activating it moves focus to main content;
- client-side navigation announces/focuses the new page without reloading;
- mobile menu state and Escape behavior are correct;
- each representative legal/catalog/route page has one primary H1; and
- pointer-visible appearance remains unchanged in screenshots.

### Exit criteria

- Keyboard users can bypass repeated navigation.
- SPA page changes have a predictable focus destination.
- The visible header/layout is unchanged apart from keyboard focus states.

## Task 7 — Repair dialogs, autocomplete, and dynamic status behavior

### Dialog focus

Refactor `src/components/DownloadModal.jsx` and `SendToPhone.jsx` with a small
shared dialog-focus hook if useful:

- move focus into the dialog on open;
- keep Tab/Shift+Tab inside while open;
- close on Escape;
- restore focus to the button that opened it;
- prevent background content from being keyboard/interactively reachable while
  the modal is active; and
- preserve existing click-outside behavior where appropriate.

Do not add a dialog library solely for these two components unless the custom
implementation cannot be made reliable and well tested.

### Autocomplete semantics

Bring both current place-autocomplete implementations into the same accessible
behavior:

- `src/components/WelcomeDiscover.jsx`; and
- `src/pages/RoutesIndexPage.jsx`.

Implement the ARIA combobox/listbox pattern without changing the visible
control design:

- labelled input with `role="combobox"`;
- `aria-autocomplete="list"`, `aria-expanded`, and `aria-controls`;
- unique listbox and option IDs;
- Arrow Up/Down active-option movement;
- Enter selection;
- Escape close;
- `aria-activedescendant` while an option is active;
- no-results/status announcement where useful; and
- removal chips/buttons remain individually named.

Avoid timeout-based blur as the primary ownership model if it causes unreliable
screen-reader or keyboard behavior. Share pure selection/navigation helpers or
a hook where that prevents the two implementations from drifting; do not force
a visual component merge if their styling contracts differ.

### Status and errors

- Give search and route errors `role="alert"` or an appropriate live region.
- Keep loading states polite and avoid repeated announcements during playback.
- Announce copy/share completion without relying on colour or button-text
  timing alone.

### Tests

Add keyboard-only E2E tests for:

- both autocomplete surfaces;
- download/share/send-to-phone dialog entry, focus loop, Escape, and focus
  restoration;
- search error announcement; and
- share-copy completion announcement.

### Exit criteria

- All affected controls work without a pointer.
- No visible workflow or layout redesign is introduced.
- Automated tests cover focus ownership and the complete keyboard interaction.

## Task 8 — Improve map alternatives, motion, focus, and contrast conservatively

### Map semantics and alternatives

Update `src/map/MapSurface.jsx` and its call sites:

- expose the map container as a labelled region;
- attach a concise screen-reader description explaining that the graphical map
  supports pointer exploration and that search/route panels provide textual
  controls and route details;
- do not expose decorative Mapbox internals as duplicate unnamed controls; and
- preserve Mapbox keyboard pan/zoom behavior where it already works.

Do not attempt a hidden pixel-by-pixel representation of the map. Instead,
verify that essential outcomes are available outside the canvas:

- routes can be found through search/catalog controls;
- selected route distance, elevation, road/segment summary, warnings, POIs, and
  actions are represented as text;
- route points can be inspected/removed through existing route controls; and
- help by email is documented for arbitrary map-based construction that cannot
  be made equivalent without a redesign.

The accessibility page must continue to disclose the remaining map limitation.

### Reduced motion

Add a global `prefers-reduced-motion: reduce` treatment covering:

- CSS animations and nonessential transitions;
- smooth scrolling;
- loading/pulse effects; and
- featured/planner cursor animations where they are not already governed by
  the MapSurface preference.

Do not disable essential loading feedback or video playback chosen by the user.

### Focus, contrast, and target audit

Audit existing first-party colours and controls in their actual states:

- normal/large text contrast;
- button and input boundaries;
- focus indicators against their backgrounds;
- warnings and route classifications that currently depend on colour;
- disabled-state legibility; and
- mobile touch targets.

Change only failing tokens/declarations. Reuse the current palette and avoid a
new high-contrast theme. Document any third-party limitation that cannot be
corrected without replacing Mapbox/YouTube.

### Tests

- Add reduced-motion Playwright coverage using `page.emulateMedia`.
- Add keyboard focus visibility assertions for representative controls.
- Add screenshots for desktop planner, mobile Discover, route detail, and legal
  pages to confirm there is no major visual drift.
- Run an automated contrast scanner in Task 9 and manually validate any result
  involving gradients, map imagery, video, or dynamic overlays.

### Exit criteria

- Essential route information is not map-only.
- Reduced-motion preference has site-wide effect.
- Only targeted visual corrections are made.

## Task 9 — Add automated accessibility regression coverage

### Tooling

Add `@axe-core/playwright` as a development dependency and update the lockfile.
Create `tests/e2e/accessibility.spec.mjs` using the existing Mapbox mock.

Run WCAG 2.0 A/AA rule tags against representative first-party states:

- `/privacy`;
- `/terms`;
- `/support`;
- `/accessibility`;
- `/routes` with filters closed and open;
- one normal route-detail page;
- one featured video route with third-party playback not started;
- desktop planner empty state;
- desktop planner with a route;
- mobile Discover; and
- mobile Build with a route and a modal open.

Do not suppress an axe rule merely to make the suite green. Any exclusion must:

- be limited to an identified third-party subtree or documented technical
  limitation;
- have a written reason in the test;
- be reflected in the Accessibility page when it affects users; and
- retain an accessible alternative.

### Test expectations

- Zero critical or serious first-party axe violations in the covered states.
- No duplicate IDs or unnamed first-party interactive controls.
- No focusable content hidden behind closed menus/dialogs.
- No new violations when legal copy or route cards change.

Automated testing does not prove legal compliance and does not replace Task 10.

### Exit criteria

- Accessibility checks run in the normal Playwright suite.
- Exceptions are narrow, explicit, and user-facing where necessary.

## Task 10 — Manual accessibility and visual verification

Perform a manual pass after automated tests are clean.

### Keyboard

On desktop Chrome/Safari or Chrome/Firefox:

- traverse the complete header, Discover, Build, catalog, route detail, legal
  pages, dialogs, and footer with Tab/Shift+Tab/Enter/Space/Escape;
- verify no keyboard trap except intentional modal containment;
- verify focus never disappears behind the map, sheet, or fixed controls;
- verify the mobile menu and all autocomplete options; and
- confirm all essential route actions are reachable without clicking the map.

### Screen readers

At minimum:

- VoiceOver + Safari on macOS/iOS for header, legal pages, catalog, route page,
  mobile Discover/Build, dialogs, and map alternative text; and
- NVDA + Chrome on Windows if available, or arrange an external check before
  claiming any tested assistive-technology compatibility in the Accessibility
  page.

Check heading navigation, landmarks, control names/states, live announcements,
dialog ownership, and reading order.

### Zoom, reflow, and motion

- Browser zoom at 200% on desktop document/catalog/route pages.
- Narrow viewport/reflow at 320 CSS px where applicable.
- Text-size increase on mobile.
- Reduced-motion preference on desktop and mobile.
- Landscape/portrait mobile checks for the full-screen planner.

### Visual regression constraint

Compare before/after screenshots for:

- desktop home/planner;
- mobile Discover and Build;
- route catalog/detail;
- video route page;
- legal pages; and
- open dialogs.

Accept focus rings, the skip link while focused, compact legal links, and
targeted contrast corrections. Reject banners, persistent new chrome, floating
widgets, or material layout changes.

### Exit criteria

- Manual results and any known limitations are recorded.
- Accessibility-page claims are adjusted to match what was actually tested.
- No major UX/UI change is present.

## Task 11 — Focused, full, and production validation

### Focused commands

Run from the repository root:

```sh
node tests/test-app-links.mjs
node tests/test-analytics-parity.mjs
npx playwright test tests/e2e/legal-pages.spec.mjs tests/e2e/accessibility.spec.mjs --workers=1
npm run build
git diff --check
```

Run any new pure helper tests directly as part of the focused set and add them
to the normal `npm test` chain if they are separate files.

### Regression suite

After focused tests pass:

```sh
npm test
npm run test:smoke
```

If an unrelated pre-existing failure exists, record the exact command and
baseline evidence; do not weaken a new compliance assertion to accommodate it.

### Production network verification

After the combined release is deployed:

- load `/`, `/routes`, a route-detail URL, and a long shared
  `/?route=...#fragment` URL in a clean browser profile;
- inspect GA4 network requests and verify the document-location/page-location
  value contains no query or fragment;
- verify no event parameter contains `lat`, `lng`, search text, encoded route,
  email, name, or feedback content;
- verify production still records a sanitized page view and permitted aggregate
  event;
- verify localhost, app embeds, and automated browsers remain untracked;
- verify Google Signals/Ads/retention settings from Task 5; and
- verify no banner, consent prompt, or accessibility widget appears.

### Public-page verification

- Open every legal page from the production footer/compact links.
- Confirm dates, operator identity, and contact email.
- Open the Google Form signed out and confirm its collection notice.
- Confirm `/accessibility` is in `sitemap.xml` and resolves directly on the
  production host.
- Re-run the legal-page and accessibility E2E tests against the production-like
  build where practical.

### Exit criteria

- Code, copy, external Google settings, and production network behavior agree.
- All targeted and regression tests pass or have documented unrelated baseline
  failures.
- The release satisfies every guardrail at the top of this plan.

## Task 12 — Establish lightweight ongoing maintenance

### Annual review

At least annually, and whenever the site materially changes:

- reconfirm revenue and employee count for the accessibility exemption;
- update the Accessibility and Privacy review dates;
- inspect production Analytics requests for URL/coordinate leakage;
- review GA4 Signals, Ads links, retention, data sharing, and account access;
- delete/anonymize expired feedback responses;
- run the accessibility E2E suite and a short manual keyboard pass; and
- verify legal links, contact channels, and third-party disclosures.

### Change triggers

Reopen this design and plan before:

- monetization, sponsorship, advertising, or paid services;
- hiring employees or changing the operator;
- adding accounts, a backend, newsletters, crash reporting, or new analytics;
- linking Google Analytics to Ads or enabling Signals/remarketing;
- intentionally targeting or materially serving the EEA, UK, or Switzerland;
- adding new downloadable documents or self-produced video whose accessibility
  obligations differ; or
- releasing the native application publicly.

### Complaints and requests

- Route accessibility reports to the public support/accessibility email.
- Acknowledge material reports promptly.
- Provide a practical textual/email alternative where possible.
- Track the affected URL, reported barrier, response, fix/alternative, and
  closure date without retaining unnecessary disability information.
- If a formal notice or legal demand arrives, preserve it and obtain Israeli
  legal advice; do not rely solely on this implementation plan.

### Deferred consent banner

The banner remains future work. If a trigger in the design occurs or the owner
no longer accepts the risk, create a new design/plan for a small accessible
Basic Consent Mode implementation. Do not silently add it under this plan.

## Definition of done

This implementation is complete only when:

- the low-turnover exemption and accessible alternatives are publicly stated;
- Privacy, Terms, Support, and Accessibility pages are internally consistent;
- GA4 remains active but never receives query/hash route data, precise search
  coordinates, or user-entered content from current first-party code;
- the Google Form contains its point-of-collection notice;
- GA4 owner settings match the policy;
- shared legal links are reachable across desktop, document, route, and mobile
  full-screen surfaces;
- the planned semantic, keyboard, dialog, autocomplete, motion, and map-
  alternative improvements are implemented and tested;
- automated and manual verification is complete;
- no banner, user-consent mechanism, accessibility overlay, or major UX/UI
  change was introduced; and
- known residual risks and third-party limitations remain accurately disclosed.
