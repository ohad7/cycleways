#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultSegmentIds = ["62", "63", "276", "319"];
const graphSetupPhases = [
  "graphReadParse",
  "edgeFilter",
  "coordinateBounds",
  "projectionSetup",
  "spatialIndexBuild",
  "connectivityIndexBuild",
];

export function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

export function summarizeValues(values) {
  return {
    medianMs: round(percentile(values, 0.5)),
    p95Ms: round(percentile(values, 0.95)),
    minMs: round(Math.min(...values)),
    maxMs: round(Math.max(...values)),
  };
}

export function analyzeBenchmark(records) {
  if (!records.length) throw new Error("Cannot analyze an empty benchmark");

  const phaseNames = Array.from(
    new Set(records.flatMap((record) => Object.keys(record.performance?.phasesMs || {}))),
  );
  const phases = Object.fromEntries(
    phaseNames.map((phase) => [
      phase,
      summarizeValues(records.map((record) => Number(record.performance.phasesMs[phase]) || 0)),
    ]),
  );
  const wall = summarizeValues(records.map((record) => record.wallMs));
  const reusableSetup = summarizeValues(
    records.map((record) => Number(record.performance.reusableGraphSetupMs) || 0),
  );
  const measured = summarizeValues(
    records.map((record) => Number(record.performance.measuredThroughResultAssemblyMs) || 0),
  );
  const processAndOutputOverhead = summarizeValues(
    records.map((record) =>
      Math.max(
        0,
        record.wallMs - Number(record.performance.measuredThroughResultAssemblyMs || 0),
      )),
  );
  const setupShare = wall.medianMs > 0 ? reusableSetup.medianMs / wall.medianMs : 0;
  const estimatedCachedWallMs = Math.max(0, wall.medianMs - reusableSetup.medianMs);
  let strength = "weak";
  if (setupShare >= 0.5 && reusableSetup.medianMs >= 250) strength = "strong";
  else if (setupShare >= 0.25 && reusableSetup.medianMs >= 100) strength = "moderate";

  const bySegment = Object.fromEntries(
    Array.from(new Set(records.map((record) => record.segmentId))).map((segmentId) => {
      const segmentRecords = records.filter((record) => record.segmentId === segmentId);
      return [
        segmentId,
        {
          runs: segmentRecords.length,
          wall: summarizeValues(segmentRecords.map((record) => record.wallMs)),
          reusableGraphSetup: summarizeValues(
            segmentRecords.map((record) => Number(record.performance.reusableGraphSetupMs) || 0),
          ),
          segmentMatch: summarizeValues(
            segmentRecords.map((record) => Number(record.performance.phasesMs?.segmentMatch) || 0),
          ),
        },
      ];
    }),
  );

  return {
    samples: records.length,
    wall,
    measuredThroughResultAssembly: measured,
    processAndOutputOverhead,
    reusableGraphSetup: reusableSetup,
    phases,
    bySegment,
    workerCandidate: {
      strength,
      medianSetupSharePercent: round(setupShare * 100, 1),
      estimatedCachedMedianWallMs: round(estimatedCachedWallMs),
      estimatedUpperBoundSavingsPercent: round(setupShare * 100, 1),
      note:
        "The savings estimate is an upper bound. A worker still has request parsing, cache validation, IPC, and match costs.",
    },
  };
}

export function formatReport(report, context) {
  const phaseOrder = [
    "graphReadParse",
    "edgeFilter",
    "coordinateBounds",
    "projectionSetup",
    "spatialIndexBuild",
    "connectivityIndexBuild",
    "segmentReadParse",
    "segmentMatch",
    "resultAssembly",
  ];
  const lines = [
    "CycleWays single-segment matcher benchmark (read-only)",
    `Graph: ${context.graph}`,
    `Segments: ${context.segmentIds.join(", ")} · ${context.runs} measured run(s) each · ${context.warmup} warmup run(s) each`,
    "",
    `Wall time: ${formatSummary(report.wall)}`,
    `Reusable graph setup: ${formatSummary(report.reusableGraphSetup)} (${report.workerCandidate.medianSetupSharePercent}% of median wall time)`,
    `Process/output overhead: ${formatSummary(report.processAndOutputOverhead)}`,
    "",
    "Median phase times:",
  ];
  for (const phase of phaseOrder) {
    if (report.phases[phase]) {
      lines.push(`  ${phase}: ${report.phases[phase].medianMs.toFixed(1)} ms`);
    }
  }
  lines.push("", "Per segment:");
  for (const [segmentId, result] of Object.entries(report.bySegment)) {
    lines.push(
      `  #${segmentId}: wall ${result.wall.medianMs.toFixed(1)} ms · setup ${result.reusableGraphSetup.medianMs.toFixed(1)} ms · match ${result.segmentMatch.medianMs.toFixed(1)} ms`,
    );
  }
  lines.push(
    "",
    `Long-lived worker signal: ${report.workerCandidate.strength.toUpperCase()}`,
    `Estimated cached median: ${report.workerCandidate.estimatedCachedMedianWallMs.toFixed(1)} ms (upper-bound savings ${report.workerCandidate.estimatedUpperBoundSavingsPercent}%)`,
    report.workerCandidate.note,
  );
  return lines.join("\n");
}

async function runBenchmark(options) {
  const graphPath = resolve(repoRoot, options.graph);
  const sourcePath = resolve(repoRoot, options.source);
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const featuresById = new Map(
    (source.features || []).map((feature) => [String(feature.properties?.id), feature]),
  );
  const selectedFeatures = options.segmentIds.map((segmentId) => {
    const feature = featuresById.get(segmentId);
    if (!feature) throw new Error(`CycleWays segment #${segmentId} was not found in ${options.source}`);
    return feature;
  });

  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "cycleways-matcher-benchmark-"));
  const inputs = [];
  try {
    for (const feature of selectedFeatures) {
      const segmentId = String(feature.properties.id);
      const inputPath = resolve(temporaryDirectory, `segment-${safeName(segmentId)}.geojson`);
      await writeFile(inputPath, `${JSON.stringify(feature)}\n`, "utf8");
      inputs.push({ segmentId, inputPath });
    }

    const records = [];
    const totalCycles = options.warmup + options.runs;
    for (let cycle = 0; cycle < totalCycles; cycle += 1) {
      const warmup = cycle < options.warmup;
      for (const input of inputs) {
        console.error(
          `${warmup ? "Warmup" : "Measure"} ${cycle + 1}/${totalCycles}: segment #${input.segmentId}`,
        );
        const outputPath = resolve(temporaryDirectory, `result-${safeName(input.segmentId)}.json`);
        const startedAt = performance.now();
        await execFileAsync(
          options.python,
          [
            "processing/match_cycleways_to_osm_graph.py",
            "--graph-edges",
            graphPath,
            "--single-segment-geojson",
            input.inputPath,
            "--single-out-json",
            outputPath,
          ],
          { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
        );
        const wallMs = performance.now() - startedAt;
        const result = JSON.parse(await readFile(outputPath, "utf8"));
        if (!result.performance?.phasesMs) {
          throw new Error("Matcher result did not include performance timings");
        }
        if (!warmup) {
          records.push({
            segmentId: input.segmentId,
            wallMs,
            performance: result.performance,
          });
        }
      }
    }
    return analyzeBenchmark(records);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = {
    graph: "build/osm/osm-base-edges.geojson",
    source: "data/map-source.geojson",
    python: "python3",
    segmentIds: [...defaultSegmentIds],
    runs: 3,
    warmup: 1,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--graph") options.graph = requireValue(argv, ++index, argument);
    else if (argument === "--source") options.source = requireValue(argv, ++index, argument);
    else if (argument === "--python") options.python = requireValue(argv, ++index, argument);
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
  if (!options.segmentIds.length) throw new Error("--segments must contain at least one id");
  return options;
}

function printUsage() {
  console.log(`Usage: npm run osm:match:benchmark -- [options]

Runs the production single-segment matcher repeatedly using temporary inputs and
outputs. Repository files are only read.

Options:
  --segments 62,63,276,319  Representative CycleWays segment ids
  --runs 3                    Measured runs per segment
  --warmup 1                  Warmup runs per segment
  --graph PATH                Base-edge GeoJSON
  --source PATH               CycleWays source GeoJSON
  --python COMMAND            Python executable (default: python3)
  --json                      Print machine-readable JSON
  --help                      Show this help`);
}

function requireValue(argv, index, argument) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
  return value;
}

function positiveInteger(value, argument) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${argument} must be a positive integer`);
  return parsed;
}

function nonNegativeInteger(value, argument) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${argument} must be a non-negative integer`);
  return parsed;
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function formatSummary(summary) {
  return `median ${summary.medianMs.toFixed(1)} ms · p95 ${summary.p95Ms.toFixed(1)} ms`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
  } else {
    const report = await runBenchmark(options);
    const output = {
      generatedAt: new Date().toISOString(),
      graph: options.graph,
      graphFile: basename(options.graph),
      source: options.source,
      segmentIds: options.segmentIds,
      runsPerSegment: options.runs,
      warmupRunsPerSegment: options.warmup,
      ...report,
    };
    console.log(options.json ? JSON.stringify(output, null, 2) : formatReport(report, options));
  }
}
