import assert from "node:assert/strict";
import {
  captionLines,
  escapeXml,
  mmToPixels,
  qrPrintMetrics,
  resolveDestination,
  safeFilename,
  textDirection,
} from "../marketing/sticker-studio/sticker-core.mjs";

assert.equal(mmToPixels(25.4, 300), 300);
assert.equal(mmToPixels(90, 300), 1063);

assert.equal(resolveDestination({ kind: "home" }), "https://cycleways.app/");
assert.equal(
  resolveDestination({ kind: "route", routeSlug: "/sovev-beit-hillel/" }),
  "https://cycleways.app/routes/sovev-beit-hillel",
);
assert.equal(
  resolveDestination({ kind: "custom", customUrl: "https://example.com/ride?q=1" }),
  "https://example.com/ride?q=1",
);
assert.throws(() => resolveDestination({ kind: "route", routeSlug: "" }), /route slug/i);
assert.throws(() => resolveDestination({ kind: "custom", customUrl: "http://example.com" }), /HTTPS/);

assert.deepEqual(captionLines("Ride the valley and discover the river"), ["Ride the valley and", "discover the river"]);
assert.deepEqual(captionLines("שורה ראשונה\nשורה שנייה"), ["שורה ראשונה", "שורה שנייה"]);
assert.throws(() => captionLines("one\ntwo\nthree"), /no more than 2/);

assert.equal(textDirection("מסלול חדש"), "rtl");
assert.equal(textDirection("New route"), "ltr");
assert.equal(escapeXml("A&B <ride>"), "A&amp;B &lt;ride&gt;");
assert.equal(safeFilename({ rider: "female", destinationKind: "route", caption: "Ride here!" }), "cycleways-female-route-ride-here");

assert.equal(qrPrintMetrics(33, 90).level, "good");
assert.equal(qrPrintMetrics(57, 70).level, "risky");

console.log("Sticker Studio helper tests passed.");
