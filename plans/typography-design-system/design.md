# Typography Design System

**Date:** 2026-07-06
**Status:** Approved design, pending implementation plan
**Trigger:** Designer feedback on the iOS app: "הטיפוגרפיה נשענת על משקל בולד שלא לצורך. תבקש שייצור היררכיית טיפוגרפיה וסקייל מצומצם ל-heading, subtitle, body וכן לקומפוננטות — מומלץ להשתמש בדיזיין סיסטם."
(The typography leans on bold weight unnecessarily; build a typography hierarchy and a reduced scale for heading/subtitle/body and for components; a design system is recommended.)

## Problem

The audit (2026-07-06) confirmed the feedback on both surfaces the iOS app renders:

- **Web app (`src/` + `styles.css`, shipped into the app via the webroot pipeline):**
  143 `font-weight` declarations, 116 of them ≥700 (50× `800`, 49× `700`, 17× `900`,
  plus non-standard `850`/`750`/`650`). **57 distinct font sizes** mixing `px`,
  `rem`, and `em` (e.g. `13px`, `13.5px`, `0.82rem`). `react-app.css` sets an
  `Arial/Segoe UI` family while `styles.css` sets `Assistant` — the family itself
  is inconsistent.
- **Native app (`apps/mobile/src/`):** 118 explicit `fontWeight` values, 112 of
  them 700–900 (48× `"800"`, 36× `"700"`, 28× `"900"`). 17 distinct sizes
  including `12.5` and `13.5`. No theme/typography module exists; all styles are
  inline per screen.

With near-everything bold, weight no longer communicates hierarchy. There are no
typography tokens anywhere, so drift is structural, not accidental.

## Decisions (from brainstorming)

1. **Bold intent:** partly intentional. Navigation/riding surfaces keep heavy
   weights for glanceability; browsing/planning surfaces get a standard
   editorial hierarchy.
2. **Font family:** platform system font in the native app (Apple HIG, free,
   good Hebrew support); `Assistant` stack everywhere on web (fixing the
   `react-app.css` Arial inconsistency). Tokens standardize sizes/weights; the
   family stays per-surface.
3. **Migration:** full sweep of both surfaces in this project.
4. **Size normalization:** snap every text element to the nearest scale step —
   a true system, accepting small (1–2px) visible shifts.
5. **Architecture:** single source of truth in `@cycleways/core` with a small
   codegen script for web CSS (option A; options B "two synced files" and C
   "full design-system package" rejected as drift-prone and overkill
   respectively).

## The type system

### Weights

| Token | Value | Use |
|-------|-------|-----|
| `regular` | 400 | body and secondary text |
| `semibold` | 600 | labels, subheadings, buttons, emphasis |
| `bold` | 700 | headings |
| `heavy` | 800 | **restricted:** navigation/riding display variants only |

Weights 850/900/750/650 are eliminated. Emphasis is one step up in weight or
size — never stacking extra-bold.

### Size scale (7 steps; pt native, px via CSS variables on web)

| Step | Size | Typical use |
|------|------|-------------|
| `xs` | 11 | tiny labels, chart ticks |
| `sm` | 13 | captions, metadata |
| `md` | 15 | body text (default) |
| `lg` | 17 | card/section titles |
| `xl` | 20 | screen sub-titles |
| `2xl` | 24 | page/screen titles |
| `3xl` | 30 | riding stats / display numbers |

### Semantic variants (what components reference)

| Variant | Size / weight | Line-height | Use |
|---------|---------------|-------------|-----|
| `display` | 30 / 800 | 1.1 | big numbers on riding screens (restricted tier) |
| `heading` | 24 / 700 | 1.2 | page & screen titles |
| `subheading` | 17 / 600 | 1.3 | card titles, section headers |
| `body` | 15 / 400 | 1.45 | default paragraph/UI text |
| `bodyStrong` | 15 / 600 | 1.45 | buttons, emphasized body |
| `caption` | 13 / 400 | 1.4 | secondary/meta text |
| `captionStrong` | 13 / 600 | 1.4 | chips, small labels |
| `label` | 11 / 600 | 1.3 | overlines, tiny labels |

**Navigation tier and `display` placement (one rule):** three dedicated
aliases bump the standard variant one weight step: `navTitle` = 20/800,
`navBody` = 15/700, `navCaption` = 13/700. The `nav*` aliases may be used
**only** in the native navigation panel
(`apps/mobile/src/planner/NavPanel.jsx`). The `display` variant is for
hero-scale text: natively only NavPanel stat readouts; on web only the
front-page hero and featured-page hero titles/stats, each use marked with a
`/* display: hero */` comment. If a nav alias turns out unused during
migration it is dropped; no new weights or sizes may be added. Heavy weights
appear only through the named `nav*`/`display` variants, never ad-hoc.

## Architecture

```
packages/core/src/ui/typography.js   ← single source of truth (plain JS, no deps)
  exports: fontSizes, fontWeights, lineHeights, textVariants (incl. nav*),
           webFontStack

apps/mobile/src/theme/typography.js  ← thin RN adapter
  maps variants to ready style objects:
  { fontSize, fontWeight: '700', lineHeight: <absolute px> }
  screens use spreads: style={{ ...text.heading }}

scripts/generate-typography-css.mjs  ← codegen for web
  reads core tokens, writes checked-in typography.css (repo root, next to
  styles.css) with :root custom properties (--font-size-md,
  --font-weight-semibold, --text-heading-size, …)
  supports --check (exit non-zero when stale) for CI/test wiring
```

- `typography.css` is pulled in via `@import "./typography.css";` as the first
  line of the root `styles.css`, which the single Vite entry (`index.html`)
  links — this covers the React app and the classic page chrome in one place.
  The internal editor uses its own separate `editor/styles.css` and is
  unaffected.
- npm script (`npm run tokens`) plus pre-hooks on dev/build keep the generated
  file fresh; the `--check` mode guards against staleness in tests.
- No new component layer: web CSS rules reference `var(...)` directly; native
  screens spread adapter styles. This matches how each surface styles today.

## Migration (full sweep)

**Web scope:** `src/react-app.css`, `src/route-boundary.css`,
`src/components/frontPanel/front-panel.css`, `src/components/welcome-wizard.css`,
`src/components/featured/featured.css`, `src/components/routes/routes.css`,
`src/pages/legal/legal.css`, root `styles.css`, and any inline JSX font styles
in `src/`. The internal `editor/` directory is **out of scope**.

**Behavioral exception:** the `input, select, textarea { font-size: 16px; }`
rule in `styles.css` exists to prevent iOS Safari's zoom-on-focus (it fires
when an input's font-size is below 16px). It migrates to
`var(--font-size-lg)` (17px — still ≥16px, behavior preserved) and keeps a
comment stating the ≥16px constraint.

**Native scope:** all screens/components under `apps/mobile/src/` and
`apps/mobile/App.js`.

**Mapping rules:**

- Every `font-size` snaps to the nearest scale step; every `font-weight` maps to
  the variant-appropriate token.
- Current 700–800 on body-ish text → `body` (400) or `bodyStrong` (600).
- Real titles → `subheading` (600) or `heading` (700).
- `900` → `bold` 700, or `display`/`nav*` (800/700) on riding surfaces only.
- Riding/navigation screens (turn instructions, stat readouts) map to
  `nav*`/`display` variants and keep their glanceability.
- Web font-family: `react-app.css` moves to the `Assistant` stack from
  `styles.css` (exposed as `webFontStack` in core tokens).

## Verification

1. **Grep guard test:** after migration, migrated files contain no raw numeric
   `font-size:`/`fontSize:` and no `font-weight` of 800+ outside the
   nav-allowlisted files; no 850/900/750/650 anywhere.
2. **Codegen freshness:** `node scripts/generate-typography-css.mjs --check`
   runs in the test suite.
3. **Existing tests:** the Playwright suite must pass.
4. **Visual review:** before/after screenshots of key screens (front panel,
   route card, riding/navigation screen, featured page) presented to the user
   for approval.

## Out of scope

- `editor/` internal tool styles.
- Color, spacing, or radius tokens (typography only; the token file layout
  leaves room to add them later).
- Publishing a component gallery to claude.ai/design via DesignSync (explicitly
  deferred; can follow once the scale is settled).
