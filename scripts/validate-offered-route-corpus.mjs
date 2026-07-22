#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { loadRouteStateForSlug, invalidateFeaturedAssetCache } from "./lib/featuredRouteSnapshotBuilder.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const { values } = parseArgs({
  options: {
    root: { type: "string", default: "build/public-data" },
    catalog: { type: "string" },
    corpus: { type: "string", default: "data/offered-route-corpus.json" },
    "migration-report": { type: "string" },
    check: { type: "boolean", default: false },
  },
});

const root = path.resolve(values.root);
const blockers = [];
const results = [];
function block(code, detail) {
  blockers.push({ code, detail });
}

let manifest;
let shardManifest;
let corpus;
let migrationReport = null;
try {
  manifest = JSON.parse(await readFile(path.join(root, "map-manifest.json"), "utf8"));
  shardManifest = JSON.parse(
    await readFile(path.join(root, manifest.baseRoutingShards), "utf8"),
  );
  corpus = JSON.parse(await readFile(path.resolve(values.corpus), "utf8"));
  if (values["migration-report"]) {
    migrationReport = JSON.parse(
      await readFile(path.resolve(values["migration-report"]), "utf8"),
    );
  }
} catch (error) {
  block("corpus-input-load-failed", error instanceof Error ? error.message : String(error));
}

let catalogPath = values.catalog ? path.resolve(values.catalog) : null;
if (!catalogPath) {
  const draftPath = path.join(repoRoot, "editor/.drafts/route-catalog.json");
  try {
    await readFile(draftPath);
    catalogPath = draftPath;
  } catch {
    catalogPath = manifest?.routeCatalog
      ? path.join(root, manifest.routeCatalog)
      : path.join(repoRoot, "public-data/route-catalog.json");
  }
}

if (manifest && shardManifest && corpus) {
  if (
    Number(shardManifest.sourceRoutingSchemaVersion) !== 3 ||
    shardManifest.routingContract?.strictTraversalPolicy !== true
  ) {
    block("routing-release-not-strict-v3", shardManifest.sourceRoutingSchemaVersion);
  } else {
    invalidateFeaturedAssetCache();
    const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
    const bySlug = new Map((catalog.entries || []).map((entry) => [entry.slug, entry]));
    const migrationBySlug = new Map(
      (migrationReport?.routes || []).map((route) => [route.slug, route]),
    );
    const expectedBySlug = new Map((corpus.entries || []).map((entry) => [entry.slug, entry]));
    for (const slug of bySlug.keys()) {
      if (!expectedBySlug.has(slug)) block("catalog-route-missing-from-corpus", slug);
    }
    for (const expected of corpus.entries || []) {
      if (!bySlug.has(expected.slug)) {
        block("corpus-route-missing-from-catalog", expected.slug);
        continue;
      }
      try {
        const { routeState } = await loadRouteStateForSlug(expected.slug, {
          routeCatalogPath: catalogPath,
          publicDataRoot: root,
          manifest,
          allowSnapshotFallback: false,
          log: () => {},
        });
        const fingerprint = routeState?.routingValidation?.contentFingerprint || null;
        const migrated = migrationBySlug.get(expected.slug);
        const acceptsSafeMigration = Boolean(
          migrated?.automaticPromotionSafe === true &&
          migrated?.exactCurrentPolicy === true &&
          migrated?.currentFingerprint === fingerprint &&
          migrated?.currentToken === bySlug.get(expected.slug)?.route
        );
        const result = {
          slug: expected.slug,
          fingerprint,
          distanceMeters: Number(routeState?.distance) || 0,
          requiresReview: routeState?.requiresReview === true,
          routeFailure: routeState?.routeFailure || null,
          fingerprintDisposition:
            expected.acceptedFingerprint === fingerprint
              ? "accepted"
              : acceptsSafeMigration
                ? "safe-current-graph-migration"
                : "changed",
        };
        results.push(result);
        if (!routeState || result.routeFailure || result.requiresReview || !fingerprint) {
          block("offered-route-not-exact-current-policy", result);
        }
        if (!expected.acceptedFingerprint) {
          block("offered-route-fingerprint-unaccepted", expected.slug);
        } else if (expected.acceptedFingerprint !== fingerprint && !acceptsSafeMigration) {
          block("offered-route-fingerprint-changed", {
            slug: expected.slug,
            expected: expected.acceptedFingerprint,
            actual: fingerprint,
          });
        }
        if (Number.isFinite(expected.distanceMeters)) {
          const tolerance = Number(expected.distanceToleranceMeters) || 1;
          if (Math.abs(result.distanceMeters - expected.distanceMeters) > tolerance) {
            block("offered-route-distance-changed", {
              slug: expected.slug,
              expected: expected.distanceMeters,
              actual: result.distanceMeters,
              tolerance,
            });
          }
        }
      } catch (error) {
        block("offered-route-decode-failed", {
          slug: expected.slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

const report = {
  schemaVersion: 1,
  status: blockers.length === 0 ? "ready" : "blocked",
  root,
  catalog: catalogPath,
  corpus: path.resolve(values.corpus),
  results,
  blockerCount: blockers.length,
  blockerCounts: Object.fromEntries(
    [...new Set(blockers.map(({ code }) => code))]
      .sort()
      .map((code) => [code, blockers.filter((item) => item.code === code).length]),
  ),
  blockerSamples: blockers.slice(0, 100),
};
console.log(JSON.stringify(report, null, 2));
if (values.check && blockers.length > 0) process.exitCode = 1;
