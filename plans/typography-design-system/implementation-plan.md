# Typography Design System Implementation Plan

> **For agentic workers:** Execute the tasks in order, one at a time, checking off steps (`- [ ]`) as you go. The plan is self-contained — every step says exactly what to do. If your harness provides the superpowers skills, `superpowers:subagent-driven-development` or `superpowers:executing-plans` are recommended wrappers, but they are optional.

**Date:** 2026-07-06 (revised same day after plan review)
**Spec:** `plans/typography-design-system/design.md` (read it first — it defines the scale, variants, and decisions)

**Goal:** Replace ~260 ad-hoc font-size/font-weight declarations on both surfaces (React Native app + web app) with a token-driven typography system sourced from `@cycleways/core`.

**Architecture:** A single plain-JS token module in `packages/core/src/ui/typography.js` is consumed two ways: a thin RN adapter (`apps/mobile/src/theme/typography.js`) turns variants into ready style objects, and a codegen script (`scripts/generate-typography-css.mjs`) emits a checked-in root `typography.css` of CSS custom properties that all web CSS references via `var()`. A guard test makes regressions impossible.

**Tech Stack:** Plain ES modules, standalone `node tests/test-*.mjs` assert scripts (this repo's convention), React Native (Expo), Vite.

## Global Constraints

- Size scale (pt native / px web): xs=11, sm=13, md=15, lg=17, xl=20, 2xl=24, 3xl=30. No other font sizes anywhere.
- Weights: regular=400, semibold=600, bold=700, heavy=800. Heavy (800) appears ONLY inside the `display` and `navTitle` variants. Weights 500, 650, 750, 850, 900 are eliminated.
- Variants: display 30/800/1.1, heading 24/700/1.2, subheading 17/600/1.3, body 15/400/1.45, bodyStrong 15/600/1.45, caption 13/400/1.4, captionStrong 13/600/1.4, label 11/600/1.3, navTitle 20/800/1.2, navBody 15/700/1.45, navCaption 13/700/1.4.
- **Placement rule (single source: the spec):** `nav*` variants only in `apps/mobile/src/planner/NavPanel.jsx`. `display` only for hero-scale text: NavPanel stat readouts natively; on web only the front-page hero and featured-page hero titles/stats, each web use marked `/* display: hero */`.
- Native keeps the platform system font (no fontFamily anywhere). Web standardizes on the Assistant stack via `--font-family-base`.
- `editor/` is out of scope (it uses its own `editor/styles.css`, not the root one).
- **Behavioral exception:** the `input, select, textarea { font-size: 16px; }` rule in `styles.css` prevents iOS Safari zoom-on-focus, which triggers below 16px. It becomes `var(--font-size-lg)` (17px — still ≥16, behavior preserved) with a comment stating the ≥16px constraint. Never map it below 16px.
- Every migrated file: font values must come from tokens (spread variants natively, `var(--...)` on web) — never literal numbers, quoted or not.
- All typography tests live in one short npm script, `test:typography`, spliced ONCE into the main `"test"` chain (Task 1). Later tasks append to `test:typography` only — never edit the long `"test"` string again.
- Commit after each task. Do not run `git add -A` (repo rule: builds regenerate `public-data/`).

## Migration mapping rules (used by Tasks 5–11)

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
| Riding stat readouts / big numbers (NavPanel only) | `display` |
| Navigation cue titles (NavPanel only, was 20–22px 800–900) | `navTitle` |
| Navigation body/secondary text (NavPanel only) | `navBody` / `navCaption` |
| Web hero title/stats on front & featured pages (incl. the `clamp(2rem, 4vw, 3.5rem)` rule at `src/react-app.css:183`) | `display` with `/* display: hero */` comment — fluid `clamp()` sizing is removed; heroes snap to 30px like everything else |

For pure-size cases with no text role (icon glyphs like the `×` close button, chart tick labels): snap to the nearest scale step, ties round **up** (10→11, 12→13, 14→15, 16→17, 22→24, 26→24, 28→30). For rem values convert at 16px base first (0.75rem=12→13, 0.82rem≈13→13, 0.9rem≈14.4→15, 1rem=16→17, 1.2rem≈19→20, 1.9rem≈30→30).

If a file outside NavPanel seems to need `nav*`, or a non-hero web element seems to need `display`, STOP and flag it in your task report instead of using it.

---

### Task 1: Core typography tokens + `test:typography` script

**Files:**
- Create: `packages/core/src/ui/typography.js`
- Test: `tests/test-typography-tokens.mjs`
- Modify: `package.json` (add `test:typography`; splice it once into `"test"`)

**Interfaces:**
- Produces: `fontSizes` (`{xs,sm,md,lg,xl,"2xl","3xl"}` → numbers), `fontWeights` (`{regular:400,semibold:600,bold:700,heavy:800}`), `lineHeights` (`{tight:1.1,heading:1.2,snug:1.3,caption:1.4,body:1.45}`), `webFontStack` (string), `textVariants` (map of the 11 variants, each `{fontSize:number, fontWeight:number, lineHeight:number-ratio}`). Consumed by Tasks 2 and 3 via the import path `@cycleways/core/ui/typography.js` (the workspace package maps `./*` to `./src/*`).

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

- [ ] **Step 5: Register the test — create `test:typography`**

In root `package.json` scripts, add this new script:

```json
"test:typography": "node tests/test-typography-tokens.mjs",
```

Then in the long `"test"` script, insert `npm run test:typography && ` immediately before the final `cd tests && node test-route-manager.js` segment. This is the ONLY edit the whole plan makes to the `"test"` string; Tasks 2, 3, and 12 append to `test:typography` instead.

Run: `npm run test:typography`
Expected: `test-typography-tokens: OK`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ui/typography.js tests/test-typography-tokens.mjs package.json
git commit -m "feat: typography tokens in @cycleways/core (7-step scale, 4 weights, 11 variants)"
```

---

### Task 2: Web CSS codegen → root `typography.css`

**Files:**
- Create: `scripts/generate-typography-css.mjs`
- Create (generated, checked in): `typography.css` (repo root, next to `styles.css`)
- Modify: `styles.css` (add `@import "./typography.css";` as the very first line)
- Modify: `package.json` (add `tokens` script + `predev`/`prebuild` hooks; append to `test:typography`)
- Test: `tests/test-typography-css.mjs`

**Interfaces:**
- Consumes: everything exported by `packages/core/src/ui/typography.js` (Task 1).
- Produces: `typography.css` defining, on `:root`: `--font-family-base`, `--font-size-<step>` (px) for the 7 steps, `--font-weight-<name>` for the 4 weights, and per variant (camelCase → kebab-case, e.g. `bodyStrong` → `body-strong`): `--text-<variant>-size` (px), `--text-<variant>-weight`, `--text-<variant>-line` (unitless ratio). Tasks 10–11 reference these. The script exports `generateTypographyCss(): string` and supports `--check` (exit 1 when the file on disk is stale).

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

In `styles.css`, add as **line 1** (CSS `@import` must precede all rules; both the Vite build and the raw dev server resolve it — `styles.css` and `typography.css` sit side by side at the repo root):

```css
@import "./typography.css";
```

In root `package.json`:
- Add scripts:

```json
"tokens": "node scripts/generate-typography-css.mjs",
"predev": "npm run tokens",
"prebuild": "npm run tokens",
```

- Change `test:typography` to:

```json
"test:typography": "node tests/test-typography-tokens.mjs && node tests/test-typography-css.mjs",
```

Run: `npm run test:typography`
Expected: both OK lines.

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
- Modify: `package.json` (append to `test:typography`)

**Interfaces:**
- Consumes: `textVariants`, `fontSizes`, `fontWeights` from `@cycleways/core/ui/typography.js` (Task 1; Metro already resolves the workspace package — see `apps/mobile/metro.config.js`).
- Produces: `text` — map of variant name → ready RN style `{ fontSize: number, fontWeight: string, lineHeight: number /* absolute px */ }`; re-exports `fontSizes`, `fontWeights`. Tasks 5–9 use `import { text, fontSizes, fontWeights } from "../theme/typography.js"` (relative path adjusted per file) and spread: `style={{ ...text.subheading }}` or inside `StyleSheet.create` entries: `title: { ...text.subheading, color: "#172026" }`.

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

// Token re-exports for the rare size-only case (chart ticks, icon glyphs).
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

In root `package.json`, change `test:typography` to:

```json
"test:typography": "node tests/test-typography-tokens.mjs && node tests/test-typography-css.mjs && node tests/test-mobile-typography.mjs",
```

Run: `npm run test:typography` → three OK lines.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/theme/typography.js tests/test-mobile-typography.mjs package.json
git commit -m "feat: RN typography theme adapter over core tokens"
```

---

### Task 4: Baseline screenshots (BEFORE any migration)

The spec requires before/after visual review. Capture the "before" set now, while the UI is untouched.

**Files:**
- Create: `plans/typography-design-system/screenshots/before/*.png` — **do not commit these** (they exist for the review conversation only; leave them untracked).

- [ ] **Step 1: Start the dev server**

Run `npm run dev` in the background. Wait until it prints the local URL (`http://127.0.0.1:5173`).

- [ ] **Step 2: Capture the baseline set**

```bash
mkdir -p plans/typography-design-system/screenshots/before
cd plans/typography-design-system/screenshots/before
npx playwright screenshot --viewport-size="390,844"  "http://127.0.0.1:5173/"                            front-mobile.png
npx playwright screenshot --viewport-size="1280,800" "http://127.0.0.1:5173/"                            front-desktop.png
npx playwright screenshot --viewport-size="390,844"  "http://127.0.0.1:5173/routes/"                     routes-mobile.png
npx playwright screenshot --viewport-size="1280,800" "http://127.0.0.1:5173/routes/"                     routes-desktop.png
npx playwright screenshot --viewport-size="390,844"  "http://127.0.0.1:5173/featured/sovev-beit-hillel/" featured-mobile.png
npx playwright screenshot --viewport-size="1280,800" "http://127.0.0.1:5173/featured/sovev-beit-hillel/" featured-desktop.png
cd -
```

If a URL 404s in dev, note it in your report and skip that pair — do not improvise other URLs.

- [ ] **Step 3: Verify and stop**

Confirm all captured PNGs are non-empty (`ls -la plans/typography-design-system/screenshots/before/`), then stop the dev server. Nothing to commit in this task.

---

### Task 5: Native migration — NavPanel (the riding surface)

**Files:**
- Modify: `apps/mobile/src/planner/NavPanel.jsx` (30 fontWeight/fontSize matches)

**Interfaces:**
- Consumes: `text` from `apps/mobile/src/theme/typography.js` (Task 3): `import { text } from "../theme/typography.js";`

This is the ONLY file allowed to use `text.navTitle`, `text.navBody`, `text.navCaption`, and (natively) `text.display`.

- [ ] **Step 1: Migrate**

Replace every literal `fontSize`/`fontWeight` per the mapping rules. The spread goes **first** so intentional non-typography properties (color, margins) survive:

```js
// BEFORE (pattern)
cueTitle: { fontSize: 22, fontWeight: "900", color: "#fff" },
statValue: { fontSize: 28, fontWeight: "900" },
statLabel: { fontSize: 11, fontWeight: "800", color: "#9fb0bb" },
secondary: { fontSize: 13, fontWeight: "700", color: "#c8d4dc" },

// AFTER
cueTitle: { ...text.navTitle, color: "#fff" },
statValue: { ...text.display },
statLabel: { ...text.label, color: "#9fb0bb" },
secondary: { ...text.navCaption, color: "#c8d4dc" },
```

Cue titles → `navTitle`; big stat numbers → `display`; instruction body → `navBody`; secondary/meta lines → `navCaption`; tiny stat labels → `label`; anything that is not riding-glanceability text uses the standard variants (`subheading`, `body`, `caption`…).

- [ ] **Step 2: Verify no literals remain in this file**

Run: `grep -En "fontWeight:\s*[\"']?[0-9b]|fontSize:\s*[\"']?[0-9]" apps/mobile/src/planner/NavPanel.jsx`
Expected: no output.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS (the nav presentation/scenario tests exercise this module's imports).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/planner/NavPanel.jsx
git commit -m "refactor: NavPanel on nav-tier typography variants"
```

---

### Task 6: Native migration — planner discovery components

**Files (modify, with match counts):**
- `apps/mobile/src/planner/DiscoverPanel.jsx` (40)
- `apps/mobile/src/planner/RouteCard.jsx` (21)
- `apps/mobile/src/planner/RoutePoiList.jsx` (8)

**Interfaces:**
- Consumes: `text`, `fontSizes` from the theme adapter: `import { text } from "../theme/typography.js";`
- Standard variants only — NO `nav*`/`display` here.

- [ ] **Step 1: Migrate all three files**

Apply the mapping rules; spread first, keep colors/margins:

```js
// BEFORE (RouteCard.jsx pattern)
title: { fontSize: 17, fontWeight: "800", color: "#172026" },
meta: { fontSize: 12, fontWeight: "700", color: "#52616f" },

// AFTER
title: { ...text.subheading, color: "#172026" },
meta: { ...text.captionStrong, color: "#52616f" },
```

Card titles → `subheading`; descriptions → `body`; stat chips/badges → `captionStrong`; hints/meta → `caption`; section headers in DiscoverPanel → `subheading`; buttons → `bodyStrong`.

- [ ] **Step 2: Verify no literals remain in these files**

Run: `grep -En "fontWeight:\s*[\"']?[0-9b]|fontSize:\s*[\"']?[0-9]" apps/mobile/src/planner/DiscoverPanel.jsx apps/mobile/src/planner/RouteCard.jsx apps/mobile/src/planner/RoutePoiList.jsx`
Expected: no output.

- [ ] **Step 3: Run tests**

Run: `npm test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/planner/DiscoverPanel.jsx apps/mobile/src/planner/RouteCard.jsx apps/mobile/src/planner/RoutePoiList.jsx
git commit -m "refactor: planner discovery components on typography variants"
```

---

### Task 7: Native migration — planner sheets & controls

**Files (modify, with match counts):**
- `apps/mobile/src/planner/RideSetupSheet.jsx` (19)
- `apps/mobile/src/planner/BuildEmptyActions.jsx` (13)
- `apps/mobile/src/planner/DestinationSheet.jsx` (10)
- `apps/mobile/src/planner/DevScenarioPicker.jsx` (5)
- `apps/mobile/src/planner/MapLegend.jsx` (4)
- `apps/mobile/src/planner/TopSearch.jsx` (3)
- `apps/mobile/src/planner/PlaybackControls.jsx` (2)

**Interfaces:**
- Consumes: same as Task 6 (`import { text } from "../theme/typography.js";`). Standard variants only.

- [ ] **Step 1: Migrate all seven files**

Same mechanics and mapping as Task 6. Sheet titles → `subheading`; body copy and the ride-setup safety notice → `body`; primary buttons → `bodyStrong`; legend/dev-picker labels → `caption`/`captionStrong`; search placeholder/input text → `body`.

- [ ] **Step 2: Verify no literals remain in planner/**

Run: `grep -rEn "fontWeight:\s*[\"']?[0-9b]|fontSize:\s*[\"']?[0-9]" apps/mobile/src/planner/`
Expected: no output (Tasks 5–7 have now covered the whole directory).

- [ ] **Step 3: Run tests**

Run: `npm test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/planner
git commit -m "refactor: planner sheets and controls on typography variants"
```

---

### Task 8: Native migration — BuildScreen

**Files:**
- Modify: `apps/mobile/src/screens/BuildScreen.jsx` (54 matches — the largest single file; that is why it is its own task)

**Interfaces:**
- Consumes: `text`, `fontSizes` via `import { text } from "../theme/typography.js";` (note: from `screens/` the theme path is `../theme/typography.js`). Standard variants only.

- [ ] **Step 1: Migrate**

Apply the mapping rules to all 54 occurrences. Screen title → `heading`; panel/sheet section titles → `subheading`; descriptions/body copy → `body`; buttons/CTAs → `bodyStrong`; chips, distance/elevation stat labels → `captionStrong`; hints and secondary meta → `caption`; tiny overlays → `label`. Icon glyph boxes with size-only styles → `fontSize: fontSizes.<nearest step>`.

- [ ] **Step 2: Verify no literals remain**

Run: `grep -En "fontWeight:\s*[\"']?[0-9b]|fontSize:\s*[\"']?[0-9]" apps/mobile/src/screens/BuildScreen.jsx`
Expected: no output.

- [ ] **Step 3: Run tests**

Run: `npm test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/screens/BuildScreen.jsx
git commit -m "refactor: BuildScreen on typography variants"
```

---

### Task 9: Native migration — remaining screens & components

**Files (modify, with match counts):**
- `apps/mobile/src/screens/RouteDetailNative.jsx` (12)
- `apps/mobile/src/screens/AboutScreen.jsx` (9)
- `apps/mobile/src/screens/RouteDetailWeb.jsx` (5)
- `apps/mobile/src/screens/DiscoverScreen.jsx` (2)
- `apps/mobile/src/screens/RouteDetailScreen.jsx` (2)
- `apps/mobile/src/ElevationProfileChart.jsx` (5)
- `apps/mobile/App.js` (4)
- `apps/mobile/src/splash/AnimatedLaunchSplash.jsx` (2)
- `apps/mobile/src/RichText.jsx` (1)

**Interfaces:**
- Consumes: the theme adapter. Import paths by location: from `screens/` and `splash/` → `"../theme/typography.js"`; from `src/` root files (`ElevationProfileChart.jsx`, `RichText.jsx`) → `"./theme/typography.js"`; from `App.js` → `"./src/theme/typography.js"`. Standard variants only.

- [ ] **Step 1: Migrate all nine files**

- Screen titles (`RouteDetailNative`, `AboutScreen`, `DiscoverScreen`) → `text.heading`; card/section titles → `text.subheading`; descriptions → `text.body`; buttons → `text.bodyStrong`; chips/stats → `text.captionStrong`; fine print → `text.caption`/`text.label`.
- `ElevationProfileChart.jsx` axis/tick labels: size-only case → `fontSize: fontSizes.xs` (or `sm`), and if a weight is set use `fontWeight: String(fontWeights.semibold)` at most — chart text is not a heading.
- `RichText.jsx` bold spans → `fontWeight: String(fontWeights.bold)` (size inherited from surrounding text).
- `AnimatedLaunchSplash.jsx` brand text → `text.heading` unless it is a size-only glyph (then nearest `fontSizes` step).

- [ ] **Step 2: Verify no literals remain anywhere native**

Run: `grep -rEn "fontWeight:\s*[\"']?[0-9b]|fontSize:\s*[\"']?[0-9]" apps/mobile/src apps/mobile/App.js | grep -v "src/theme/typography.js"`
Expected: no output.

- [ ] **Step 3: Run tests**

Run: `npm test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/App.js apps/mobile/src
git commit -m "refactor: native screens and components on typography variants"
```

---

### Task 10: Web migration — global stylesheets + font family

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

In `src/react-app.css` `:root` (currently `Arial, "Segoe UI", sans-serif`) and in every `font-family` rule in `styles.css` that spells out a stack (except the `'Courier New', monospace` code-block rule, which stays): replace with `font-family: var(--font-family-base);`.

- [ ] **Step 2: Trim the Google Fonts link**

In `index.html`, change the Assistant link to load only the sanctioned weights:

```html
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700;800&display=swap" rel="stylesheet">
```

- [ ] **Step 3: Preserve the iOS anti-zoom rule (behavioral, not aesthetic)**

`styles.css` has (~line 15–19, inside a media query):

```css
/* Prevent zoom on input focus */
input,
select,
textarea {
  font-size: 16px;
}
```

Replace with — and keep the constraint comment:

```css
/* Prevent iOS Safari zoom on input focus: font-size must stay >= 16px.
   --font-size-lg is 17px, satisfying the constraint. */
input,
select,
textarea {
  font-size: var(--font-size-lg);
}
```

- [ ] **Step 4: Migrate the three stylesheets**

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

The fluid hero rule at `src/react-app.css:183` (`font-size: clamp(2rem, 4vw, 3.5rem);`) is the front-page hero — per the placement rule it becomes:

```css
/* display: hero */
font-size: var(--text-display-size);
font-weight: var(--text-display-weight);
line-height: var(--text-display-line);
```

All other `font-weight: 900/850/800` cases: real page titles → `--text-heading-*`; everything else per the mapping table. No `nav*` variables anywhere in web CSS.

- [ ] **Step 5: Verify no literals remain in these files**

Run: `grep -En "font-size:\s*[0-9.a-z(]|font-weight:\s*[0-9b]" styles.css src/react-app.css src/route-boundary.css | grep -v "var(--" | grep -v "inherit"`
Expected: no output.

- [ ] **Step 6: Visual smoke + tests**

Run: `npm test` → PASS. Then `npm run dev`, load the front page, confirm text renders with the new hierarchy (not uniformly 16px/regular — that would mean unresolved variables), stop the server.

- [ ] **Step 7: Commit**

```bash
git add styles.css src/react-app.css src/route-boundary.css index.html
git commit -m "refactor: global web styles on typography variables, unify Assistant stack"
```

---

### Task 11: Web migration — component & page stylesheets

**Files:**
- Modify: `src/components/featured/featured.css` (124), `src/components/frontPanel/front-panel.css` (106), `src/components/routes/routes.css` (28), `src/components/welcome-wizard.css` (21), `src/pages/legal/legal.css` (3 rem sizes — mapped by role in Step 1), `src/components/DownloadModal.jsx` (inline style objects, incl. `fontSize: "12px"` at line ~174)

**Interfaces:**
- Consumes: same CSS variables and composite pattern as Task 10. For the JSX inline styles in `DownloadModal.jsx` use the same variables as strings: `style={{ fontSize: "var(--text-caption-size)", fontWeight: "var(--text-caption-weight)" }}`.

- [ ] **Step 1: Migrate the five stylesheets + DownloadModal**

Apply the mapping rules exactly as in Task 10. Notes:
- `front-panel.css` (the 850/900 cluster): sheet titles → `--text-subheading-*`, panel headings → `--text-heading-*`, stat chips → `--text-caption-strong-*`, hint text → `--text-caption-*`, buttons → `--text-body-strong-*`.
- `featured.css`: hero title and hero stat numbers → `--text-display-*` with a `/* display: hero */` comment on each use; section titles → `--text-heading-*` or `--text-subheading-*` by level; story/body text → `--text-body-*`.
- `legal.css`: page title (1.9rem) → `--text-heading-*`; section headings (1.2rem) → `--text-subheading-*`; body (0.9rem) → `--text-body-*`.

- [ ] **Step 2: Verify no literals remain**

Run: `grep -rEn "font-size:\s*[0-9.a-z(]|font-weight:\s*[0-9b]|fontWeight:\s*[\"']?[0-9b]|fontSize:\s*[\"']?[0-9]" src/components/ src/pages/ | grep -v "var(--" | grep -v "inherit"`
Expected: no output.

- [ ] **Step 3: Run tests**

Run: `npm test` → PASS. `npm run test:smoke` (Playwright) → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components src/pages
git commit -m "refactor: component and page stylesheets on typography variables"
```

---

### Task 12: Guard test + end-to-end verification + after screenshots

**Files:**
- Test: `tests/test-typography-guard.mjs`
- Modify: `package.json` (append to `test:typography`)
- Create: `plans/typography-design-system/screenshots/after/*.png` (untracked, like the baseline)

**Interfaces:**
- Consumes: nothing new — it scans the files migrated in Tasks 5–11 to keep them clean forever.

- [ ] **Step 1: Write the guard test**

```js
// tests/test-typography-guard.mjs
// Keeps the typography sweep from regressing: font sizes/weights must come
// from tokens everywhere outside the token modules themselves.
// Spec: plans/typography-design-system/design.md
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join, relative } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const webCssFiles = [
  "styles.css",
  "src/react-app.css",
  "src/route-boundary.css",
  "src/components/frontPanel/front-panel.css",
  "src/components/featured/featured.css",
  "src/components/routes/routes.css",
  "src/components/welcome-wizard.css",
  "src/pages/legal/legal.css",
];

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(jsx?|tsx?)$/.test(name) ? [p] : [];
  });

// JS/JSX on both surfaces; the theme adapter is the one legitimate
// holder of derived values.
const jsFiles = [
  ...walk(resolve(repoRoot, "apps/mobile/src")),
  resolve(repoRoot, "apps/mobile/App.js"),
  ...walk(resolve(repoRoot, "src")),
].filter((p) => !p.endsWith(join("theme", "typography.js")));

const failures = [];

// CSS: any font-size/font-weight value that is not var() or inherit fails —
// this catches px, rem, em, %, clamp(), calc(), and keywords like `bold`.
// The `font:` shorthand is only allowed as `font: inherit` (button resets).
// line-height is deliberately NOT guarded: `line-height: 1` on icon glyphs
// is legitimate, and variant line-heights arrive via the same var() blocks.
for (const file of webCssFiles) {
  const css = await readFile(resolve(repoRoot, file), "utf8");
  css.split("\n").forEach((line, i) => {
    const bad =
      (/font-size\s*:/.test(line) && !/font-size\s*:\s*(var\(|inherit)/.test(line)) ||
      (/font-weight\s*:/.test(line) && !/font-weight\s*:\s*(var\(|inherit)/.test(line)) ||
      (/(?<![-\w])font\s*:/.test(line) && !/(?<![-\w])font\s*:\s*inherit/.test(line));
    if (bad) failures.push(`${file}:${i + 1}: ${line.trim()}`);
  });
}

// JS/JSX: literal sizes (quoted like "12px" or bare numbers) and literal
// weights ("700", 700, "bold") are banned; token references pass:
// fontSize: fontSizes.xl, fontWeight: String(fontWeights.bold),
// fontSize: "var(--text-caption-size)".
for (const file of jsFiles) {
  const src = await readFile(file, "utf8");
  src.split("\n").forEach((line, i) => {
    if (/fontSize:\s*["']?[\d.]/.test(line) || /fontWeight:\s*["']?(\d|bold)/.test(line)) {
      failures.push(`${relative(repoRoot, file)}:${i + 1}: ${line.trim()}`);
    }
  });
}

assert.deepEqual(failures, [], `literal font styles found:\n${failures.join("\n")}`);
console.log(`test-typography-guard: OK (${webCssFiles.length} css + ${jsFiles.length} js files clean)`);
```

- [ ] **Step 2: Run it — fix any stragglers it finds**

Run: `node tests/test-typography-guard.mjs`
Expected: PASS. If it fails, each reported line is a missed migration — map it per the rules and re-run until clean.

- [ ] **Step 3: Register the test**

In root `package.json`, change `test:typography` to its final form:

```json
"test:typography": "node tests/test-typography-tokens.mjs && node tests/test-typography-css.mjs && node tests/test-mobile-typography.mjs && node tests/test-typography-guard.mjs",
```

Run: `npm run test:typography` → four OK lines.

- [ ] **Step 4: Full verification**

Run: `npm test` → PASS. `npm run test:smoke` → PASS. `npm run build` → succeeds (prebuild regenerates typography.css; do NOT `git add` the public-data changes the build makes).

- [ ] **Step 5: After screenshots + visual review evidence**

Repeat Task 4's screenshot procedure exactly, saving into `plans/typography-design-system/screenshots/after/` (same six filenames, same viewports, same URLs, untracked). Present the before/after pairs to the user for review. Native screens (Discover, RouteDetail, BuildScreen, the NavPanel riding view) cannot be screenshotted this way — state explicitly in the final report that the user needs to review them in the iOS simulator (`npm run mobile:ios`).

- [ ] **Step 6: Commit**

```bash
git add tests/test-typography-guard.mjs package.json
git commit -m "test: typography guard — no literal font sizes/weights outside tokens"
```
