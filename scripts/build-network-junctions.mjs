#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveNetworkJunctionCandidates,
  joinNetworkJunctionReviews,
  networkJunctionGeoJson,
  reconcileOverlayJunctionArmAttachments,
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
  registry: "data/network-junctions.json",
  out: "build/network-junctions/candidates.json",
  preview: "build/network-junctions/preview.geojson",
  report: "build/network-junctions/report.json",
};

const [graphText, roundaboutText, roundaboutReviewText, initialOverlayText, reviewText, registryText] = await Promise.all(
  [paths.graph, paths.roundabouts, paths.roundaboutReviews, paths.overlay, paths.reviews, paths.registry]
    .map((path) => readFile(resolve(root, path), "utf8")),
);
const graph = JSON.parse(graphText);
const roundaboutCandidates = JSON.parse(roundaboutText);
const roundaboutReviews = JSON.parse(roundaboutReviewText);
const curatedJunctions = JSON.parse(registryText);
const segmentArgument = process.argv.find((argument) => argument.startsWith("--segments="));
const segmentIds = segmentArgument
  ? segmentArgument.slice("--segments=".length).split(",").map(Number).filter(Number.isInteger)
  : null;
let overlay = JSON.parse(initialOverlayText);
let candidates = deriveNetworkJunctionCandidates({
  graph,
  roundaboutCandidates,
  roundaboutReviews,
  overlay,
  curatedJunctions,
});
if (process.argv.includes("--write-overlay-attachments")) {
  const reconciliation = reconcileOverlayJunctionArmAttachments(overlay, candidates, { segmentIds });
  if (reconciliation.issues.length) {
    throw new Error(
      `Cannot write junction arm attachments: ${reconciliation.issues.length} ambiguous endpoint(s)`,
    );
  }
  overlay = reconciliation.overlay;
  await writeFile(resolve(root, paths.overlay), `${JSON.stringify(overlay, null, 2)}\n`);
  candidates = deriveNetworkJunctionCandidates({
    graph,
    roundaboutCandidates,
    roundaboutReviews,
    overlay,
    curatedJunctions,
  });
  console.log(
    `Junction arm attachments: ${reconciliation.applied.length} applied, ` +
    `${reconciliation.removed.length} removed.`,
  );
}
const overlayText = `${JSON.stringify(overlay, null, 2)}\n`;
candidates.sourceDigests = {
  graph: sha(graphText),
  roundabouts: sha(roundaboutText),
  roundaboutReviews: sha(roundaboutReviewText),
  overlay: sha(overlayText),
  registry: sha(registryText),
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
