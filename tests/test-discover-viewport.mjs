import assert from "node:assert/strict";
import { deriveViewportSets } from "../src/components/frontPanel/discoverViewport.js";

const order = ["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"];

// Mid-list block: bright = intersecting, ghost = one each side, prefetch widens.
{
  const sets = deriveViewportSets(order, new Set(["r4", "r5"]));
  assert.deepEqual(sets.visibleSlugs, ["r4", "r5"]);
  assert.deepEqual(sets.ghostSlugs, ["r3", "r6"]);
  assert.deepEqual(sets.prefetchSlugs, ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"]);
}

// Top of list: no ghost above; prefetch clamps at index 0.
{
  const sets = deriveViewportSets(order, new Set(["r0", "r1"]));
  assert.deepEqual(sets.visibleSlugs, ["r0", "r1"]);
  assert.deepEqual(sets.ghostSlugs, ["r2"]);
  assert.deepEqual(sets.prefetchSlugs, ["r0", "r1", "r2", "r3", "r4"]);
}

// Bottom of list: no ghost below; prefetch clamps at the last index.
{
  const sets = deriveViewportSets(order, new Set(["r8", "r9"]));
  assert.deepEqual(sets.visibleSlugs, ["r8", "r9"]);
  assert.deepEqual(sets.ghostSlugs, ["r7"]);
  assert.deepEqual(sets.prefetchSlugs, ["r5", "r6", "r7", "r8", "r9"]);
}

// Nothing intersecting → all empty.
{
  const sets = deriveViewportSets(order, new Set());
  assert.deepEqual(sets, { visibleSlugs: [], ghostSlugs: [], prefetchSlugs: [] });
}

// Accepts an array (not just a Set) for the intersecting arg.
{
  const sets = deriveViewportSets(order, ["r4", "r5"]);
  assert.deepEqual(sets.visibleSlugs, ["r4", "r5"]);
}

// Defensive: non-array ordered list → all empty.
{
  const sets = deriveViewportSets(null, new Set(["r4"]));
  assert.deepEqual(sets, { visibleSlugs: [], ghostSlugs: [], prefetchSlugs: [] });
}

console.log("discover-viewport ok");
