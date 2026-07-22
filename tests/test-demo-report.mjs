import assert from "node:assert/strict";
import { redactShareableReport, reportHtml } from "../scripts/demo-studio/report.mjs";

const html = reportHtml({ publishable: false, sections: { routeFit: { pass: false, reason: "<unsafe>" } } });
assert.match(html, /Not publishable/);
assert.ok(!html.includes("<unsafe>"));
assert.match(html, /&lt;unsafe&gt;/);
const redacted = redactShareableReport({ attempts: [{ artifact: "/Users/person/ride.mp4", note: "reviewed" }], media: { raw: { format: { filename: "/private/ride.mp4" } } }, output: "/tmp/proof.mp4" });
assert.deepEqual(redacted, { attempts: [{ note: "reviewed" }], media: {} });

console.log("demo report tests passed");
