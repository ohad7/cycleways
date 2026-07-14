#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseCwOverlayV2 } from "../editor/lib/cw-overlay-v2.mjs";

const { values } = parseArgs({
  options: {
    overlay: { type: "string", default: "data/cw-base-overlay.v2.staged.json" },
    workspace: { type: "string", default: "data/cw-segment-workspace.json" },
    check: { type: "boolean", default: false },
  },
});

const blockers = [];
const stats = {
  segments: 0,
  activeNavigableSegments: 0,
  acceptedAlignments: 0,
  unavailableAlignments: 0,
  unresolvedAlignments: 0,
};

function block(code, detail) {
  blockers.push({ code, detail });
}

let overlay;
try {
  overlay = parseCwOverlayV2(
    JSON.parse(await readFile(path.resolve(values.overlay), "utf8")),
  );
} catch (error) {
  block("overlay-invalid", error instanceof Error ? error.message : String(error));
}

if (overlay) {
  for (const segment of Object.values(overlay.segments || {})) {
    stats.segments += 1;
    let accepted = 0;
    for (const alignmentKey of ["aToB", "bToA"]) {
      const published = segment.alignments?.[alignmentKey]?.published;
      if (!published) {
        stats.unresolvedAlignments += 1;
        if (segment.lifecycleStatus === "active" && segment.navigable !== false) {
          block("active-direction-unreviewed", {
            segmentId: segment.segmentId,
            alignmentKey,
          });
        }
        continue;
      }
      if (published.disposition === "accepted") {
        accepted += 1;
        stats.acceptedAlignments += 1;
        if (!published.reviewEvidence?.reviewer || !published.reviewEvidence?.reviewedAt) {
          block("accepted-alignment-missing-review-evidence", {
            segmentId: segment.segmentId,
            alignmentKey,
          });
        }
        if (!Array.isArray(published.edgeRefs) || published.edgeRefs.length === 0) {
          block("accepted-alignment-empty", {
            segmentId: segment.segmentId,
            alignmentKey,
          });
        }
      } else if (published.disposition === "unavailable") {
        stats.unavailableAlignments += 1;
      }
    }
    if (segment.lifecycleStatus === "active" && segment.navigable !== false) {
      stats.activeNavigableSegments += 1;
      if (accepted === 0) block("active-segment-has-no-accepted-alignment", segment.segmentId);
    }
  }
}

try {
  const workspace = JSON.parse(await readFile(path.resolve(values.workspace), "utf8"));
  for (const draft of Object.values(workspace.drafts || {})) {
    if (draft?.status === "active") {
      block("unfinished-segment-draft", draft.segmentId || draft.id || null);
    }
  }
} catch (error) {
  block("workspace-invalid", error instanceof Error ? error.message : String(error));
}

const report = {
  schemaVersion: 1,
  status: blockers.length === 0 ? "ready" : "blocked",
  overlay: path.resolve(values.overlay),
  stats,
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
