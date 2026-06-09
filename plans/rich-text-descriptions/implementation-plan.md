# Rich Text in Descriptions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authors put links, bold, and paragraph structure into POI and route descriptions, rendered safely on the web app, the React Native app, and an editor live-preview — all from one shared parser.

**Architecture:** A single pure parser in `@cycleways/core` turns a conservative markdown subset (`[text](url)`, `**bold**`, blank-line paragraphs, single-newline soft breaks) into a neutral block/inline AST. Three thin renderers consume that AST: a web React `<RichText>`, a React Native `<RichText>`, and an editor DOM preview. Links are validated against a scheme allow-list; there is no raw-HTML path, so there is no XSS surface. No data-model/schema change — existing string fields are now *interpreted* as the subset.

**Tech Stack:** Plain JS (ES modules), React (web), React Native (mobile), Node `.mjs` test files using `node:assert/strict` (the repo has no vitest/jest — security-relevant logic lives in the parser and is fully unit-tested; the thin renderers are verified manually).

**Design spec:** `plans/rich-text-descriptions/design.md`

---

## File Structure

- **Create** `packages/core/src/utils/richText.js` — the parser. `parseRichText(input) → Block[]`. Pure, no platform deps. The only place with real logic.
- **Create** `tests/test-rich-text.mjs` — unit tests for the parser (added to the `test` npm script).
- **Create** `src/components/RichText.jsx` — web React renderer over the AST.
- **Create** `apps/mobile/src/RichText.jsx` — React Native renderer over the AST.
- **Modify** `editor/editor.js` — import the parser; add a live preview under rich-text textareas (POI short/long, route start/end description).
- **Modify** web POI render sites: `src/components/frontPanel/PanelPoiCard.jsx`, `src/components/featured/POICard.jsx`, `src/components/featured/RoutePoiStoryList.jsx`, `src/components/featured/RoutePoiGallery.jsx`.
- **Modify** `apps/mobile/src/MapScreen.jsx` — render `marker.information` via the RN `<RichText>`.
- **Modify** `src/featured/genericRouteStory.js` + `src/components/featured/FeaturedVideoRoute.jsx` — route narrative (Phase 3).
- **Modify** `package.json` — add the new test file to the `test` script.

The plan is phased so **Phase 1 is independently shippable** (the core ask: links/bold in POI descriptions). Phase 2 (route start/end) and Phase 3 (route narrative) build on the same renderers.

---

## Phase 1 — Core parser, renderers, POI surfaces, editor preview

### Task 1: The parser AST — plain text, paragraphs, soft breaks

**Files:**
- Create: `packages/core/src/utils/richText.js`
- Create: `tests/test-rich-text.mjs`
- Modify: `package.json` (add test to `test` script)

- [ ] **Step 1: Write the failing test**

Create `tests/test-rich-text.mjs`:

```js
import assert from "node:assert/strict";
import { parseRichText } from "@cycleways/core/utils/richText.js";

// Empty / whitespace → no blocks
assert.deepEqual(parseRichText(""), []);
assert.deepEqual(parseRichText("   \n  "), []);
assert.deepEqual(parseRichText(null), []);
assert.deepEqual(parseRichText(undefined), []);

// Plain text → one block, one text node
assert.deepEqual(parseRichText("hello world"), [
  [{ t: "text", v: "hello world" }],
]);

// Blank line → two blocks
assert.deepEqual(parseRichText("first\n\nsecond"), [
  [{ t: "text", v: "first" }],
  [{ t: "text", v: "second" }],
]);

// Three+ newlines collapse to a single block break
assert.deepEqual(parseRichText("a\n\n\n\nb"), [
  [{ t: "text", v: "a" }],
  [{ t: "text", v: "b" }],
]);

// Single newline → soft break inside one block
assert.deepEqual(parseRichText("line one\nline two"), [
  [{ t: "text", v: "line one" }, { t: "break" }, { t: "text", v: "line two" }],
]);

console.log("rich-text: text/paragraph/break tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-rich-text.mjs`
Expected: FAIL — `Cannot find module '.../utils/richText.js'` (file not created yet).

- [ ] **Step 3: Write the minimal implementation**

Create `packages/core/src/utils/richText.js`:

```js
// Conservative markdown-subset parser shared by the web app, the React Native
// app, and the editor preview. Returns a neutral block/inline AST — never HTML.
//
//   Block  = Inline[]                               // one block == one paragraph
//   Inline = { t: "text", v: string }
//          | { t: "break" }                         // soft line break
//          | { t: "bold", children: Inline[] }
//          | { t: "link", href: string, children: Inline[] }
//
// The parser never throws and never loses visible characters: malformed markup
// is emitted as literal text. Links are validated against a scheme allow-list;
// there is no raw-HTML path, so there is no injection surface.

function parseInline(text) {
  const nodes = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      nodes.push({ t: "text", v: buf });
      buf = "";
    }
  };
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      flush();
      nodes.push({ t: "break" });
      continue;
    }
    buf += text[i];
  }
  flush();
  return nodes;
}

export function parseRichText(input) {
  const str = String(input == null ? "" : input);
  if (!str.trim()) return [];
  return str
    .split(/\n{2,}/)
    .map((block) => block.replace(/^\n+|\n+$/g, ""))
    .filter((block) => block.length > 0)
    .map((block) => parseInline(block))
    .filter((nodes) => nodes.length > 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-rich-text.mjs`
Expected: PASS — prints `rich-text: text/paragraph/break tests passed`.

- [ ] **Step 5: Wire the test into the suite**

In `package.json`, in the `"test"` script, insert ` && node tests/test-rich-text.mjs` immediately after `node tests/test-data-markers.mjs` (any stable position is fine; place it next to the other data/POI tests).

- [ ] **Step 6: Run the full focused check**

Run: `node tests/test-rich-text.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/utils/richText.js tests/test-rich-text.mjs package.json
git commit -m "feat(rich-text): parser for plain text, paragraphs, soft breaks"
```

---

### Task 2: Bold parsing

**Files:**
- Modify: `packages/core/src/utils/richText.js`
- Modify: `tests/test-rich-text.mjs`

- [ ] **Step 1: Add failing tests**

Append to `tests/test-rich-text.mjs` (before the final `console.log` of the file is fine; just add a new block):

```js
// Bold
assert.deepEqual(parseRichText("a **bold** b"), [
  [
    { t: "text", v: "a " },
    { t: "bold", children: [{ t: "text", v: "bold" }] },
    { t: "text", v: " b" },
  ],
]);

// Whole-string bold
assert.deepEqual(parseRichText("**all**"), [
  [{ t: "bold", children: [{ t: "text", v: "all" }] }],
]);

// Unclosed bold stays literal
assert.deepEqual(parseRichText("**oops"), [
  [{ t: "text", v: "**oops" }],
]);

// A lone asterisk stays literal
assert.deepEqual(parseRichText("2 * 3 = 6"), [
  [{ t: "text", v: "2 * 3 = 6" }],
]);

console.log("rich-text: bold tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-rich-text.mjs`
Expected: FAIL — the `a **bold** b` assertion fails (current parser emits one text node with literal asterisks).

- [ ] **Step 3: Implement bold in the inline scanner**

Replace the body of `parseInline` in `packages/core/src/utils/richText.js` with a scanner that recognizes `**…**`:

```js
const BOLD_RE = /^\*\*([\s\S]+?)\*\*/;

function parseInline(text) {
  const nodes = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      nodes.push({ t: "text", v: buf });
      buf = "";
    }
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\n") {
      flush();
      nodes.push({ t: "break" });
      i += 1;
      continue;
    }
    const bold = BOLD_RE.exec(text.slice(i));
    if (bold) {
      flush();
      nodes.push({ t: "bold", children: parseInline(bold[1]) });
      i += bold[0].length;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return nodes;
}
```

(`BOLD_RE` is declared at module scope, above `parseInline`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-rich-text.mjs`
Expected: PASS — prints `rich-text: bold tests passed` (and the earlier lines).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/utils/richText.js tests/test-rich-text.mjs
git commit -m "feat(rich-text): bold (**…**) parsing"
```

---

### Task 3: Link parsing + URL allow-list

**Files:**
- Modify: `packages/core/src/utils/richText.js`
- Modify: `tests/test-rich-text.mjs`

- [ ] **Step 1: Add failing tests**

Append to `tests/test-rich-text.mjs`:

```js
// Allowed link schemes
assert.deepEqual(parseRichText("see [photos](https://x.com/a)"), [
  [
    { t: "text", v: "see " },
    { t: "link", href: "https://x.com/a", children: [{ t: "text", v: "photos" }] },
  ],
]);
assert.deepEqual(parseRichText("[mail](mailto:a@b.com)"), [
  [{ t: "link", href: "mailto:a@b.com", children: [{ t: "text", v: "mail" }] }],
]);
assert.deepEqual(parseRichText("[call](tel:+972500000000)"), [
  [{ t: "link", href: "tel:+972500000000", children: [{ t: "text", v: "call" }] }],
]);

// Bold may nest inside a link label
assert.deepEqual(parseRichText("[**bold link**](https://x.com)"), [
  [
    {
      t: "link",
      href: "https://x.com",
      children: [{ t: "bold", children: [{ t: "text", v: "bold link" }] }],
    },
  ],
]);

// Rejected schemes → link text kept as plain text, href dropped
assert.deepEqual(parseRichText("[x](javascript:alert(1))"), [
  [{ t: "text", v: "x" }],
]);
assert.deepEqual(parseRichText("[x](data:text/html;base64,AA)"), [
  [{ t: "text", v: "x" }],
]);
// Relative / scheme-less → rejected (text kept)
assert.deepEqual(parseRichText("[x](/local/path)"), [
  [{ t: "text", v: "x" }],
]);

// Malformed link stays literal
assert.deepEqual(parseRichText("[x]("), [[{ t: "text", v: "[x](" }]]);
assert.deepEqual(parseRichText("[x] (y)"), [[{ t: "text", v: "[x] (y)" }]]);

console.log("rich-text: link tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-rich-text.mjs`
Expected: FAIL — the first link assertion fails (links not yet parsed).

- [ ] **Step 3: Implement link parsing + allow-list**

In `packages/core/src/utils/richText.js`, add at module scope (above `parseInline`):

```js
const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);
const LINK_RE = /^\[([^\]]*)\]\(([^)\s]+)\)/;

function isAllowedHref(raw) {
  const href = String(raw == null ? "" : raw).trim();
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href);
  if (!scheme) return false; // relative / scheme-less is rejected
  return ALLOWED_SCHEMES.has(`${scheme[1].toLowerCase()}:`);
}
```

Then in `parseInline`, check links **before** bold (so `[`-led tokens win their span). Insert this branch right after the `"\n"` branch and before the `BOLD_RE` branch:

```js
    const link = LINK_RE.exec(text.slice(i));
    if (link) {
      const [whole, label, url] = link;
      flush();
      const children = parseInline(label);
      if (isAllowedHref(url)) {
        nodes.push({ t: "link", href: url.trim(), children });
      } else {
        // Rejected URL: keep the visible label text, drop the href.
        nodes.push(...children);
      }
      i += whole.length;
      continue;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-rich-text.mjs`
Expected: PASS — prints `rich-text: link tests passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/utils/richText.js tests/test-rich-text.mjs
git commit -m "feat(rich-text): links with a URL scheme allow-list"
```

---

### Task 4: Character-preservation guard test

**Files:**
- Modify: `tests/test-rich-text.mjs`

- [ ] **Step 1: Add the guard test (no implementation expected)**

Append to `tests/test-rich-text.mjs`. This asserts the parser never loses visible characters for plain prose containing brackets/asterisks that are *not* valid markup:

```js
function visibleText(blocks) {
  const walk = (nodes) =>
    nodes
      .map((n) => {
        if (n.t === "text") return n.v;
        if (n.t === "break") return "\n";
        return walk(n.children);
      })
      .join("");
  return blocks.map(walk).join("\n\n");
}

for (const sample of [
  "plain prose with no markup",
  "array[0] costs 3 * 4 shekels",
  "see (parentheses) and [brackets] alone",
  "first line\nsecond line\n\nnew paragraph",
]) {
  assert.equal(
    visibleText(parseRichText(sample)),
    sample,
    `character preservation failed for: ${sample}`,
  );
}

console.log("rich-text: character-preservation tests passed");
```

- [ ] **Step 2: Run test**

Run: `node tests/test-rich-text.mjs`
Expected: PASS — prints `rich-text: character-preservation tests passed`. (If any case fails, the parser is eating characters — fix `parseInline` so the failing input round-trips; do not change the test.)

- [ ] **Step 3: Commit**

```bash
git add tests/test-rich-text.mjs
git commit -m "test(rich-text): character-preservation round-trip guard"
```

---

### Task 5: Web `<RichText>` renderer

**Files:**
- Create: `src/components/RichText.jsx`

No automated test (the repo's node harness has no JSX/React renderer); the security-relevant rejection already lives in the parser and is unit-tested. Verified manually in Task 6.

- [ ] **Step 1: Create the component**

Create `src/components/RichText.jsx`:

```jsx
import React from "react";
import { parseRichText } from "@cycleways/core/utils/richText.js";

// Renders the rich-text AST as real React elements (never dangerouslySetInnerHTML).
// `stopLinkPropagation` is used when the surrounding element is itself clickable
// (e.g. a POI card <button>): the link navigates but does not also fire the card.
function renderInline(nodes, stopLinkPropagation) {
  return nodes.map((node, i) => {
    if (node.t === "text") return <React.Fragment key={i}>{node.v}</React.Fragment>;
    if (node.t === "break") return <br key={i} />;
    if (node.t === "bold") {
      return <strong key={i}>{renderInline(node.children, stopLinkPropagation)}</strong>;
    }
    if (node.t === "link") {
      return (
        <a
          key={i}
          href={node.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stopLinkPropagation ? (e) => e.stopPropagation() : undefined}
        >
          {renderInline(node.children, stopLinkPropagation)}
        </a>
      );
    }
    return null;
  });
}

export default function RichText({ text, className, stopLinkPropagation = false }) {
  const blocks = parseRichText(text);
  if (blocks.length === 0) return null;
  return (
    <>
      {blocks.map((block, i) => (
        <p key={i} className={className}>
          {renderInline(block, stopLinkPropagation)}
        </p>
      ))}
    </>
  );
}
```

- [ ] **Step 2: Sanity-check the build compiles**

Run: `npm run build`
Expected: build succeeds (the new module is imported by consumers in the next task; this step confirms it parses/transpiles).

- [ ] **Step 3: Commit**

```bash
git add src/components/RichText.jsx
git commit -m "feat(rich-text): web React RichText renderer"
```

---

### Task 6: Wire web POI render sites to `<RichText>`

**Files:**
- Modify: `src/components/frontPanel/PanelPoiCard.jsx:17`
- Modify: `src/components/featured/POICard.jsx:23`
- Modify: `src/components/featured/RoutePoiStoryList.jsx:108-110`
- Modify: `src/components/featured/RoutePoiGallery.jsx:125-126`

These render `poi.information` / `poi.description` as plain text today. `PanelPoiCard` and `POICard` are `<button>`s, so they pass `stopLinkPropagation`.

- [ ] **Step 1: PanelPoiCard**

In `src/components/frontPanel/PanelPoiCard.jsx`, add the import at the top:

```jsx
import RichText from "../RichText.jsx";
```

Replace line 17:

```jsx
      {poi.information && <p className="panel-poi-card__desc">{poi.information}</p>}
```

with:

```jsx
      <RichText className="panel-poi-card__desc" text={poi.information} stopLinkPropagation />
```

- [ ] **Step 2: POICard**

In `src/components/featured/POICard.jsx`, add the import:

```jsx
import RichText from "../RichText.jsx";
```

Replace line 23:

```jsx
      {poi.information && <p className="poi-card-info">{poi.information}</p>}
```

with:

```jsx
      <RichText className="poi-card-info" text={poi.information} stopLinkPropagation />
```

- [ ] **Step 3: RoutePoiStoryList (long description, not a button)**

In `src/components/featured/RoutePoiStoryList.jsx`, add the import:

```jsx
import RichText from "../RichText.jsx";
```

Replace lines 108-110:

```jsx
              {story.description && (
                <p className="fv-poi-story-description">{story.description}</p>
              )}
```

with:

```jsx
              <RichText className="fv-poi-story-description" text={story.description} />
```

- [ ] **Step 4: RoutePoiGallery (short + long, not a button)**

In `src/components/featured/RoutePoiGallery.jsx`, add the import:

```jsx
import RichText from "../RichText.jsx";
```

Replace lines 125-126:

```jsx
          {selected.information && <span>{selected.information}</span>}
          {selected.description && <p>{selected.description}</p>}
```

with:

```jsx
          <RichText text={selected.information} />
          <RichText text={selected.description} />
```

- [ ] **Step 5: Build and manually verify**

Run: `npm run build`
Expected: build succeeds.

Then run `npm run dev`, open a route/front panel with a POI whose `description` contains `**bold**` and `[a link](https://example.com)` (use the editor or temporarily edit a fixture), and confirm: bold renders, the link opens in a new tab, and clicking the link on a POI *card* does **not** also trigger the card's selection (the `stopLinkPropagation` path). Document the check in the commit body.

- [ ] **Step 6: Commit**

```bash
git add src/components/frontPanel/PanelPoiCard.jsx src/components/featured/POICard.jsx src/components/featured/RoutePoiStoryList.jsx src/components/featured/RoutePoiGallery.jsx
git commit -m "feat(rich-text): render POI descriptions via RichText on web"
```

---

### Task 7: React Native `<RichText>` renderer + wire MapScreen

**Files:**
- Create: `apps/mobile/src/RichText.jsx`
- Modify: `apps/mobile/src/MapScreen.jsx:1142-1143`

- [ ] **Step 1: Create the RN renderer**

Create `apps/mobile/src/RichText.jsx`:

```jsx
import React from "react";
import { Linking, Text } from "react-native";
import { parseRichText } from "@cycleways/core/utils/richText.js";

// React Native renderer for the shared rich-text AST. Bold and links become
// nested <Text>; a link's onPress opens the URL (and stops the touch from also
// triggering an enclosing pressable card).
function renderInline(nodes, linkStyle) {
  return nodes.map((node, i) => {
    if (node.t === "text") return <Text key={i}>{node.v}</Text>;
    if (node.t === "break") return <Text key={i}>{"\n"}</Text>;
    if (node.t === "bold") {
      return (
        <Text key={i} style={{ fontWeight: "700" }}>
          {renderInline(node.children, linkStyle)}
        </Text>
      );
    }
    if (node.t === "link") {
      return (
        <Text
          key={i}
          style={linkStyle}
          onPress={(e) => {
            e?.stopPropagation?.();
            Linking.openURL(node.href).catch(() => {});
          }}
        >
          {renderInline(node.children, linkStyle)}
        </Text>
      );
    }
    return null;
  });
}

const DEFAULT_LINK_STYLE = { color: "#1580b7", textDecorationLine: "underline" };

export default function RichText({ text, style, linkStyle = DEFAULT_LINK_STYLE }) {
  const blocks = parseRichText(text);
  if (blocks.length === 0) return null;
  return (
    <Text style={style}>
      {blocks.map((block, i) => (
        <Text key={i}>
          {i > 0 ? "\n\n" : ""}
          {renderInline(block, linkStyle)}
        </Text>
      ))}
    </Text>
  );
}
```

- [ ] **Step 2: Wire MapScreen**

In `apps/mobile/src/MapScreen.jsx`, add the import near the other local imports:

```jsx
import RichText from "./RichText.jsx";
```

Replace lines 1142-1144:

```jsx
        {marker.information ? (
          <Text style={styles.markerCardInfo}>{marker.information}</Text>
        ) : null}
```

with:

```jsx
        <RichText style={styles.markerCardInfo} text={marker.information} />
```

- [ ] **Step 3: Verify the bundle resolves**

Run: `npm run mobile -- --no-dev --max-workers 1` is heavy; instead just confirm Metro can resolve the module by starting the bundler briefly: `npm run mobile` and confirm it builds the JS bundle without a resolution error for `RichText.jsx` / `@cycleways/core/utils/richText.js`, then stop it. (If a simulator isn't available, a successful Metro bundle is sufficient evidence.)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/RichText.jsx apps/mobile/src/MapScreen.jsx
git commit -m "feat(rich-text): render POI info via RichText on mobile"
```

---

### Task 8: Editor live preview for POI descriptions

**Files:**
- Modify: `editor/editor.js` (import; `appendDataTextField` ~4756-4774; POI field calls ~5130-5148)

- [ ] **Step 1: Import the parser in the editor**

In `editor/editor.js`, near the existing core imports at the top (e.g. after the `registerPoiEmojiImages` import on line 13), add:

```js
import { parseRichText } from "../packages/core/src/utils/richText.js";
```

- [ ] **Step 2: Add a preview helper + a `preview` option to `appendDataTextField`**

In `editor/editor.js`, add this helper just above `function appendDataTextField` (line 4756):

```js
// Renders the rich-text AST into a DOM preview node (mirrors the app renderers;
// links validated by the shared parser, so no raw-HTML path here either).
function renderRichTextPreview(target, value) {
  target.replaceChildren();
  const blocks = parseRichText(value);
  const renderInline = (parent, nodes) => {
    for (const node of nodes) {
      if (node.t === "text") {
        parent.appendChild(document.createTextNode(node.v));
      } else if (node.t === "break") {
        parent.appendChild(document.createElement("br"));
      } else if (node.t === "bold") {
        const strong = document.createElement("strong");
        renderInline(strong, node.children);
        parent.appendChild(strong);
      } else if (node.t === "link") {
        const a = document.createElement("a");
        a.href = node.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        renderInline(a, node.children);
        parent.appendChild(a);
      }
    }
  };
  for (const block of blocks) {
    const p = document.createElement("p");
    renderInline(p, block);
    target.appendChild(p);
  }
  target.hidden = blocks.length === 0;
}
```

Then change the `appendDataTextField` signature/body to accept `preview` and, when set, render a preview that updates on input. Replace the function (lines 4756-4774) with:

```js
function appendDataTextField(item, { label, value = "", rows = 0, onCommit, preview = false }) {
  const fieldLabel = document.createElement("label");
  fieldLabel.className = "field-label";
  fieldLabel.textContent = label;
  item.appendChild(fieldLabel);

  const input =
    rows > 0 ? document.createElement("textarea") : document.createElement("input");
  input.className = rows > 0 ? "text-input textarea" : "text-input";
  if (rows > 0) {
    input.rows = rows;
  } else {
    input.type = "text";
  }
  input.value = value || "";
  input.addEventListener("change", () => onCommit(cleanOptionalText(input.value)));
  item.appendChild(input);

  if (preview) {
    const previewEl = document.createElement("div");
    previewEl.className = "rich-text-preview";
    item.appendChild(previewEl);
    const update = () => renderRichTextPreview(previewEl, input.value);
    input.addEventListener("input", update);
    update();
  }

  return input;
}
```

- [ ] **Step 3: Turn on preview for the two POI description fields**

In `editor/editor.js`, in the POI editor form, add `preview: true` to the "Short description" call (lines 5130-5138) and the "Long description" call (lines 5140-5148):

```js
    appendDataTextField(item, {
      label: "Short description",
      value: marker.information,
      rows: 2,
      preview: true,
      onCommit: (information) => {
        updateDataMarker(index, { information });
        renderDataList();
      },
    });

    appendDataTextField(item, {
      label: "Long description",
      value: marker.description,
      rows: 3,
      preview: true,
      onCommit: (description) => {
        updateDataMarker(index, { description });
        renderDataList();
      },
    });
```

- [ ] **Step 4: Add minimal preview styling**

In `editor/styles.css`, append:

```css
.rich-text-preview {
  margin-top: 4px;
  padding: 6px 8px;
  border: 1px dashed #c9c9c9;
  border-radius: 4px;
  background: #fafafa;
  font-size: 0.85em;
  color: #333;
}
.rich-text-preview p { margin: 0 0 4px; }
.rich-text-preview p:last-child { margin-bottom: 0; }
.rich-text-preview a { color: #1580b7; }
```

- [ ] **Step 5: Manually verify the editor preview**

Start the editor (per `editor/README.md`), open a POI, type `**bold** and [link](https://example.com)` into Short/Long description, and confirm the dashed preview box shows bold text and a clickable link. Confirm a `[x](javascript:alert(1))` shows the plain text `x` with no link.

- [ ] **Step 6: Commit**

```bash
git add editor/editor.js editor/styles.css
git commit -m "feat(rich-text): live preview under POI description fields in the editor"
```

---

## Phase 2 — Route start/end point descriptions

### Task 9: Render route start/end descriptions via RichText + editor preview

**Files:**
- Modify: `src/components/featured/routePoiStoryData.js` (start/end stories already carry `description`)
- Modify: the start/end story render site (the start/end cards render through `RoutePoiStoryList`, which Task 6 already routed through `<RichText>`) — **verify**, no code change expected.
- Modify: `editor/editor.js` (route start/end description textarea ~8806-8816)

- [ ] **Step 1: Verify the web render already covers start/end**

Confirm route start/end point descriptions reach the screen through `RoutePoiStoryList` (`story.description`), which Task 6 changed to `<RichText>`. Trace `routePoiStoryData.js` (the start/end entries set `description: content.description`) into `RoutePoiStoryList`. If start/end descriptions render through that path, no web change is needed — note it. If a separate component renders them as plain text, apply the same `<RichText text={...} />` swap there.

- [ ] **Step 2: Add the editor preview to the start/end description textarea**

In `editor/editor.js`, the route start/end form builds the description textarea manually (lines 8806-8816). After `section.appendChild(descRow);` (line 8816), add a live preview wired to the same `renderRichTextPreview` helper from Task 8:

```js
  const descPreview = document.createElement("div");
  descPreview.className = "rich-text-preview";
  descRow.appendChild(descPreview);
  const updateDescPreview = () => renderRichTextPreview(descPreview, descInput.value);
  descInput.addEventListener("input", updateDescPreview);
  updateDescPreview();
```

- [ ] **Step 3: Manually verify**

In the editor route-catalog start/end form, type markup into the description and confirm the preview renders. On the web, confirm a route page's start/end card shows bold/links in its description.

- [ ] **Step 4: Commit**

```bash
git add editor/editor.js src/components/featured/routePoiStoryData.js
git commit -m "feat(rich-text): route start/end descriptions render rich text + editor preview"
```

---

## Phase 3 — Route narrative (intro / description / notes)

### Task 10: Route narrative via RichText

**Files:**
- Modify: `src/featured/genericRouteStory.js:1-16`
- Modify: `src/components/featured/FeaturedVideoRoute.jsx:78,101` (and any other consumer of `intro.body` / `about.paragraphs`)
- Modify: `editor/editor.js` (route-catalog `intro` / `description` / `notes` textareas ~8181)

The narrative currently pre-splits strings into `string[]` (`intro.body`, `about.paragraphs`) and the template maps each to a `<p>`. Move the raw strings through `<RichText>` instead so links/bold work and paragraph splitting is handled by the parser.

- [ ] **Step 1: Pass raw narrative strings, not pre-split arrays**

In `src/featured/genericRouteStory.js`, change `createGenericRouteStoryProps` to carry the raw strings (keep `splitParagraphs` only as the fallback-resolver for which source string to use):

```js
export function createGenericRouteStoryProps(entry) {
  return {
    slug: entry.slug,
    kicker: routeKicker(entry),
    intro: {
      kicker: "מסלול מומלץ",
      heading: "מה מחכה בדרך",
      bodyText: textOrFallback(entry.intro, entry.summary) || "",
    },
    about: {
      eyebrow: "על המסלול",
      heading: entry.name,
      bodyText: entry.description || entry.summary || "",
    },
  };
}
```

(Keep `splitParagraphs` exported if other modules import it; otherwise it may be removed in a later cleanup. Verify imports of `splitParagraphs` before deleting — leave it in place if referenced.)

- [ ] **Step 2: Render narrative via RichText in the template**

In `src/components/featured/FeaturedVideoRoute.jsx`, add the import:

```jsx
import RichText from "./RichText.jsx";
```

Replace the intro body block (around line 78):

```jsx
            {(intro.body || []).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
```

with:

```jsx
            <RichText text={intro.bodyText} />
```

And replace the about paragraphs block (around lines 32 and 101). Remove the `const aboutParagraphs = ...` line (32) and replace the render (around line 101):

```jsx
            {aboutParagraphs.map((para, i) => (
              <p key={i}>{para}</p>
            ))}
```

with:

```jsx
            <RichText text={about.bodyText} />
```

(Grep for other consumers of `intro.body` / `about.paragraphs` — e.g. other featured templates — and apply the same swap so no consumer still reads the removed array props.)

- [ ] **Step 3: Turn on editor preview for narrative textareas**

In `editor/editor.js`, the route-catalog detail form (around line 8181) builds fields from a list including `intro`, `description`, `notes` (all `textarea: true`). For each textarea field, append a `renderRichTextPreview` preview under the input the same way as Task 9 Step 2. Add, inside the field-building loop right after the input is appended, guarded to textarea fields whose key is one of `intro`/`description`/`notes`:

```js
    if (f.textarea && ["intro", "description", "notes"].includes(f.key)) {
      const fieldPreview = document.createElement("div");
      fieldPreview.className = "rich-text-preview";
      row.appendChild(fieldPreview);
      const updateFieldPreview = () => renderRichTextPreview(fieldPreview, input.value);
      input.addEventListener("input", updateFieldPreview);
      updateFieldPreview();
    }
```

(Place this after `input` is created and its value/listeners are set, before the next field iteration. Adjust the parent (`row`) to match the actual variable name in that loop.)

- [ ] **Step 4: Build and manually verify**

Run: `npm run build`
Expected: build succeeds with no remaining references to the removed `intro.body` / `about.paragraphs` array props.

Open a recommended/featured route page whose `description` contains a blank-line paragraph break, `**bold**`, and a link; confirm paragraphs, bold, and link all render. Confirm the editor route-catalog preview works for intro/description/notes.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS (including `node tests/test-rich-text.mjs`). The narrative change has no automated test; coverage is the parser tests plus the manual render check above.

- [ ] **Step 6: Commit**

```bash
git add src/featured/genericRouteStory.js src/components/featured/FeaturedVideoRoute.jsx editor/editor.js
git commit -m "feat(rich-text): route narrative (intro/description/notes) renders rich text"
```

---

## Final verification

- [ ] **Run the whole suite:** `npm test` → all pass (includes `test-rich-text.mjs`).
- [ ] **Web build:** `npm run build` → succeeds.
- [ ] **Manual web check:** a POI with bold + link in short and long descriptions; a route narrative with paragraphs + link; link clicks on POI *cards* don't also select the card.
- [ ] **Manual editor check:** previews render under POI short/long, route start/end, and narrative fields; a `javascript:` URL shows as plain text.
- [ ] **Manual mobile check (if simulator available):** a POI callout with a tappable link; otherwise a clean Metro bundle is sufficient.
```
