// tests/test-track-tools.mjs
import assert from "node:assert/strict";
import {
  applyGpsGap,
  cumulativeFixMeters,
  insertDwell,
} from "@cycleways/core/navigation/trackTools.js";

// Straight west→east track along lat 33.1, one fix every ~10 m, 1 s apart.
function tenMeterTrack(count = 12) {
  const fixes = [];
  for (let i = 0; i < count; i++) {
    fixes.push({
      lat: 33.1,
      lng: 35.6 + (i * 10) / (111320 * Math.cos((33.1 * Math.PI) / 180)),
      accuracy: 5,
      speed: 10,
      timestamp: i * 1000,
    });
  }
  return fixes;
}

// cumulativeFixMeters: monotonic, ~10 m steps.
{
  const meters = cumulativeFixMeters(tenMeterTrack());
  assert.equal(meters[0], 0);
  assert.ok(Math.abs(meters[1] - 10) < 0.5, `step ~10m, got ${meters[1]}`);
  assert.ok(Math.abs(meters[11] - 110) < 2, `total ~110m, got ${meters[11]}`);
}

// applyGpsGap drops fixes inside [start, end) but keeps timestamps intact,
// producing a timestamp jump (GPS signal loss).
{
  const fixes = applyGpsGap(tenMeterTrack(), { startMeters: 30, endMeters: 60 });
  assert.equal(fixes.length, 9, "3 fixes dropped (at ~30, ~40, ~50 m)");
  const jumpIndex = fixes.findIndex(
    (f, i) => i > 0 && f.timestamp - fixes[i - 1].timestamp > 1000,
  );
  assert.ok(jumpIndex > 0, "a timestamp jump exists");
  assert.equal(fixes[jumpIndex].timestamp - fixes[jumpIndex - 1].timestamp, 4000);
  assert.throws(() => applyGpsGap(tenMeterTrack(), { startMeters: 60, endMeters: 30 }));
}

// insertDwell inserts stationary zero-speed fixes and shifts later timestamps.
{
  const original = tenMeterTrack();
  const fixes = insertDwell(original, {
    atMeters: 50,
    durationMs: 5000,
    intervalMs: 1000,
    jitterM: 3,
    seed: 2,
  });
  assert.equal(fixes.length, original.length + 5, "5 dwell fixes inserted");
  const dwell = fixes.filter((f) => f.speed === 0);
  assert.equal(dwell.length, 5, "dwell fixes have speed 0");
  const anchor = original[5]; // first fix at/after 50 m
  for (const f of dwell) {
    const latM = Math.abs(f.lat - anchor.lat) * 111320;
    assert.ok(latM < 10, "dwell jitter stays near the anchor");
  }
  assert.equal(
    fixes[fixes.length - 1].timestamp,
    original[original.length - 1].timestamp + 5000,
    "later fixes shifted by the dwell duration",
  );
  // Determinism: same seed, same output.
  assert.deepEqual(
    insertDwell(original, { atMeters: 50, durationMs: 5000, seed: 2 }),
    insertDwell(original, { atMeters: 50, durationMs: 5000, seed: 2 }),
  );
  assert.throws(() => insertDwell(original, { atMeters: 99999, durationMs: 5000 }));
}

console.log("track tools tests passed");
