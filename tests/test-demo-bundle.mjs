import assert from "node:assert/strict";
import {
  sanitizeDemoBundleForApp,
  stableDemoBundleDigest,
  validateDemoBundle,
  validateDemoProjectManifest,
} from "@cycleways/core/navigation/demoBundle.js";

const routeState = {
  points: [{ id: "start", lat: 33, lng: 35 }, { id: "end", lat: 33.001, lng: 35.001 }],
  geometry: [{ lat: 33, lng: 35 }, { lat: 33.001, lng: 35.001 }],
  selectedSegments: [],
  segmentSpans: [],
};
const bundle = {
  schemaVersion: 1,
  id: "demo-one",
  routeState,
  fixes: [
    { lat: 33, lng: 35, timestamp: 0, accuracy: 8, speed: 2, heading: 10 },
    { lat: 33.001, lng: 35.001, timestamp: 10_000, accuracy: 8, speed: 2, heading: 20 },
  ],
  capture: { locale: "he-IL", proof: { inMs: 1000, outMs: 9000, preRollMs: 1000 } },
  expectations: { forbiddenStatuses: ["error"], allowOffRoute: false, requireVoice: true },
  provenance: { compiledAt: "2026-01-01", sourceSha256: "abc", sourcePath: "/private/ride.mp4" },
};

assert.equal(validateDemoBundle(bundle).id, "demo-one");
assert.throws(() => validateDemoBundle({ ...bundle, schemaVersion: 2 }), /schemaVersion must be 1/);
assert.throws(() => validateDemoBundle({ ...bundle, fixes: [bundle.fixes[0], bundle.fixes[0]] }), /must be greater/);
assert.throws(() => validateDemoBundle({ ...bundle, fixes: [{ ...bundle.fixes[0], lat: 100 }, bundle.fixes[1]] }), /fixes\[0\]\.lat/);
const sanitized = sanitizeDemoBundleForApp(bundle);
assert.equal(sanitized.provenance.sourcePath, undefined);
assert.ok(!JSON.stringify(sanitized).includes("/private"));
assert.equal(
  stableDemoBundleDigest(bundle),
  stableDemoBundleDigest({ ...bundle, provenance: { ...bundle.provenance, compiledAt: "tomorrow" } }),
);
assert.match(stableDemoBundleDigest(bundle), /^[0-9a-f]{64}$/);

const manifest = validateDemoProjectManifest({
  schemaVersion: 1,
  id: "demo-one",
  source: { kind: "gopro-mp4", video: "/private/ride.mp4", csv: null, trim: { inSeconds: 0, outSeconds: 20 }, gpsOffsetSeconds: 0 },
  route: { kind: "catalog-slug", value: "route-one" },
  capture: { locale: "he-IL", appearance: "light", fontScale: 1, device: "iPhone", mapProfile: "prewarmed" },
  story: { proof: { inSeconds: 1, outSeconds: 19 }, beats: [] },
});
assert.equal(manifest.story.proof.outSeconds, 19);
assert.throws(() => validateDemoProjectManifest({ ...manifest, surprise: true }), /surprise.*not supported/);

console.log("demo bundle tests passed");
