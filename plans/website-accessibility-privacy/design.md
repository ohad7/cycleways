# Website Accessibility and Privacy Compliance — Design

**Date:** 2026-07-13
**Status:** Accepted; implementation authorized
**Scope:** Public CycleWays website and its public legal/contact surfaces

## Purpose

Record the agreed posture for accessibility, privacy, Google Analytics, and
adjacent website legal disclosures before implementation work is planned.

This document captures product and risk decisions. It is not legal advice and
does not replace a fact-specific opinion from an Israeli lawyer or a licensed
accessibility professional.

## Operator and project facts

The legal analysis and product decisions in this document rely on these facts:

- CycleWays is a privately owned project operated by one individual, with no
  separate company, association, or other legal entity.
- The public website first went live in 2025.
- The website is free of charge.
- The project has no revenue and does not expect to monetize in the near term.
- There are no employees.
- The source is intended to be open source, although the repository does not
  currently contain an explicit `LICENSE` file.
- The production website uses Google Analytics and the operator wants to keep
  it.
- The website has a public Google Forms feedback/contact form.

These facts must be revisited if the operator, revenue, employment, audience,
analytics configuration, or business model changes.

## Hard product constraints

The following constraints are accepted decisions:

1. Do not show a cookie or analytics-consent banner.
2. Do not add an analytics consent prompt, checkbox, modal, or first-visit
   choice.
3. Do not make a major UX or visual redesign for this work.
4. Do not add a floating accessibility widget or overlay.
5. Keep Google Analytics active and disclose it accurately.
6. Treat an explicit consent banner as future work, not as part of the current
   scope.

The operator understands that documents alone do not eliminate the legal risk
created by automatic analytics collection and accepts that residual risk for
the current small, non-commercial site.

## Accessibility posture

### Legal baseline

The normal Israeli baseline for an in-scope internet service is Israeli
Standard 5568, Part 1, at level AA. The current 2023 edition adopts WCAG 2.0
with Israeli modifications. The service-accessibility regulations also cover
internet content, documents, images, video, and applications that provide a
public service or information about one.

CycleWays likely falls within the broad public-service categories of sport,
leisure, or tourism information. This design therefore does not assume that a
free website is outside the accessibility regime.

### Likely low-turnover exemption

On the stated facts, the website operator is strongly likely to qualify for the
low-turnover exemption in Regulation 35ו(ז): an exempt dealer or a provider
whose average annual turnover does not exceed NIS 100,000 is exempt from the
internet-accessibility adjustments in that part of the regulations.

The factual basis is zero revenue, not the facts that the website is free or
that the source is public. The operator should keep private evidence supporting
the exemption and re-evaluate it at least annually.

Other consequences of the facts are:

- The separate exemption for certain websites operated before 26 October 2017
  is irrelevant because CycleWays launched in 2025.
- No accessibility coordinator is required under Regulation 91 because the
  operator has no employees; that appointment duty begins at 25 employees.
- If an exemption is relied upon, Regulation 34(e) calls for publication of the
  exemption and the accessible alternatives that are available, if any.

The exemption conclusion should be rechecked before monetization, accepting
sponsorship, employing people, changing the operator, or materially expanding
the service.

### Public accessibility notice

The website should have a prominent, truthful accessibility page. It will be a
combined accessibility statement and exemption notice rather than a claim of
certified AA compliance.

The page should:

- identify the applicable low-turnover exemption without publishing private
  financial records;
- state that CycleWays nevertheless works to improve accessibility;
- describe only accessibility features that actually exist;
- identify known limitations, especially the interactive map, map-based route
  building, Mapbox, YouTube, and other third-party surfaces;
- describe practical alternatives such as textual route pages, route details,
  GPX downloads, and assistance by email;
- provide a dedicated way to report an accessibility problem or request help;
- request the affected URL, a description of the problem, device/browser, and
  assistive technology where relevant; and
- show the last review date.

The page must not say that the website is fully accessible, certified, or fully
compliant unless a later audit supports that exact statement.

### Voluntary accessibility improvements

The exemption is not a reason to preserve obvious barriers. Improvements that
fit the no-major-redesign constraint remain desirable, particularly:

- semantic landmarks, labels, headings, and status announcements;
- keyboard access and visible keyboard focus;
- correct focus behavior for menus and dialogs;
- a keyboard-focusable skip-to-content link;
- adequate text and control contrast;
- reduced motion when the operating system requests it;
- non-colour communication of warnings and route classifications; and
- textual access to important route facts and actions that otherwise appear
  only on the map.

These changes should preserve the current map-first visual design. A separate
"accessible version" of the site is not desired.

## Privacy and Google Analytics posture

### Current contradiction

Production `index.html` loads Google Analytics automatically, while
`src/pages/PrivacyPage.jsx` currently says that the website contains no
analytics or tracking. The legal pages also say that planned routes remain on
the device.

The contradiction is material because shared/planned routes are encoded in the
`?route=` query parameter. A default Analytics page view can include the full
page URL, potentially disclosing the encoded route to Google.

The public Google Form creates a second contradiction: it requires an email,
full name, and message, while the policy says there is no first-party personal
data collection.

### Accepted analytics decision and risk

Google Analytics will continue to load without a first-visit consent choice.
The privacy policy may state that use of the site is subject to the policy, but
it must not represent a "continued use equals consent" sentence as a guaranteed
legal cure.

Israeli privacy law recognizes informed express or implied consent, but the
Privacy Protection Authority describes informed consent as requiring adequate
knowledge and warns that consent is harder to establish where a person cannot
refuse the processing. Because Analytics currently runs before a visitor reads
the policy, the no-consent-UI decision leaves residual legal uncertainty.

The operator accepts that uncertainty. The design records it rather than
claiming that updated documents eliminate it.

### Required analytics minimization

Keeping Analytics does not authorize unnecessary disclosure. The implementation
should minimize collection without changing the visible experience:

- never send query parameters or URL fragments to Analytics;
- in particular, never send the encoded `route` parameter;
- send only a normalized origin/path for page views;
- do not send search text, route geometry, precise location, feedback content,
  email addresses, names, or other user-entered values as event parameters;
- disable Google Signals, advertising personalization, remarketing, and other
  advertising features;
- do not link the property to Google Ads unless this design is revisited;
- choose the shortest practical Analytics retention setting;
- limit Google account/property access and enable multi-factor authentication;
  and
- review Google Analytics data-sharing settings and enable only what is needed
  for aggregate site measurement.

These controls reduce risk but do not convert automatic Analytics into explicit
user consent.

### Privacy-policy content

The revised privacy policy should accurately describe:

- the individual who controls the website and a working contact address;
- Google Analytics, why it is used, the broad data categories it receives, and
  Google as a recipient/service provider;
- Analytics storage/cookies and available browser-level blocking or Google
  opt-out mechanisms;
- the fact that Analytics is configured not to receive query strings or route
  payloads;
- retention and access controls;
- Mapbox requests, including IP address and requested map area;
- when YouTube is contacted and what third-party policy applies;
- GitHub Pages hosting and technical access logs;
- Google-hosted fonts or other externally loaded assets where relevant;
- local browser storage used for drafts, recent routes, preferences, and
  recovery guards;
- Google Forms collection of contact details and message content;
- the purpose, voluntary nature, recipients, retention, and consequences of not
  submitting the feedback form; and
- the statutory rights to request access to or correction of stored personal
  information where applicable.

A separate cookie-policy page is not required by this design; the disclosures
can be a clear section of the privacy policy.

### Feedback form

The Google Form should contain a concise collection notice at the point of
submission. This is a disclosure, not a consent checkbox or banner.

The notice should identify the operator/contact, explain that submission is
voluntary, state the support/feedback purpose, identify Google as the form and
storage provider, and explain retention and applicable access/correction
requests. The required full-name field should be removed or made optional
unless a documented support need justifies it.

Access to stored form responses should be restricted, protected by
multi-factor authentication, and governed by a short documented deletion
schedule.

### Database registration and privacy officer

On the current facts, CycleWays does not appear to require registration of its
small feedback dataset or appointment of a privacy protection officer. It is
not a public body or a data broker, and it does not process sensitive data at
large scale. Substantive privacy, security, purpose-limitation, and data-subject
rights can still apply even when registration and appointment duties do not.

## Terms, identity, and licensing

The terms and privacy policy must not imply that CycleWays is a separate legal
entity. The preferred public identification is "CycleWays, a privately owned
project operated by one individual" together with the dedicated support email.
The operator does not want to publish their personal name unless legally
required. Whether that formulation is sufficient under the applicable
controller-identification duties remains a legal checkpoint; the copy must not
invent a company identity or claim that the question has been conclusively
resolved. A private home address must not be published unless Israeli counsel
determines it is necessary.

The terms should continue to cover:

- the informational and route-planning nature of the service;
- cycling and changing-field-condition risks;
- the priority of actual signs, law, and conditions over website guidance;
- reasonable limitations of liability subject to mandatory law;
- Mapbox and OpenStreetMap attribution and ODbL-derived data; and
- third-party content and services.

The current repository does not have a source-code licence. Public source is
not legally open source merely because it is viewable. Choosing an explicit
code licence, and separately deciding the licence for original text, photos,
route data, and other content, remains an owner decision. Until then, legal
pages should not make a broader open-source promise than the actual licence
supports.

## Permitted visual impact

This work may introduce only modest visible changes:

- an Accessibility link alongside the existing legal/support links;
- a matching accessibility/legal page;
- a privacy-policy update;
- a keyboard-only skip link that appears on focus;
- keyboard focus indicators;
- small contrast or target-size corrections if necessary; and
- minor textual alternatives within existing route panels/pages.

The following are explicitly excluded from the current work:

- cookie or analytics banners;
- consent dialogs or checkboxes;
- floating accessibility buttons or overlays;
- a separate high-contrast site theme;
- a second accessible version of the website; and
- a major map, navigation, information-architecture, or visual redesign.

## Future work: analytics consent banner

An explicit analytics-consent banner is deliberately deferred. It is not
scheduled and is not a prerequisite for the current documentation and
minimization work.

If implemented later, the preferred direction is a small accessible choice
using Google Basic Consent Mode so that Analytics sends no data before the
visitor chooses. It should offer equally clear accept and continue-without-
analytics actions and should not block use of the website.

Reconsider the banner immediately if any of these triggers occur:

- CycleWays begins monetizing, advertising, accepting sponsorship, or linking
  Analytics to advertising products;
- Google Signals, remarketing, personalization, or cross-service advertising
  features are desired;
- the site intentionally targets the EEA, United Kingdom, or Switzerland, or
  develops material traffic there;
- a regulator, court, lawyer, or formal complaint requires a stronger consent
  mechanism;
- analytics expands beyond aggregate page/use measurement;
- the operator no longer accepts the residual risk; or
- Google changes its product or policy requirements.

## Other future or separate work

- Native-app accessibility is not covered by this website design and should be
  assessed separately before public app release.
- Select and add an explicit source-code licence and compatible content/data
  licensing.
- Obtain a short Israeli legal review before monetization or after a material
  change in operator, revenue, data collection, or audience.

## Validation principles for later implementation

An eventual implementation plan should verify at least that:

- the accessibility/exemption notice is reachable from every public page;
- the privacy policy matches the network behavior actually observed in
  production;
- Analytics never receives the `route` query parameter or other query/hash
  data;
- Analytics has no advertising/signals features enabled;
- the Google Form displays its collection notice before submission;
- legal pages identify the operator and current contact path;
- the site introduces no consent banner, consent prompt, or major redesign;
- core pages remain keyboard-usable and receive sensible screen-reader labels;
  and
- the exemption and policy are reviewed at least annually.

## Sources reviewed

- [Equal Rights for Persons with Disabilities (Service Accessibility
  Adjustments) Regulations](https://www.btl.gov.il/Laws1/02_0041_100100.pdf),
  including Regulations 34, 35א–35ו, and 91.
- [Israeli Standard 5568 Part 1
  (2023)](https://www.gov.il/BlobFolder/legalinfo/israeli_accessibility_standards_pdf/he/sitedocs_si-5568-1-september-2023.pdf).
- [Commission for Equal Rights guidance on internet-accessibility
  exemptions](https://www.gov.il/he/service/application_for_exemption_internet_people_with_disabilities).
- [Privacy Protection Authority guidance on the duty to notify when collecting
  personal information](https://www.gov.il/BlobFolder/legalinfo/duty_to_notify/he/notify13.pdf).
- [Privacy Protection Authority privacy
  glossary](https://www.gov.il/he/pages/glossary), including informed and
  implied consent.
- [Privacy Protection Authority database-registration
  guidance](https://www.gov.il/he/service/registration_in_the_database).
- [Google Analytics Consent Mode
  documentation](https://support.google.com/analytics/answer/10000067?hl=en).

Sources were last reviewed on 2026-07-10. If a source conflicts with current
legislation or binding legal advice, the current law or advice controls.
