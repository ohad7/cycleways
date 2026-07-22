import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OsmSegmentMatcherWorker } from "../editor/lib/osm-segment-matcher-worker.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "cycleways-matcher-worker-test-"));
const graphPath = resolve(temporaryDirectory, "graph.geojson");
const worker = new OsmSegmentMatcherWorker({
  cwd: repoRoot,
  graphPath,
  workerScript: resolve(repoRoot, "processing/osm_segment_matcher_worker.py"),
  requestTimeoutMs: 10_000,
});

try {
  await writeFile(graphPath, JSON.stringify(graph([edge("edge-1", 0, 120)])));
  const first = await worker.match(segment(7, 10, 100));
  const second = await worker.match(segment(8, 20, 110));

  assert.equal(first.summary.segmentId, 7);
  assert.equal(second.summary.segmentId, 8);
  assert.equal(first.performance.worker.cacheHit, true);
  assert.equal(second.performance.worker.cacheHit, true);
  assert.equal(first.performance.worker.graphDigest, second.performance.worker.graphDigest);
  assert.ok(first.performance.measuredThroughResultAssemblyMs < 1000);

  const firstDigest = first.performance.worker.graphDigest;
  await writeFile(
    graphPath,
    JSON.stringify(graph([edge("edge-1", 0, 120), edge("edge-2", 120, 240)])),
  );
  const afterGraphChange = await worker.match(segment(9, 130, 220));
  assert.equal(afterGraphChange.summary.segmentId, 9);
  assert.notEqual(afterGraphChange.performance.worker.graphDigest, firstDigest);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => worker.match(segment(10, 10, 100), { signal: controller.signal }),
    (error) => error?.code === "AUTHORING_REQUEST_ABORTED",
  );
} finally {
  worker.stop();
  await rm(temporaryDirectory, { recursive: true, force: true });
}
console.log("OSM segment matcher worker ok");

function graph(features) {
  return { type: "FeatureCollection", features };
}

function edge(id, startMeters, endMeters) {
  return {
    type: "Feature",
    id,
    geometry: {
      type: "LineString",
      coordinates: [coordinate(startMeters), coordinate(endMeters)],
    },
    properties: {
      id,
      edgeId: id,
      fromNodeId: `${id}-from`,
      toNodeId: `${id}-to`,
      distanceMeters: endMeters - startMeters,
      source: "osm",
      highway: "residential",
    },
  };
}

function segment(id, startMeters, endMeters) {
  return {
    type: "Feature",
    id,
    geometry: {
      type: "LineString",
      coordinates: [coordinate(startMeters), coordinate(endMeters)],
    },
    properties: { id, name: `segment ${id}`, roadType: "road" },
  };
}

function coordinate(meters) {
  return [35 + meters / 93_000, 33];
}
