// Regression test for TestFlight build 4: BuildScreen referenced the deleted
// refreshNavigationPermissionStatus callback, which release builds turn into a
// hard crash (RCTFatal: ReferenceError) the moment the screen mounts. There is
// no linter in this repo, so this test scope-checks every identifier in the
// mobile app's JS the way eslint's no-undef would: each referenced identifier
// must resolve to a binding in scope or a known runtime global.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;

const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
const mobileRoot = join(repoRoot, "apps", "mobile");
const targets = [join(mobileRoot, "App.js"), join(mobileRoot, "index.js"), join(mobileRoot, "src")];

// Globals present in the Hermes/React Native runtime that node may not report,
// plus module-system names injected by Metro.
const EXTRA_GLOBALS = new Set([
  "__DEV__",
  "global",
  "globalThis",
  "require",
  "module",
  "exports",
  "process",
  "console",
  "fetch",
  "Headers",
  "Request",
  "Response",
  "FormData",
  "XMLHttpRequest",
  "WebSocket",
  "Blob",
  "File",
  "FileReader",
  "URL",
  "URLSearchParams",
  "AbortController",
  "AbortSignal",
  "TextEncoder",
  "TextDecoder",
  "atob",
  "btoa",
  "alert",
  "navigator",
  "performance",
  "queueMicrotask",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "structuredClone",
]);
const NODE_GLOBALS = new Set(Object.getOwnPropertyNames(globalThis));

function isKnownGlobal(name) {
  return NODE_GLOBALS.has(name) || EXTRA_GLOBALS.has(name);
}

function collectFiles(path, out = []) {
  const stats = statSync(path);
  if (stats.isFile()) {
    if (/\.(js|jsx|mjs)$/.test(path)) out.push(path);
    return out;
  }
  for (const entry of readdirSync(path)) {
    if (entry === "node_modules") continue;
    collectFiles(join(path, entry), out);
  }
  return out;
}

function undefinedReferencesIn(file) {
  const source = readFileSync(file, "utf8");
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["jsx"],
  });
  const problems = [];
  traverse(ast, {
    ReferencedIdentifier(path) {
      const { name } = path.node;
      if (path.scope.hasBinding(name, /* noGlobals */ true)) return;
      if (isKnownGlobal(name)) return;
      // `typeof maybeUndefined` is a legitimate existence probe.
      if (path.parentPath?.isUnaryExpression({ operator: "typeof" })) return;
      problems.push({ name, line: path.node.loc?.start?.line });
    },
  });
  return problems;
}

let failures = 0;
for (const target of targets) {
  for (const file of collectFiles(target)) {
    for (const problem of undefinedReferencesIn(file)) {
      failures += 1;
      console.error(
        `${relative(repoRoot, file)}:${problem.line} references undefined identifier '${problem.name}'`,
      );
    }
  }
}

if (failures > 0) {
  console.error(`test-mobile-undefined-references: ${failures} undefined reference(s)`);
  process.exit(1);
}
console.log("test-mobile-undefined-references: ok");
