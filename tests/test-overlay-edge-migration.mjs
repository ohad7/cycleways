import assert from "node:assert/strict";
import { migrateOverlayEdgeReplacement } from "../editor/lib/overlay-edge-migration.mjs";

const acceptedMapping = (edgeRefs, overrides = {}) => ({
  segmentId: 27,
  segmentName: "Historical Jordan",
  status: "accepted_auto_match",
  edgeRefs,
  ...overrides,
});

// Copying an OSM edge to an identical manual edge preserves direction and fractions.
{
  const overlay = {
    schemaVersion: 1,
    segments: {
      "27": acceptedMapping([
        { edgeId: "before", source: "osm", direction: "forward", sequenceIndex: 0, fromFraction: 0, toFraction: 1 },
        { edgeId: "osm-2", source: "osm", direction: "reverse", sequenceIndex: 1, fromFraction: 0.2, toFraction: 0.8, osmWayId: 42 },
      ]),
    },
  };
  const result = migrateOverlayEdgeReplacement(
    overlay,
    "osm-2",
    [{ edgeId: "manual-2", source: "manual", manualEdgeId: "manual-2" }],
    { updatedAt: "2026-07-10T20:00:00.000Z" },
  );
  assert.deepEqual(result.migratedSegmentIds, [27]);
  assert.deepEqual(result.overlay.segments["27"].edgeRefs[1], {
    edgeId: "manual-2",
    source: "manual",
    manualEdgeId: "manual-2",
    direction: "reverse",
    sequenceIndex: 1,
    fromFraction: 0.2,
    toFraction: 0.8,
  });
}

// A forward whole-edge ref expands to children in geometric order.
{
  const overlay = { segments: { "27": acceptedMapping([
    { edgeId: "parent", source: "manual", direction: "forward", sequenceIndex: 0, fromFraction: 0, toFraction: 1 },
    { edgeId: "after", source: "osm", direction: "forward", sequenceIndex: 1, fromFraction: 0, toFraction: 1 },
  ]) } };
  const result = migrateOverlayEdgeReplacement(overlay, "parent", [
    { edgeId: "child-a", source: "manual", manualEdgeId: "child-a" },
    { edgeId: "child-b", source: "manual", manualEdgeId: "child-b" },
  ]);
  assert.deepEqual(result.overlay.segments["27"].edgeRefs.map((ref) => [ref.edgeId, ref.direction, ref.sequenceIndex]), [
    ["child-a", "forward", 0],
    ["child-b", "forward", 1],
    ["after", "forward", 2],
  ]);
}

// A reverse ref expands in reverse child order and keeps reverse orientation.
{
  const overlay = { segments: { "27": acceptedMapping([
    { edgeId: "parent", direction: "reverse", sequenceIndex: 0, fromFraction: 0, toFraction: 1 },
  ]) } };
  const result = migrateOverlayEdgeReplacement(overlay, "parent", [
    { edgeId: "child-a", manualEdgeId: "child-a" },
    { edgeId: "child-b", manualEdgeId: "child-b" },
  ]);
  assert.deepEqual(result.overlay.segments["27"].edgeRefs.map((ref) => [ref.edgeId, ref.direction]), [
    ["child-b", "reverse"],
    ["child-a", "reverse"],
  ]);
}

// Partial refs cannot safely expand across a split, so accepted mappings are invalidated.
{
  const mapping = acceptedMapping([
    { edgeId: "parent", direction: "forward", sequenceIndex: 0, fromFraction: 0.25, toFraction: 1 },
  ]);
  const overlay = { segments: { "27": mapping } };
  const result = migrateOverlayEdgeReplacement(overlay, "parent", [
    { edgeId: "child-a" },
    { edgeId: "child-b" },
  ]);
  assert.deepEqual(result.invalidatedSegmentIds, [27]);
  assert.equal(result.overlay.segments["27"].status, "needs_edit");
  assert.equal(result.overlay.segments["27"].failureClass, "base_edge_replaced");
  assert.deepEqual(result.overlay.segments["27"].edgeRefs, mapping.edgeRefs);
}

// Unaffected mappings and the original overlay object remain untouched.
{
  const overlay = { segments: { "9": acceptedMapping([
    { edgeId: "other", direction: "forward", sequenceIndex: 0, fromFraction: 0, toFraction: 1 },
  ], { segmentId: 9 }) } };
  const result = migrateOverlayEdgeReplacement(overlay, "parent", [{ edgeId: "child" }]);
  assert.equal(result.overlay, overlay);
  assert.deepEqual(result.migratedSegmentIds, []);
}

console.log("overlay edge migration ok");
