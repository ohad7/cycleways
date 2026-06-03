import assert from "node:assert/strict";
import { vsFormatTime, vsParseTime } from "../editor/lib/vs-time.mjs";

// --- vsParseTime: plain seconds -------------------------------------------
assert.equal(vsParseTime("0"), 0);
assert.equal(vsParseTime("222.5"), 222.5);
assert.equal(vsParseTime("  12  "), 12);
assert.equal(vsParseTime(".5"), 0.5);

// --- vsParseTime: m:ss(.ss) -----------------------------------------------
assert.equal(vsParseTime("3:42"), 222);
assert.equal(vsParseTime("3:42.50"), 222.5);
assert.equal(vsParseTime("0:05"), 5);
assert.equal(vsParseTime("12:00"), 720);

// --- vsParseTime: h:mm:ss(.ss) --------------------------------------------
assert.equal(vsParseTime("1:03:42"), 3822);
assert.equal(vsParseTime("0:00:01.25"), 1.25);

// --- vsParseTime: invalid -> null -----------------------------------------
assert.equal(vsParseTime(""), null);
assert.equal(vsParseTime("   "), null);
assert.equal(vsParseTime("abc"), null);
assert.equal(vsParseTime("3:"), null);
assert.equal(vsParseTime(":30"), null);
assert.equal(vsParseTime("-5"), null);
assert.equal(vsParseTime("1:2:3:4"), null);
assert.equal(vsParseTime("3:75"), null, "seconds field must be < 60");
assert.equal(vsParseTime("1:80:00"), null, "minutes field must be < 60");
assert.equal(vsParseTime(null), null);
assert.equal(vsParseTime(42), null, "non-string input rejected");

// --- vsFormatTime ----------------------------------------------------------
assert.equal(vsFormatTime(0), "0:00.00");
assert.equal(vsFormatTime(5), "0:05.00");
assert.equal(vsFormatTime(222.5), "3:42.50");
assert.equal(vsFormatTime(3822), "1:03:42.00");
assert.equal(vsFormatTime(-3), "0:00.00", "negative clamps to zero");

// --- round-trip ------------------------------------------------------------
for (const x of [0, 5, 42.25, 222.5, 720, 3822.75]) {
  const round = vsParseTime(vsFormatTime(x));
  assert.ok(Math.abs(round - x) < 0.005, `round-trip ${x} -> ${round}`);
}

console.log("test-vs-time: all assertions passed");
