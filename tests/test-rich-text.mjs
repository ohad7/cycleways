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
