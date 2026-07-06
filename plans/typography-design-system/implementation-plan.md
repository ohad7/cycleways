# Typography Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-07-06
**Spec:** `plans/typography-design-system/design.md` (read it first — it defines the scale, variants, and decisions)

**Goal:** Replace ~260 ad-hoc font-size/font-weight declarations on both surfaces (React Native app + web app) with a token-driven typography system sourced from `@cycleways/core`.

**Architecture:** A single plain-JS token module in `packages/core/src/ui/typography.js` is consumed two ways: a thin RN adapter (`apps/mobile/src/theme/typography.js`) turns variants into ready style objects, and a codegen script (`scripts/generate-typography-css.mjs`) emits a checked-in `typography.css` of CSS custom properties that all web CSS references via `var()`. Guard tests make regressions impossible.

**Tech Stack:** Plain ES modules, node:test-style assert scripts (this repo's convention: standalone `node tests/test-*.mjs` files chained in the root `test` npm script), React Native (Expo), Vite.

## Global Constraints

- Size scale (pt native / px web): xs=11, sm=13, md=15, lg=17, xl=20, 2xl=24, 3xl=30. No other font sizes anywhere.
- Weights: regular=400, semibold=600, bold=700, heavy=800. Heavy (800) appears ONLY in the `display` and `navTitle` variants. Weights 500, 650, 750, 850, 900 are eliminated.
- Variants: display 30/800/1.1, heading 24/700/1.2, subheading 17/600/1.3, body 15/400/1.45, bodyStrong 15/600/1.45, caption 13/400/1.4, captionStrong 13/600/1.4, label 11/600/1.3, navTitle 20/800/1.2, navBody 15/700/1.45, navCaption 13/700/1.4.
- Native keeps the platform system font (no fontFamily). Web standardizes on the Assistant stack.
- `editor/` is out of scope (it uses its own `editor/styles.css`, not the root one).
- Every changed file: font values must come from tokens (spread variants natively, `var(--...)` on web) — never literal numbers.
- Commit after each task. Do not run `git add -A` (repo rule: build regenerates public-data).

## Migration mapping rules (used by Tasks 4–7)

Pick the **semantic variant by role first** — the variant then dictates size AND weight (do not preserve the old size if the role says otherwise):

| Current pattern | Variant |
|---|---|
| Screen/page titles (was 20–28px, 800–900) | `heading` |
| Card titles, section headers, sheet titles (was 15–18px, 700–850) | `subheading` |
| Default/paragraph/description text (was 13–15px, often 600–700) | `body` |
| Buttons, CTAs, emphasized body (was 700–800) | `bodyStrong` |
| Secondary/meta text, timestamps, hints (was 11–13px) | `caption` |
| Chips, badges, stat labels (was 11–13px, 700–800) | `captionStrong` |
| Overlines, tiny uppercase-ish labels (was 10–11px) | `label` |
| Riding stat readouts / big numbers (NavPanel) | `display` |
| Navigation cue titles (NavPanel, was 20–22px 800–900) | `navTitle` |
| Navigation body/secondary text (NavPanel) | `navBody` / `navCaption` |

For pure-size cases with no text role (icon glyphs like the `×` close button, chart tick labels): snap to the nearest scale step, ties round **up** (10→11, 12→13, 14→15, 16→17, 22→24, 26→24, 28→30). For rem values convert at 16px base first (0.75rem=12→13, 0.82rem≈13→13, 0.9rem≈14.4→15, 1rem=16→17).

`nav*`/`display` variants are allowed only in `apps/mobile/src/planner/NavPanel.jsx` (the riding surface). If another file seems to need them, stop and flag it in the task report instead of using them.

---

### Task 1: Core typography tokens

**Files:**
- Create: `packages/core/src/ui/typography.js`
- Test: `tests/test-typography-tokens.mjs`
- Modify: `package.json` (append test to the `test` script chain)

**Interfaces:**
- Produces: `fontSizes` (`{xs,sm,md,lg,xl,"2xl","3xl"}` → numbers), `fontWeights` (`{regular:400,semibold:600,bold:700,heavy:800}`), `lineHeights` (`{tight:1.1,heading:1.2,snug:1.3,caption:1.4,body:1.45}`), `webFontStack` (string), `textVariants` (map of the 11 variants, each `{fontSize:number, fontWeight:number, lineHeight:number-ratio}`). Consumed by Tasks 2 and 3 via `@cycleways/core/ui/typography.js`.

- [ ] **Step 1: Write the failing test**

```js
// tests/test-typography-tokens.mjs
import assert from "node:assert/strict";
import {
  fontSizes,
  fontWeights,
  lineHeights,
  webFontStack,
  textVariants,
} from "../packages/core/src/ui/typography.js";

// The 7-step scale, exactly.
assert.deepEqual(fontSizes, { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, "2xl": 24, "3xl": 30 });

// Only the four sanctioned weights exist.
assert.deepEqual(fontWeights, { regular: 400, semibold: 600, bold: 700, heavy: 800 });

assert.ok(webFontStack.includes("Assistant"), "web stack leads with Assistant");

// Exactly the 11 spec variants — no ad-hoc additions.
assert.deepEqual(
  Object.keys(textVariants).sort(),
  ["body", "bodyStrong", "caption", "captionStrong", "display", "heading",
   "label", "navBody", "navCaption", "navTitle", "subheading"],
);

const scaleValues = Object.values(fontSizes);
const weightValues = Object.values(fontWeights);
const lineValues = Object.values(lineHeights);
for (const [name, v] of Object.entries(textVariants)) {
  assert.ok(scaleValues.includes(v.fontSize), `${name} size on scale`);
  assert.ok(weightValues.includes(v.fontWeight), `${name} weight sanctioned`);
  assert.ok(lineValues.includes(v.lineHeight), `${name} line-height token`);
  // Heavy (800) is restricted to the riding tier.
  if (v.fontWeight === fontWeights.heavy) {
    assert.ok(["display", "navTitle"].includes(name), `heavy weight leaked into ${name}`);
  }
}

// Spot-check the spec table.
assert.deepEqual(textVariants.heading, { fontSize: 24, fontWeight: 700, lineHeight: 1.2 });
assert.deepEqual(textVariants.body, { fontSize: 15, fontWeight: 400, lineHeight: 1.45 });
assert.deepEqual(textVariants.display, { fontSize: 30, fontWeight: 800, lineHeight: 1.1 });
assert.deepEqual(textVariants.navBody, { fontSize: 15, fontWeight: 700, lineHeight: 1.45 });

console.log("test-typography-tokens: OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-typography-tokens.mjs`
Expected: FAIL — `Cannot find module .../packages/core/src/ui/typography.js`

- [ ] **Step 3: Write the token module**

```js
// packages/core/src/ui/typography.js
// Single source of truth for typography across native and web.
// Spec: plans/typography-design-system/design.md
// Web CSS is generated from this file by scripts/generate-typography-css.mjs;
// run `npm run tokens` after any change here.

export const fontSizes = { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, "2xl": 24, "3xl": 30 };

export const fontWeights = { regular: 400, semibold: 600, bold: 700, heavy: 800 };

export const lineHeights = { tight: 1.1, heading: 1.2, snug: 1.3, caption: 1.4, body: 1.45 };

export const webFontStack = "'Assistant', -apple-system, 'Segoe UI', Tahoma, sans-serif";

// Heavy (800) is reserved for the riding tier: display and navTitle only.
export const textVariants = {
  display:       { fontSize: fontSizes["3xl"], fontWeight: fontWeights.heavy,    lineHeight: lineHeights.tight },
  heading:       { fontSize: fontSizes["2xl"], fontWeight: fontWeights.bold,     lineHeight: lineHeights.heading },
  subheading:    { fontSize: fontSizes.lg,     fontWeight: fontWeights.semibold, lineHeight: lineHeights.snug },
  body:          { fontSize: fontSizes.md,     fontWeight: fontWeights.regular,  lineHeight: lineHeights.body },
  bodyStrong:    { fontSize: fontSizes.md,     fontWeight: fontWeights.semibold, lineHeight: lineHeights.body },
  caption:       { fontSize: fontSizes.sm,     fontWeight: fontWeights.regular,  lineHeight: lineHeights.caption },
  captionStrong: { fontSize: fontSizes.sm,     fontWeight: fontWeights.semibold, lineHeight: lineHeights.caption },
  label:         { fontSize: fontSizes.xs,     fontWeight: fontWeights.semibold, lineHeight: lineHeights.snug },
  navTitle:      { fontSize: fontSizes.xl,     fontWeight: fontWeights.heavy,    lineHeight: lineHeights.heading },
  navBody:       { fontSize: fontSizes.md,     fontWeight: fontWeights.bold,     lineHeight: lineHeights.body },
  navCaption:    { fontSize: fontSizes.sm,     fontWeight: fontWeights.bold,     lineHeight: lineHeights.caption },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-typography-tokens.mjs`
Expected: `test-typography-tokens: OK`

- [ ] **Step 5: Register the test**

In root `package.json`, in the `"test"` script, insert `node tests/test-typography-tokens.mjs && ` immediately before the final `cd tests && node test-route-manager.js` segment.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ui/typography.js tests/test-typography-tokens.mjs package.json
git commit -m "feat: typography tokens in @cycleways/core (7-step scale, 4 weights, 11 variants)"
```

---

### Task 2: Web CSS codegen → `typography.css`

**Files:**
- Create: `scripts/generate-typography-css.mjs`
- Create (generated, checked in): `typography.css` (repo root, next to `styles.css`)
- Modify: `styles.css` (add `@import "./typography.css";` as the very first line)
- Modify: `package.json` (add `tokens` script + `predev`/`prebuild` hooks; register test)
- Test: `tests/test-typography-css.mjs`

**Interfaces:**
- Consumes: everything exported by `packages/core/src/ui/typography.js` (Task 1).
- Produces: `typography.css` defining, on `:root`: `--font-family-base`, `--font-size-<step>` (px) for the 7 steps, `--font-weight-<name>` for the 4 weights, and per variant (camelCase → kebab-case, e.g. `bodyStrong` → `body-strong`): `--text-<variant>-size` (px), `--text-<variant>-weight`, `--text-<variant>-line` (unitless ratio). Tasks 6–7 reference these. The script exports `generateTypographyCss(): string` and supports `--check` (exit 1 when the file on disk is stale).

- [ ] **Step 1: Write the failing test**

```js
// tests/test-typography-css.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { generateTypographyCss } from "../scripts/generate-typography-css.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = generateTypographyCss();

// Structural spot checks.
assert.ok(css.startsWith("/* GENERATED"), "has do-not-edit banner");
assert.ok(css.includes(":root {"));
assert.ok(css.includes("--font-family-base: 'Assistant'"));
assert.ok(css.includes("--font-size-md: 15px;"));
assert.ok(css.includes("--font-weight-semibold: 600;"));
assert.ok(css.includes("--text-heading-size: 24px;"));
assert.ok(css.includes("--text-heading-weight: 700;"));
assert.ok(css.includes("--text-heading-line: 1.2;"));
assert.ok(css.includes("--text-body-strong-weight: 600;"), "camelCase kebab-cased");
assert.ok(css.includes("--text-display-weight: 800;"));

// Freshness: the checked-in file must match the generator output.
const onDisk = await readFile(resolve(repoRoot, "typography.css"), "utf8");
assert.equal(onDisk, css, "typography.css is stale — run: npm run tokens");

console.log("test-typography-css: OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-typography-css.mjs`
Expected: FAIL — `Cannot find module .../scripts/generate-typography-css.mjs`

- [ ] **Step 3: Write the generator**

```js
// scripts/generate-typography-css.mjs
// Generates typography.css (repo root) from the @cycleways/core tokens.
// Usage: node scripts/generate-typography-css.mjs [--check]
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import {
  fontSizes,
  fontWeights,
  webFontStack,
  textVariants,
} from "../packages/core/src/ui/typography.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = resolve(repoRoot, "typography.css");

const kebab = (name) => name.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();

export function generateTypographyCss() {
  const lines = [
    "/* GENERATED by scripts/generate-typography-css.mjs — do not edit by hand.",
    "   Source of truth: packages/core/src/ui/typography.js (npm run tokens) */",
    ":root {",
    `  --font-family-base: ${webFontStack};`,
  ];
  for (const [step, px] of Object.entries(fontSizes)) {
    lines.push(`  --font-size-${step}: ${px}px;`);
  }
  for (const [name, weight] of Object.entries(fontWeights)) {
    lines.push(`  --font-weight-${name}: ${weight};`);
  }
  for (const [name, v] of Object.entries(textVariants)) {
    const k = kebab(name);
    lines.push(`  --text-${k}-size: ${v.fontSize}px;`);
    lines.push(`  --text-${k}-weight: ${v.fontWeight};`);
    lines.push(`  --text-${k}-line: ${v.lineHeight};`);
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

async function main() {
  const css = generateTypographyCss();
  if (process.argv.includes("--check")) {
    const onDisk = await readFile(outPath, "utf8").catch(() => "");
    if (onDisk !== css) {
      console.error("typography.css is stale — run: npm run tokens");
      process.exit(1);
    }
    console.log("typography.css is up to date");
    return;
  }
  await writeFile(outPath, css);
  console.log(`wrote ${outPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
```

- [ ] **Step 4: Generate the file and verify the test passes**

Run: `node scripts/generate-typography-css.mjs && node tests/test-typography-css.mjs`
Expected: `wrote .../typography.css` then `test-typography-css: OK`

- [ ] **Step 5: Wire it into the page and the build**

In `styles.css`, add as **line 1** (CSS `@import` must precede all rules; both the Vite build and the raw dev server resolve it):

```css
@import "./typography.css";
```

In root `package.json` scripts, add:

```json
"tokens": "node scripts/generate-typography-css.mjs",
"predev": "npm run tokens",
"prebuild": "npm run tokens",
```

And insert `node tests/test-typography-css.mjs && ` into the `"test"` chain right after the `test-typography-tokens.mjs` entry.

- [ ] **Step 6: Verify the app still renders**

Run: `npm run dev` (briefly) — confirm the site loads with no console error about `typography.css`, then stop it.

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-typography-css.mjs typography.css styles.css tests/test-typography-css.mjs package.json
git commit -m "feat: generate web typography.css custom properties from core tokens"
```

---

### Task 3: Native theme adapter

**Files:**
- Create: `apps/mobile/src/theme/typography.js`
- Test: `tests/test-mobile-typography.mjs`
- Modify: `package.json` (register test)

**Interfaces:**
- Consumes: `textVariants`, `fontSizes`, `fontWeights` from `@cycleways/core/ui/typography.js` (Task 1; Metro already resolves the workspace package — see `apps/mobile/metro.config.js`).
- Produces: `text` — map of variant name → ready RN style `{ fontSize: number, fontWeight: string, lineHeight: number /* absolute px */ }`; re-exports `fontSizes`, `fontWeights`. Tasks 4–5 use `import { text, fontSizes } from "../theme/typography.js"` (path adjusted per file) and spread: `style={{ ...text.subheading }}` or inside `StyleSheet.create` entries: `title: { ...text.subheading, color: "#172026" }`.

- [ ] **Step 1: Write the failing test**

```js
// tests/test-mobile-typography.mjs
import assert from "node:assert/strict";
import { text, fontSizes, fontWeights } from "../apps/mobile/src/theme/typography.js";
import { textVariants } from "../packages/core/src/ui/typography.js";

// Every core variant is adapted, nothing added.
assert.deepEqual(Object.keys(text).sort(), Object.keys(textVariants).sort());

// RN needs string weights and absolute (rounded px) line heights.
assert.deepEqual(text.heading, { fontSize: 24, fontWeight: "700", lineHeight: 29 }); // 24*1.2=28.8→29
assert.deepEqual(text.body, { fontSize: 15, fontWeight: "400", lineHeight: 22 });    // 15*1.45=21.75→22
assert.deepEqual(text.display, { fontSize: 30, fontWeight: "800", lineHeight: 33 }); // 30*1.1=33

for (const style of Object.values(text)) {
  assert.equal(typeof style.fontWeight, "string");
  assert.equal(style.lineHeight, Math.round(style.lineHeight), "integer px line height");
}

// Token re-exports for the rare size-only case (chart ticks).
assert.equal(fontSizes.sm, 13);
assert.equal(fontWeights.bold, 700);

console.log("test-mobile-typography: OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-mobile-typography.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the adapter**

```js
// apps/mobile/src/theme/typography.js
// RN-ready text styles derived from the shared core tokens.
// Spec: plans/typography-design-system/design.md
import {
  textVariants,
  fontSizes,
  fontWeights,
} from "@cycleways/core/ui/typography.js";

const toNativeStyle = ({ fontSize, fontWeight, lineHeight }) => ({
  fontSize,
  fontWeight: String(fontWeight),
  lineHeight: Math.round(fontSize * lineHeight),
});

export const text = Object.fromEntries(
  Object.entries(textVariants).map(([name, v]) => [name, toNativeStyle(v)]),
);

export { fontSizes, fontWeights };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-mobile-typography.mjs`
Expected: `test-mobile-typography: OK`

- [ ] **Step 5: Register the test**

Insert `node tests/test-mobile-typography.mjs && ` into the root `package.json` `"test"` chain after the `test-typography-css.mjs` entry.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/theme/typography.js tests/test-mobile-typography.mjs package.json
git commit -m "feat: RN typography theme adapter over core tokens"
```

---

### Task 4: Native migration — planner components

**Files (modify; hit counts are `fontWeight|fontSize` grep matches):**
`apps/mobile/src/planner/NavPanel.jsx` (30 — the riding surface, uses `nav*`/`display`), `BuildEmptyActions.jsx`, `DestinationSheet.jsx`, `DevScenarioPicker.jsx`, `DiscoverPanel.jsx`, `MapLegend.jsx`, `PlaybackControls.jsx`, `RideSetupSheet.jsx`, `RouteCard.jsx`, `RoutePoiList.jsx`, `TopSearch.jsx` — all under `apps/mobile/src/planner/`.

**Interfaces:**
- Consumes: `text`, `fontSizes` from `apps/mobile/src/theme/typography.js` (Task 3), imported as `import { text } from "../theme/typography.js";`

- [ ] **Step 1: Migrate every file using the mapping rules**

For each file, replace every literal `fontSize:`/`fontWeight:` pair (or lone occurrence) with a variant spread per the mapping table at the top of this plan. The spread goes **first** so intentional non-typography properties (color, margins) survive:

Before (from `RouteCard.jsx`-style code):

```js
title: { fontSize: 17, fontWeight: "800", color: "#172026" },
meta: { fontSize: 12, fontWeight: "700", color: "#52616f" },
```

After:

```js
title: { ...text.subheading, color: "#172026" },
meta: { ...text.captionStrong, color: "#52616f" },
```

NavPanel.jsx only: cue titles → `text.navTitle`, stat readouts/big numbers → `text.display`, instruction body → `text.navBody`, secondary lines → `text.navCaption`. Every other planner file uses only the standard 8 variants.

Where a bare `fontSize` has no text role (icon glyph boxes), use `fontSize: fontSizes.xl` etc. (nearest step, ties up) — never a number.

- [ ] **Step 2: Verify no literals remain in planner/**

Run: `grep -rEn "fontWeight:\s*[\"']|fontSize:\s*[0-9]" apps/mobile/src/planner/`
Expected: no output.

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: PASS (planner model/nav tests exercise these modules' imports).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/planner
git commit -m "refactor: planner components on typography variants (nav tier in NavPanel)"
```

---

### Task 5: Native migration — screens and remaining components

**Files (modify):** `apps/mobile/App.js` (2), `apps/mobile/src/ElevationProfileChart.jsx`, `apps/mobile/src/RichText.jsx`, `apps/mobile/src/splash/AnimatedLaunchSplash.jsx`, and under `apps/mobile/src/screens/`: `AboutScreen.jsx`, `BuildScreen.jsx`, `DiscoverScreen.jsx`, `RouteDetailNative.jsx`, `RouteDetailScreen.jsx`, `RouteDetailWeb.jsx`.

**Interfaces:**
- Consumes: same as Task 4 (`text`, `fontSizes` from the theme adapter; relative import path differs per directory, e.g. `"./theme/typography.js"` is wrong from `screens/` — use `"../theme/typography.js"`; from `App.js` use `"./src/theme/typography.js"`).

- [ ] **Step 1: Migrate every file using the mapping rules**

Same mechanics as Task 4. Specific notes:
- Screen titles (`DiscoverScreen`, `RouteDetailNative`, `AboutScreen`) → `text.heading`; card/section titles → `text.subheading`; descriptions → `text.body`; buttons → `text.bodyStrong`; chips/badges/stats → `text.captionStrong`; fine print → `text.caption` or `text.label`.
- `ElevationProfileChart.jsx` axis/tick labels: size-only case → `fontSizes.xs`/`fontSizes.sm` with `fontWeights` tokens if a weight is set (max `semibold` — chart text is not a heading).
- `RichText.jsx` bold spans → `fontWeight: String(fontWeights.bold)` via the adapter's re-export (or `...text.bodyStrong` if the size also matches `md`).
- `AnimatedLaunchSplash.jsx` brand text → `text.heading` unless it is a size-only glyph.
- No `nav*`/`display` variants in any of these files.

- [ ] **Step 2: Verify no literals remain anywhere native**

Run: `grep -rEn "fontWeight:\s*[\"']|fontSize:\s*[0-9]" apps/mobile/src apps/mobile/App.js | grep -v "src/theme/typography.js"`
Expected: no output.

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/App.js apps/mobile/src
git commit -m "refactor: native screens and components on typography variants"
```

---

### Task 6: Web migration — global stylesheets + font family

**Files:**
- Modify: `styles.css` (109 font declarations), `src/react-app.css` (98), `src/route-boundary.css` (3), `index.html` (Google Fonts link)

**Interfaces:**
- Consumes: the CSS custom properties from `typography.css` (Task 2). Composite pattern per rule:

```css
/* variant-shaped text */
.selector {
  font-size: var(--text-subheading-size);
  font-weight: var(--text-subheading-weight);
  line-height: var(--text-subheading-line);
}
/* size-only cases (icon glyphs) */
.selector { font-size: var(--font-size-xl); }
/* weight-only emphasis on inherited size */
.selector { font-weight: var(--font-weight-semibold); }
```

- [ ] **Step 1: Fix the font-family inconsistency**

In `src/react-app.css` `:root` (currently `Arial, "Segoe UI", sans-serif`) and in every `font-family` rule in `styles.css` that spells out a stack (except the `'Courier New', monospace` code block rule, which stays): replace with `font-family: var(--font-family-base);`.

- [ ] **Step 2: Trim the Google Fonts link**

In `index.html`, change the Assistant link to load only the sanctioned weights:

```html
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700;800&display=swap" rel="stylesheet">
```

- [ ] **Step 3: Migrate the three stylesheets**

Apply the mapping rules to every `font-size`/`font-weight` in `styles.css`, `src/react-app.css`, `src/route-boundary.css`. Concrete examples from the current code:

```css
/* BEFORE (react-app.css) */
.data-marker-card__title { font-size: 16px; font-weight: 800; }
.data-marker-card__segment { margin: 0; color: #52616f; font-size: 12px; font-weight: 700; }
.data-marker-card__info { margin: 0; color: #333; font-size: 13px; line-height: 1.45; }
.data-marker-card__add { /* … */ font-size: 14px; font-weight: 700; }
.data-marker-card__close { /* … */ font-size: 22px; line-height: 1; }

/* AFTER */
.data-marker-card__title { font-size: var(--text-subheading-size); font-weight: var(--text-subheading-weight); line-height: var(--text-subheading-line); }
.data-marker-card__segment { margin: 0; color: #52616f; font-size: var(--text-caption-strong-size); font-weight: var(--text-caption-strong-weight); }
.data-marker-card__info { margin: 0; color: #333; font-size: var(--text-body-size); line-height: var(--text-body-line); }
.data-marker-card__add { /* … */ font-size: var(--text-body-strong-size); font-weight: var(--text-body-strong-weight); }
.data-marker-card__close { /* … */ font-size: var(--font-size-xl); line-height: 1; } /* glyph: size-only, line-height 1 intentional */
```

`font-weight: 900/850/800` cases: real page titles → `--text-heading-*`; everything else per the mapping table. No `nav*`/`display` variables in web CSS (navigation is app-only; if a stat readout genuinely needs display treatment, flag it in the task report).

- [ ] **Step 4: Verify no literals remain in these files**

Run: `grep -En "font-size:\s*[0-9.]|font-weight:\s*[0-9]|font-weight:\s*bold" styles.css src/react-app.css src/route-boundary.css`
Expected: no output.

- [ ] **Step 5: Visual smoke + tests**

Run: `npm test` → PASS. Then `npm run dev`, load the front page, confirm text renders (vars resolving — no uniformly 16px/regular text), stop the server.

- [ ] **Step 6: Commit**

```bash
git add styles.css src/react-app.css src/route-boundary.css index.html
git commit -m "refactor: global web styles on typography variables, unify Assistant stack"
```

---

### Task 7: Web migration — component stylesheets

**Files:**
- Modify: `src/components/frontPanel/front-panel.css` (106), `src/components/featured/featured.css` (124), `src/components/routes/routes.css` (28), `src/components/welcome-wizard.css` (21), `src/components/DownloadModal.jsx` (inline style objects)

**Interfaces:**
- Consumes: same CSS variables and composite pattern as Task 6. For the JSX inline styles in `DownloadModal.jsx` use the same variables: `style={{ fontSize: "var(--text-caption-size)", fontWeight: "var(--text-caption-weight)" }}`.

- [ ] **Step 1: Migrate the four stylesheets + DownloadModal**

Apply the mapping rules exactly as in Task 6. Front-panel notes (the worst offender — 850/900 cluster): sheet titles → `--text-subheading-*`, panel headings → `--text-heading-*`, stat chips → `--text-caption-strong-*`, hint text → `--text-caption-*`, buttons → `--text-body-strong-*`. Featured-page hero titles → `--text-heading-*`; hero stat numbers are the one place `--text-display-*` **may** be used on web if the current style is ≥28px/800+ (document each use with a `/* display: hero stat */` comment).

- [ ] **Step 2: Verify no literals remain**

Run: `grep -rEn "font-size:\s*[0-9.]|font-weight:\s*[0-9]|font-weight:\s*bold|fontWeight:\s*[\"']?[0-9b]|fontSize:\s*[0-9]" src/components/`
Expected: no output.

- [ ] **Step 3: Run tests**

Run: `npm test` → PASS. `npm run test:smoke` (Playwright) → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components
git commit -m "refactor: component stylesheets on typography variables"
```

---

### Task 8: Guard test + end-to-end verification

**Files:**
- Test: `tests/test-typography-guard.mjs`
- Modify: `package.json` (register test)

**Interfaces:**
- Consumes: nothing new — it greps the files migrated in Tasks 4–7 to keep them clean forever.

- [ ] **Step 1: Write the guard test**

```js
// tests/test-typography-guard.mjs
// Keeps the typography sweep from regressing: no literal font sizes/weights
// outside the token modules. Spec: plans/typography-design-system/design.md
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join, relative } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const webFiles = [
  "styles.css",
  "src/react-app.css",
  "src/route-boundary.css",
  "src/components/frontPanel/front-panel.css",
  "src/components/featured/featured.css",
  "src/components/routes/routes.css",
  "src/components/welcome-wizard.css",
];

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(jsx?|tsx?)$/.test(name) ? [p] : [];
  });

// JSX/JS on both surfaces: native app + web src (e.g. DownloadModal.jsx).
// The theme adapter itself is the one legitimate holder of literals.
const jsFiles = [
  ...walk(resolve(repoRoot, "apps/mobile/src")),
  resolve(repoRoot, "apps/mobile/App.js"),
  ...walk(resolve(repoRoot, "src")),
].filter((p) => !p.endsWith("src/theme/typography.js"));

const failures = [];

for (const file of webFiles) {
  const css = await readFile(resolve(repoRoot, file), "utf8");
  css.split("\n").forEach((line, i) => {
    if (/font-size:\s*[0-9.]/.test(line) || /font-weight:\s*([0-9]|bold)/.test(line)) {
      failures.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  });
}

for (const file of jsFiles) {
  const src = await readFile(file, "utf8");
  src.split("\n").forEach((line, i) => {
    // Literal weights ("700", 'bold') and numeric sizes are banned;
    // fontWeight: "var(--...)" and fontSize: fontSizes.xl are fine.
    if (/fontWeight:\s*["'](\d|bold)/.test(line) || /fontSize:\s*[0-9]/.test(line)) {
      failures.push(`${relative(repoRoot, file)}:${i + 1}: ${line.trim()}`);
    }
  });
}

assert.deepEqual(failures, [], `literal font styles found:\n${failures.join("\n")}`);
console.log(`test-typography-guard: OK (${webFiles.length} css + ${jsFiles.length} js files clean)`);
```

- [ ] **Step 2: Run it — fix any stragglers it finds**

Run: `node tests/test-typography-guard.mjs`
Expected: PASS. If it fails, each reported line is a missed migration — map it per the rules and re-run until clean.

- [ ] **Step 3: Register the test**

Insert `node tests/test-typography-guard.mjs && ` into the `"test"` chain after the `test-mobile-typography.mjs` entry.

- [ ] **Step 4: Full verification**

Run: `npm test` → PASS. `npm run test:smoke` → PASS. `npm run build` → succeeds (prebuild regenerates typography.css; do NOT `git add` public-data changes the build makes).

- [ ] **Step 5: Visual review evidence**

With `npm run dev` running, capture desktop + mobile-viewport screenshots of: front page (planner + front panel), a route page (`/routes/...`), and a featured page, e.g. via `npx playwright screenshot --viewport-size=390,844 http://127.0.0.1:5173 front-mobile.png` (save under `$CLAUDE_JOB_DIR/tmp/` or the session scratchpad, NOT the repo). Present them to the user. Native screens (Discover, RouteDetail, NavPanel riding view) need the user to run the iOS simulator — flag this explicitly in the final report.

- [ ] **Step 6: Commit**

```bash
git add tests/test-typography-guard.mjs package.json
git commit -m "test: typography guard — no literal font sizes/weights outside tokens"
```
