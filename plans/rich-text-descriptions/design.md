# Rich text in POI and route descriptions — design

Date: 2026-06-09

## Goal

Let authors put **links** and **bold** text (with paragraph/line-break
structure) into description fields — primarily POI long descriptions, sometimes
POI short descriptions, and the route narrative — and have it render correctly
on both the web app and the React Native mobile app without introducing an
HTML-injection (XSS) surface.

## Constraints that shape the design

- **Two render targets share one data source.** POI/route text in
  `data/map-source.geojson` is rendered by the web React app *and* by the
  React Native app (`apps/mobile/src/MapScreen.jsx`, which renders
  `marker.information` inside `<Text>`). React Native cannot render raw HTML, so
  the stored format must be platform-neutral.
- **Editor/pipeline-owned, but still untrusted-ish.** Descriptions are authored
  through the editor and promoted via Build → Promote. We still avoid any
  raw-HTML path so a stray `javascript:` URL or markup can never execute.
- **No existing markdown dependency** in either app. The required vocabulary is
  tiny (links, bold, paragraphs), so a purpose-built parser is smaller and safer
  than a full markdown engine.
- **Backward compatible.** Existing plain-text descriptions must render
  identically (modulo paragraph splitting, which the route narrative already
  does).

## Chosen format

A **conservative markdown subset**: `[text](url)`, `**bold**`, blank-line
paragraphs, single-newline soft breaks. Nothing else. Authored as raw text in
the editor's existing `<textarea>`s, with a live rendered preview.

Rejected alternatives:

- **Raw/sanitized HTML** — does not render on React Native and carries an XSS
  surface; would force web/mobile divergence.
- **Structured rich text (portable-text JSON)** — renderer-agnostic but heavy:
  needs a WYSIWYG editor widget and a data migration. Overkill for three
  constructs.

## Architecture: one parser, three thin renderers

### 1. Shared parser — `packages/core/src/utils/richText.js`

Pure module, no platform deps. Exports:

```js
parseRichText(str) // → Block[]
```

A neutral block/inline AST (no HTML, no platform assumptions):

```
Block  = Inline[]                              // one block = one paragraph
Inline = { t: "text", v: string }
       | { t: "break" }                        // soft line break
       | { t: "bold", children: Inline[] }
       | { t: "link", href: string, children: Inline[] }
```

Parsing rules, deliberately conservative:

- `\n\n+` → new block; single `\n` → `{ t: "break" }` inside the current block.
- `**…**` → bold, only on well-formed pairs; a stray `*` stays literal.
- `[text](url)` → link, only on full match; the URL is validated against an
  allow-list of schemes: `http:`, `https:`, `mailto:`, `tel:`. Any other scheme
  (e.g. `javascript:`, `data:`) or unparseable URL is **rejected** — the link's
  text is emitted as plain text and the href is dropped.
- The parser never loses characters: malformed markup (unmatched `**`, `[`
  without `](url)`, unclosed link) is emitted as literal text. Round-tripping a
  plain string yields the same visible text.

This URL allow-list plus the absence of any raw-HTML path is the entire XSS
defense.

### 2. Three renderers over the one AST

- **Web** — `<RichText text={…} />` (React) maps the AST to real React elements:
  block → `<p>`, `break` → `<br>`, bold → `<strong>`, link →
  `<a target="_blank" rel="noopener noreferrer">`. No `dangerouslySetInnerHTML`;
  real elements are XSS-safe by construction.
- **Mobile** — `<RichText>` (React Native) maps the AST to nested `<Text>`;
  bold → `<Text>` with a bold style; link → `<Text onPress={() =>
  Linking.openURL(href)}>` styled as a link. Blocks are separated by spacing.
- **Editor preview** — a small AST→DOM function renders a live preview under each
  rich-text `<textarea>`, reusing the same parser (no React).

### 3. Authoring (editor UX)

Keep the existing `<textarea>` for each rich-text field; add a small **live
rendered preview** beneath it (updates as the author types/commits). No new
dependency, no toolbar.

## Scope — where rich text applies

Build the renderer reusably and wire these surfaces. Land POI fields first to
validate the renderer, then the route surfaces.

- **POI short (`information`) + long (`description`)** —
  `src/components/frontPanel/PanelPoiCard.jsx`,
  `src/components/featured/POICard.jsx`,
  `src/components/featured/RoutePoiStoryList.jsx`,
  `src/components/featured/RoutePoiGallery.jsx`,
  and mobile `apps/mobile/src/MapScreen.jsx`.
- **Route start/end point descriptions** — the per-point description in route
  start/end cards.
- **Route narrative** (`intro` / `description` / `notes`) —
  `src/featured/genericRouteStory.js`, replacing the current `splitParagraphs`
  (a subset of what the parser already does).

**No data-model/schema change.** The same string fields are now *interpreted* as
this subset.

## Links inside card buttons

`PanelPoiCard` and `POICard` are `<button>` elements, and short descriptions
render on them. A real `<a>` nested in a `<button>` is invalid HTML and a tap
would fire both the link and the card's `onSelect`.

**Decision:** in card contexts, render links as `<a>`/`<Text>` whose
click/press handler calls `stopPropagation` (and on web `preventDefault` is not
needed — the anchor still navigates), so the link wins and the card's `onSelect`
does not also fire. The `RichText` web component takes a flag (e.g.
`stopLinkPropagation`) used by card consumers. Links are most valuable in the
non-button detail/story views regardless.

(Alternative considered and rejected for scope: convert the card `<button>`s to
`role="button"` divs so anchor nesting is valid — cleaner HTML, broader
refactor.)

## Error handling / edge cases

- Malformed markup stays literal (see parser rules); never throws, never drops
  characters.
- Rejected URLs render the link text as plain text, href dropped silently.
- Empty/whitespace input → no blocks → renders nothing (matches today's
  `&& poi.information` guards).

## Testing

- **Unit tests on `parseRichText`** (the only real logic, TDD): bold, links,
  paragraphs, soft breaks, malformed-stays-literal, URL allow/deny-list,
  plain-text passthrough, character-preservation round-trip.
- **Web render test**: AST → expected elements; assert links get
  `target="_blank"` and `rel="noopener noreferrer"`, and the card variant's
  `stopPropagation` behavior.
- **Manual**: editor live preview; one mobile render with a tappable link.
```
