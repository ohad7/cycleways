import assert from "node:assert/strict";
import { resolveOverlayInsets } from "../src/map/routeFitPadding.js";

// A 1000x800 map at the origin.
const mapRect = { top: 0, left: 0, right: 1000, bottom: 800 };

// 1. A full-width bottom bar with an explicit side grows only `bottom`.
{
  const overlays = [
    { rect: { top: 740, left: 25, right: 975, bottom: 775 }, side: "bottom" },
  ];
  const p = resolveOverlayInsets({ mapRect, overlays, gap: 16, base: 24 });
  // intrusion from bottom edge = mapRect.bottom - rect.top = 800 - 740 = 60, + gap 16 = 76
  assert.equal(p.bottom, 76, "bottom grows by intrusion + gap");
  assert.equal(p.top, 24, "top stays at base");
  assert.equal(p.left, 24, "left stays at base");
  assert.equal(p.right, 24, "right stays at base");
}

// 2. A top-left box with no side snaps to its nearest edge (top here).
{
  const overlays = [
    { rect: { top: 10, left: 10, right: 210, bottom: 60 } },
  ];
  const p = resolveOverlayInsets({ mapRect, overlays, gap: 16, base: 24 });
  // nearest edge: top gap=10 < left gap=10? tie -> top wins (first edge). intrusion top = rect.bottom - mapRect.top = 60, + gap = 76
  assert.equal(p.top, 76, "nearest top edge grows");
  assert.equal(p.bottom, 24, "bottom stays at base");
}

// 3. A non-overlapping overlay is ignored.
{
  const overlays = [
    { rect: { top: 2000, left: 2000, right: 2100, bottom: 2100 }, side: "bottom" },
  ];
  const p = resolveOverlayInsets({ mapRect, overlays, gap: 16, base: 24 });
  assert.deepEqual(p, { top: 24, right: 24, bottom: 24, left: 24 }, "off-map overlay ignored");
}

// 4. An oversized overlay is clamped to 0.8 * map dimension.
{
  const overlays = [
    { rect: { top: 50, left: 0, right: 1000, bottom: 800 }, side: "bottom" },
  ];
  const p = resolveOverlayInsets({ mapRect, overlays, gap: 16, base: 24 });
  assert.equal(p.bottom, 640, "bottom clamped to 0.8 * 800");
}

console.log("test-route-fit-padding.mjs passed");
