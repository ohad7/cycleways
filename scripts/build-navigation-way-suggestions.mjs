#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourcePath = resolve(repoRoot, "plans/navigation-way-names/model-suggestions.md");
const outputPath = resolve(repoRoot, "data/navigation-way-suggestions.json");
const EVIDENCE_PATHS = [
  "data/map-source.geojson",
  "data/navigation-ways.json",
  "data/cw-base-overlay.json",
  "data/network-junctions.json",
  "build/public-data/cw-base-index.json",
  "build/public-data/network-junctions.json",
  "build/public-data/base-routing-shards/manifest.json",
];

// A suggestion row records one reviewed evidence component. These mappings
// join components that are unambiguously one public facility even when the CW
// source maps only disconnected stretches. Equal text alone is deliberately
// insufficient: informal corridors remain separate until a curator decides
// they are one facility.
const CONCEPTUAL_WAY_IDS = {
  "road-90-agmon": "road-90",
  "road-90": "road-90",
  "road-918-north": "road-918",
  "road-918-dardara": "road-918",
  "road-918-jordan": "road-918",
  "road-959-gonen": "road-959",
  "road-959-kela-alon": "road-959",
  "road-99-upper": "road-99",
  "road-99-east": "road-99",
  "cycleway-9779-north": "cycleway-9779",
  "cycleway-9779-south": "cycleway-9779",
  "cycleway-99": "cycleway-99",
  "cycleway-99-dafna": "cycleway-99",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cleanCell(value) {
  const trimmed = value.trim();
  return trimmed.startsWith("`") && trimmed.endsWith("`")
    ? trimmed.slice(1, -1)
    : trimmed;
}

function tableCells(line) {
  if (!line.trim().startsWith("|")) return null;
  return line.trim().slice(1, -1).split("|").map(cleanCell);
}

function segmentIds(value) {
  const ids = value.split(",").map((item) => Number(item.trim()));
  return ids.length > 0 && ids.every((id) => Number.isSafeInteger(id) && id > 0)
    ? ids
    : null;
}

function candidate(value) {
  return value === "—" ? null : value;
}

function parseSuggestions(markdown) {
  let section = null;
  const groups = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (line === "## Named-way proposals") section = "named-way";
    else if (line === "## Standalone named-feature proposals") section = "standalone";
    else if (line === "## Intentionally unnamed proposals") section = "unnamed";
    else if (line.startsWith("## ")) section = null;
    const cells = tableCells(line);
    if (!cells || cells.some((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    if (section === "named-way" && cells.length === 7) {
      const ids = segmentIds(cells[1]);
      if (!ids) continue;
      groups.push({
        id: `named-way:${cells[0]}`,
        role: "named-way",
        wayId: cells[0],
        segmentIds: ids,
        name: cells[2],
        audibleCandidate: candidate(cells[3]),
        kind: cells[4],
        confidence: cells[5],
        note: cells[6],
        reviewStatus: "pending",
      });
    } else if (section === "standalone" && cells.length === 7) {
      const ids = segmentIds(cells[0]);
      if (!ids) continue;
      groups.push({
        id: `standalone:${ids.join("-")}`,
        role: "standalone",
        segmentIds: ids,
        internalName: cells[1],
        name: cells[2],
        audibleCandidate: candidate(cells[3]),
        kind: cells[4],
        confidence: cells[5],
        note: cells[6],
        reviewStatus: "pending",
      });
    } else if (section === "unnamed" && cells.length === 5) {
      const ids = segmentIds(cells[0]);
      if (!ids) continue;
      groups.push({
        id: `unnamed:${ids.join("-")}`,
        role: "unnamed",
        segmentIds: ids,
        internalName: cells[1],
        kind: cells[2],
        confidence: cells[3],
        note: cells[4],
        reviewStatus: "pending",
      });
    }
  }
  return groups;
}

function weakestConfidence(values) {
  const rank = { H: 3, M: 2, L: 1 };
  return [...values].sort(
    (left, right) => (rank[left] || 0) - (rank[right] || 0),
  )[0];
}

function consolidateConceptualWays(groups) {
  const result = [];
  const consolidatedByWayId = new Map();
  for (const group of groups) {
    const conceptualWayId = group.role === "named-way"
      ? CONCEPTUAL_WAY_IDS[group.wayId]
      : null;
    if (!conceptualWayId) {
      result.push(group);
      continue;
    }
    const existing = consolidatedByWayId.get(conceptualWayId);
    if (!existing) {
      const consolidated = {
        ...group,
        id: `named-way-consolidated:${conceptualWayId}`,
        wayId: conceptualWayId,
        sourceProposalIds: [group.id],
        componentNotes: [group.note],
        conceptualWayConsolidation: true,
      };
      consolidatedByWayId.set(conceptualWayId, consolidated);
      result.push(consolidated);
      continue;
    }
    existing.segmentIds = [...new Set([
      ...existing.segmentIds,
      ...group.segmentIds,
    ])].sort((left, right) => left - right);
    existing.sourceProposalIds.push(group.id);
    existing.componentNotes.push(group.note);
    existing.confidence = weakestConfidence([
      existing.confidence,
      group.confidence,
    ]);
  }
  for (const group of consolidatedByWayId.values()) {
    if (group.sourceProposalIds.length > 1) {
      group.note =
        `Consolidated ${group.sourceProposalIds.length} mapped evidence components as one conceptual way. `
        + group.componentNotes.join(" ");
    }
  }
  return result;
}

const markdown = await readFile(sourcePath, "utf8");
const boundFiles = {};
const digestRecords = [];
for (const relativePath of EVIDENCE_PATHS) {
  const digest = sha256(await readFile(resolve(repoRoot, relativePath)));
  boundFiles[relativePath] = digest;
  digestRecords.push(`${relativePath}\0${digest}\n`);
}
const sourceGroups = parseSuggestions(markdown);
const groups = consolidateConceptualWays(sourceGroups);
const artifact = {
  schemaVersion: 1,
  generatedAt: "2026-07-23",
  sourceDocument: "plans/navigation-way-names/model-suggestions.md",
  evidenceSetDigest: `sha256:${sha256(digestRecords.join(""))}`,
  boundFiles,
  groups,
  summary: {
    groupCount: groups.length,
    sourceGroupCount: sourceGroups.length,
    segmentCount: groups.reduce((sum, group) => sum + group.segmentIds.length, 0),
    byRole: Object.fromEntries(
      ["named-way", "standalone", "unnamed"].map((role) => [
        role,
        groups.filter((group) => group.role === role).length,
      ]),
    ),
  },
};
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(
  `Wrote ${groups.length} groups covering ${artifact.summary.segmentCount} segments to ${outputPath}`,
);
