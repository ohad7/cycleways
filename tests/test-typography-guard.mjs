// Keep the typography sweep from regressing.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const jsFiles = [
  ...walk(resolve(repoRoot, "apps/mobile/src")),
  resolve(repoRoot, "apps/mobile/App.js"),
  ...walk(resolve(repoRoot, "src")),
].filter((p) => !p.endsWith(join("theme", "typography.js")));

const failures = [];

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

for (const file of jsFiles) {
  const src = await readFile(file, "utf8");
  src.split("\n").forEach((line, i) => {
    if (/fontSize\s*:\s*["']?[\d.]/.test(line) || /fontWeight\s*:\s*["']?(\d|bold)/.test(line)) {
      failures.push(`${relative(repoRoot, file)}:${i + 1}: ${line.trim()}`);
    }
  });
}

assert.deepEqual(failures, [], `literal font styles found:\n${failures.join("\n")}`);

console.log(`test-typography-guard: OK (${webCssFiles.length} css + ${jsFiles.length} js files clean)`);
