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
