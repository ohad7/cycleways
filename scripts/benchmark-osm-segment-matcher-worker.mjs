#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { OsmSegmentMatcherWorker } from "../editor/lib/osm-segment-matcher-worker.mjs";
import { summarizeValues } from "./benchmark-osm-segment-matcher.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const options = parseArgs(process.argv.slice(2));
const source = JSON.parse(await readFile(resolve(repoRoot, options.source), "utf8"));
const byId = new Map(
  (source.features || []).map((feature) => [String(feature.properties?.id), feature]),
);
const features = options.segmentIds.map((segmentId) => {
  const feature = byId.get(segmentId);
  if (!feature) throw new Error(`Segment #${segmentId} was not found`);
  return feature;
});
const worker = new OsmSegmentMatcherWorker({
  cwd: repoRoot,
  graphPath: resolve(repoRoot, options.graph),
  workerScript: resolve(repoRoot, "processing/osm_segment_matcher_worker.py"),
  requestTimeoutMs: 60_000,
});

try {
  const warmStartedAt = performance.now();
  const runtime = await worker.warm();
  const warmWallMs = performance.now() - warmStartedAt;
  const records = [];
  const totalCycles = options.warmup + options.runs;
  for (let cycle = 0; cycle < totalCycles; cycle += 1) {
    const warmup = cycle < options.warmup;
    for (const feature of features) {
      const startedAt = performance.now();
      const result = await worker.match(feature);
      const wallMs = performance.now() - startedAt;
      if (!warmup) {
        records.push({
          segmentId: String(feature.properties.id),
          wallMs,
          matchMs: Number(result.performance?.phasesMs?.segmentMatch || 0),
          cacheHit: result.performance?.worker?.cacheHit === true,
          responseFeatures: result.preview?.features?.length || 0,
        });
      }
    }
  }

  const report = {
    graph: options.graph,
    segments: options.segmentIds,
    runsPerSegment: options.runs,
    startup: {
      wallMs: round(warmWallMs),
      workerMs: runtime.setupPerformance?.totalMs ?? null,
      graphDigest: runtime.graphDigest,
    },
    requestWall: summarizeValues(records.map((record) => record.wallMs)),
    segmentMatch: summarizeValues(records.map((record) => record.matchMs)),
    cacheHits: records.filter((record) => record.cacheHit).length,
    samples: records.length,
    bySegment: Object.fromEntries(
      options.segmentIds.map((segmentId) => {
        const selected = records.filter((record) => record.segmentId === segmentId);
        return [
          segmentId,
          {
            wall: summarizeValues(selected.map((record) => record.wallMs)),
            match: summarizeValues(selected.map((record) => record.matchMs)),
            responseFeatures: selected[0]?.responseFeatures || 0,
          },
        ];
      }),
    ),
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("CycleWays persistent single-segment matcher benchmark (read-only)");
    console.log(`Graph: ${report.graph}`);
    console.log(
      `Worker startup: ${report.startup.wallMs.toFixed(1)} ms wall · ${Number(
        report.startup.workerMs || 0,
      ).toFixed(1)} ms worker`,
    );
    console.log(
      `Warm request wall: median ${report.requestWall.medianMs.toFixed(1)} ms · p95 ${report.requestWall.p95Ms.toFixed(1)} ms`,
    );
    console.log(
      `Actual match: median ${report.segmentMatch.medianMs.toFixed(1)} ms · p95 ${report.segmentMatch.p95Ms.toFixed(1)} ms`,
    );
    console.log(`Cache hits: ${report.cacheHits}/${report.samples}`);
    for (const [segmentId, result] of Object.entries(report.bySegment)) {
      console.log(
        `  #${segmentId}: wall ${result.wall.medianMs.toFixed(1)} ms · match ${result.match.medianMs.toFixed(1)} ms · ${result.responseFeatures} preview features`,
      );
    }
  }
} finally {
  worker.stop();
}
function parseArgs(argv) {
  const options = {
    graph: "build/osm/osm-base-edges.geojson",
    source: "data/map-source.geojson",
    segmentIds: ["62", "63", "276", "319"],
    runs: 3,
    warmup: 1,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--graph") options.graph = requireValue(argv, ++index, argument);
    else if (argument === "--source") options.source = requireValue(argv, ++index, argument);
    else if (argument === "--segments") {
      options.segmentIds = requireValue(argv, ++index, argument)
        .split(",")
        .map((value) => value.trim().replace(/^#/, ""))
        .filter(Boolean);
    } else if (argument === "--runs") {
      options.runs = positiveInteger(requireValue(argv, ++index, argument), argument);
    } else if (argument === "--warmup") {
      options.warmup = nonNegativeInteger(requireValue(argv, ++index, argument), argument);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function requireValue(argv, index, argument) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
  return value;
}

function positiveInteger(value, argument) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${argument} must be positive`);
  return parsed;
}

function nonNegativeInteger(value, argument) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${argument} must be non-negative`);
  return parsed;
}

function round(value) {
  return Math.round(value * 10) / 10;
}
