#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const outputIndex = process.argv.indexOf("--output-dir");
const outputDir = resolve(root, outputIndex >= 0 ? process.argv[outputIndex + 1] : "build/direction-review-bundle");
const check = process.argv.includes("--check");
const inputs = [
  "build/osm/osm-base-edges.geojson",
  "build/bicycle-traversal-policy-audit.json",
  "build/cw-base-overlay-v2.proposal.json",
  "build/cw-base-overlay-v2.migration-report.json",
  "data/cw-segment-workspace.json",
  "data/bicycle-traversal-overrides.json",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

for (const path of inputs) {
  if (!existsSync(resolve(root, path))) {
    throw new Error(
      `Direction Review prerequisite is missing: ${path}. Build the graph, policy audit, and V2 migration proposal first.`,
    );
  }
}

const localStyle = {
  version: 8,
  name: "CycleWays Direction Review Offline",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#f4f1e8" } }],
};
const files = inputs.map((path) => ({
  source: path,
  bundleName: basename(path),
  sha256: sha256(readFileSync(resolve(root, path))),
}));
const manifest = {
  schemaVersion: 1,
  purpose: "Retained offline Direction Review evidence bundle",
  files,
  localStyle: { bundleName: "offline-style.json", sha256: sha256(JSON.stringify(localStyle)) },
};
manifest.bundleDigest = sha256(JSON.stringify(manifest));

if (check) {
  const existing = JSON.parse(readFileSync(resolve(outputDir, "manifest.json"), "utf8"));
  if (JSON.stringify(existing) !== JSON.stringify(manifest)) {
    throw new Error("Direction Review bundle is stale");
  }
  for (const file of files) {
    if (sha256(readFileSync(resolve(outputDir, file.bundleName))) !== file.sha256) {
      throw new Error(`Direction Review bundle file is stale: ${file.bundleName}`);
    }
  }
} else {
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  for (const file of files) copyFileSync(resolve(root, file.source), resolve(outputDir, file.bundleName));
  writeFileSync(resolve(outputDir, "offline-style.json"), `${JSON.stringify(localStyle, null, 2)}\n`);
  writeFileSync(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(`Direction Review bundle ${manifest.bundleDigest}: ${outputDir}`);
