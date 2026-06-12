import assert from "node:assert/strict";
import {
  SNAPS,
  offsetsForHeight,
  resolveSnap,
  nextSnap,
} from "../src/components/frontPanel/sheetSnap.js";

// Offsets: peek leaves PEEK_PX visible, half is 50%, full leaves a top gap.
{
  const o = offsetsForHeight(800);
  assert.deepEqual(SNAPS, ["full", "half", "peek"]);
  assert.equal(o.peek, 800 - 164);
  assert.equal(o.half, 400);
  assert.equal(o.full, 12);
  assert.equal(offsetsForHeight(0).peek, 0, "degenerate height clamps to 0");
}

// resolveSnap projects the fling and picks the nearest snap offset.
{
  const o = offsetsForHeight(800); // full=12, half=400, peek=636
  assert.equal(resolveSnap(420, 0, o), "half", "released near half settles at half");
  assert.equal(resolveSnap(60, 0, o), "full");
  assert.equal(resolveSnap(650, 0, o), "peek");
  // Downward fling (positive velocity) from half lands on peek.
  assert.equal(resolveSnap(420, 1.2, o), "peek");
  // Upward fling (negative) from half lands on full.
  assert.equal(resolveSnap(420, -1.2, o), "full");
}

// nextSnap cycles peek → half → full → peek (the tap-the-handle affordance).
{
  assert.equal(nextSnap("peek"), "half");
  assert.equal(nextSnap("half"), "full");
  assert.equal(nextSnap("full"), "peek");
  assert.equal(nextSnap("bogus"), "half", "unknown states recover to half");
}

console.log("sheet snap tests passed");
