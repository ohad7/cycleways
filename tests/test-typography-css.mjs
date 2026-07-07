// Unit test that checks the generated typography.css contains the expected vars
// and remains in sync with the generator.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateTypographyCss } from "../scripts/generate-typography-css.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = generateTypographyCss();

assert.ok(css.startsWith("/* GENERATED"), "has do-not-edit banner");
assert.ok(css.includes(":root {") );
assert.ok(css.includes("--font-family-base: 'Assistant'"));
assert.ok(css.includes("--font-size-md: 15px;"));
assert.ok(css.includes("--font-weight-semibold: 600;"));
assert.ok(css.includes("--text-heading-size: 24px;"));
assert.ok(css.includes("--text-heading-weight: 700;"));
assert.ok(css.includes("--text-body-strong-weight: 600;"));
assert.ok(css.includes("--text-display-weight: 800;"));

const onDisk = await readFile(resolve(repoRoot, "typography.css"), "utf8");
assert.equal(onDisk, css, "typography.css is stale — run: npm run tokens");

console.log("test-typography-css: OK");
