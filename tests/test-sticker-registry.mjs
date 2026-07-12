import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  addVerification,
  assignDesign,
  createLocation,
  createPlacement,
  createReplacement,
  dashboardStats,
  emptyRegistry,
  fieldPackCsv,
  placementGeoJson,
  publicRedirectsFromRegistry,
  recordScan,
  resolveShortCode,
  transitionPlacement,
  upsertDesignVersion,
  validateRegistry,
  verificationState,
} from "../marketing/sticker-studio/registry-core.mjs";
import { createRegistryStore } from "../marketing/sticker-studio/registry-store.mjs";

const now = "2026-07-11T10:00:00.000Z";
const registry = emptyRegistry(now);
const location = createLocation(registry, {
  id: "loc-trailhead-1",
  name: "North trailhead",
  campaignId: "campaign-general",
  type: "trailhead",
  coordinates: [35.61, 33.18],
  permissionStatus: "approved",
  priority: "high",
}, { now });
const placement = createPlacement(registry, {
  id: "plc-trailhead-1",
  locationId: location.id,
  qrMode: "placement",
  targetUrl: "https://cycleways.app/routes/sovev-beit-hillel",
}, { now, random: () => 0.1 });
assert.equal(placement.status, "planned");
assert.match(placement.qr.shortCode, /^[A-Z2-9]{6}$/);
assert.match(placement.qr.encodedUrl, /\/s\//);

const design = upsertDesignVersion(registry, {
  rider: "adult-woman",
  caption: "Ride here",
  sizeMm: 90,
  dpi: 300,
  includeQr: true,
  destination: placement.qr.encodedUrl,
});
assert.equal(upsertDesignVersion(registry, design.configuration).id, design.id);
assignDesign(registry, placement.id, design.id, "2026-07-11T10:10:00.000Z");
assert.equal(placement.status, "assigned");

transitionPlacement(registry, placement.id, "placed", {
  actualCoordinates: [35.6101, 33.1801],
  installer: "Ohad",
}, { now: "2026-07-11T11:00:00.000Z" });
assert.equal(placement.status, "placed");
assert.equal(verificationState(registry, placement, new Date("2026-07-12")), "unverified");

addVerification(registry, placement.id, {
  checker: "Ohad",
  condition: "good",
  adhesion: "pass",
  qrResult: "passed",
  observedDestination: "https://cycleways.app/routes/sovev-beit-hillel",
}, { now: "2026-07-12T11:00:00.000Z", random: () => 0.2 });
assert.equal(verificationState(registry, placement, new Date("2026-07-13")), "verified");
assert.equal(verificationState(registry, placement, new Date("2027-01-01")), "overdue");

const replacement = createReplacement(registry, placement.id, { actor: "Ohad" }, { now: "2026-08-01T10:00:00.000Z", random: () => 0.3 });
assert.equal(placement.status, "removed");
assert.equal(replacement.replacesPlacementId, placement.id);
assert.equal(placement.replacedByPlacementId, replacement.id);

validateRegistry(registry);
assert.equal(placementGeoJson(registry).features.length, 1);
assert.equal(dashboardStats(registry).planned, 1);
assert.match(fieldPackCsv(registry), /North trailhead/);
const redirects = publicRedirectsFromRegistry(registry, now);
assert.equal(resolveShortCode(redirects, placement.qr.shortCode).targetUrl, placement.qr.targetUrl);
assert.ok(!JSON.stringify(redirects).includes("North trailhead"));
assert.ok(!JSON.stringify(redirects).includes("35.61"));
recordScan(registry, placement.qr.shortCode, "2026-08-02T10:00:00.000Z");
assert.equal(placement.scanCount, 1);
assert.equal(dashboardStats(registry).scans, 1);

const denied = createLocation(registry, {
  id: "loc-denied-1",
  name: "Denied board",
  campaignId: "campaign-general",
  type: "community-board",
  coordinates: [35.62, 33.19],
  permissionStatus: "denied",
}, { now });
assert.throws(() => createPlacement(registry, { locationId: denied.id, qrMode: "none" }, { now }), /Denied/);

const temp = await mkdtemp(join(tmpdir(), "cycleways-stickers-"));
try {
  const store = createRegistryStore({
    registryPath: join(temp, "registry.json"),
    redirectsPath: join(temp, "redirects.json"),
    photosDir: join(temp, "photos"),
  });
  const initial = await store.load();
  assert.equal(initial.revision, 0);
  initial.campaigns[0].objective = "Updated";
  const saved = await store.save(initial, 0);
  assert.equal(saved.revision, 1);
  await assert.rejects(() => store.save(saved, 0), /changed from revision/);
  const publicFile = JSON.parse(await readFile(join(temp, "redirects.json"), "utf8"));
  assert.deepEqual(publicFile.redirects, {});
  const pixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const photo = await store.savePhoto({ placementId: "plc-photo-test", filename: "field.png", dataUrl: pixelPng });
  assert.match(photo.full, /plc-photo-test\/.*\.webp$/);
  assert.ok((await readFile(join(temp, photo.full.replace("/marketing/sticker-data/photos/", "photos/")))).length > 0);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("Sticker registry tests passed.");
