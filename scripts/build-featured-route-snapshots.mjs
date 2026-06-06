#!/usr/bin/env node
// Build (or validate) public read-only snapshots for route catalog entries.
//
//   node scripts/build-featured-route-snapshots.mjs           # generate + cleanup
//   node scripts/build-featured-route-snapshots.mjs --check    # validate, no writes
//
// Snapshots are derived public data; never hand-edit
// public-data/featured-routes/*.json. Regenerate via this builder instead.
import {
  buildFeaturedRouteSnapshots,
  checkFeaturedRouteSnapshots,
} from "./lib/featuredRouteSnapshotBuilder.mjs";

const log = (level, ...args) => {
  if (level === "error") console.error(...args);
  else if (level === "warn") console.warn(...args);
  else console.log(...args);
};

async function main() {
  const checkMode = process.argv.includes("--check");

  if (checkMode) {
    const { failures } = await checkFeaturedRouteSnapshots({ log });
    if (failures.length > 0) {
      log("error", "route snapshot check FAILED:");
      for (const failure of failures) log("error", `  - ${failure}`);
      process.exitCode = 1;
      return;
    }
    log("info", "route snapshot check OK");
    return;
  }

  const { written, removed, errors } = await buildFeaturedRouteSnapshots({ log });
  log(
    "info",
    `route snapshots: ${written.length} written, ${removed.length} removed`,
  );
  if (errors.length > 0) {
    log("error", "route snapshot generation had errors:");
    for (const { slug, error } of errors) log("error", `  - ${slug}: ${error}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
