#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveNetworkJunctionCandidates,
  joinNetworkJunctionReviews,
  networkJunctionGeoJson,
} from "../editor/lib/networkJunctions.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const sha = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const paths = {
  graph: process.env.CW_JUNCTION_GRAPH || "build/osm/osm-base-graph.json",
  roundabouts: "build/osm/roundabout-candidates.json",
  roundaboutReviews: "data/roundabout-review.json",
  overlay: process.env.CW_JUNCTION_OVERLAY || "data/cw-base-overlay.v2.staged.json",
  reviews: "data/network-junction-review.json",
  out: "build/network-junctions/candidates.json",
  preview: "build/network-junctions/preview.geojson",
  report: "build/network-junctions/report.json",
};

const [graphText, roundaboutText, roundaboutReviewText, overlayText, reviewText] = await Promise.all(
  [paths.graph, paths.roundabouts, paths.roundaboutReviews, paths.overlay, paths.reviews]
    .map((path) => readFile(resolve(root, path), "utf8")),
);
const graph = JSON.parse(graphText);
const candidates = deriveNetworkJunctionCandidates({
  graph,
  roundaboutCandidates: JSON.parse(roundaboutText),
  roundaboutReviews: JSON.parse(roundaboutReviewText),
  overlay: JSON.parse(overlayText),
});
candidates.sourceDigests = {
  graph: sha(graphText),
  roundabouts: sha(roundaboutText),
  roundaboutReviews: sha(roundaboutReviewText),
  overlay: sha(overlayText),
};
const joined = joinNetworkJunctionReviews(candidates, JSON.parse(reviewText));
const preview = networkJunctionGeoJson(joined, graph);
const report = {
  schemaVersion: 1,
  generatedAt: candidates.generatedAt,
  summary: { ...candidates.summary, ...joined.summary },
  blockingIssues: joined.blockingIssues,
  orphanedReviews: joined.orphaned,
};
for (const path of [paths.out, paths.preview, paths.report]) {
  await mkdir(dirname(resolve(root, path)), { recursive: true });
}
await writeFile(resolve(root, paths.out), `${JSON.stringify(candidates, null, 2)}\n`);
await writeFile(resolve(root, paths.preview), `${JSON.stringify(preview, null, 2)}\n`);
await writeFile(resolve(root, paths.report), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `Network junctions: ${candidates.summary.relevantJunctions} relevant, ` +
  `${candidates.summary.movements} movements, ${candidates.summary.unavailableMovements} unavailable.`,
);

