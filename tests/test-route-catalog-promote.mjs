import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  promoteCatalogDraft,
  recomputeCatalogMetadata,
  validateCatalogDraft,
} from "../editor/server.mjs";

const places = [
  { id: "beit-hillel", name: "בית הלל", lat: 33.2177, lng: 35.6097 },
];
const zones = [
  { id: "hula-valley", name: "עמק החולה",
    polygon: [[35.55, 33.15], [35.65, 33.15], [35.65, 33.22], [35.55, 33.22], [35.55, 33.15]] },
];

const fakeDecode = (token) => {
  if (token === "ok") {
    return {
      geometry: [
        { lat: 33.2170, lng: 35.6090, elevation: 100 },
        { lat: 33.2180, lng: 35.6100, elevation: 102 },
        { lat: 33.2175, lng: 35.6098, elevation: 100 },
      ],
      roadTypeFractions: { paved: 0.8, dirt: 0.2, road: 0.0 },
      qualityScore: 4.0,
    };
  }
  return null;
};

const draft = {
  version: 1,
  entries: [
    {
      slug: "test-a",
      name: "A",
      summary: "x",
      route: "ok",
      featured: false,
    },
  ],
};

// recompute fills in computed fields
const recomputed = recomputeCatalogMetadata(draft, { places, zones, decodeRoute: fakeDecode });
assert.equal(recomputed.entries[0].slug, "test-a");
assert.equal(recomputed.entries[0].difficulty, "easy");
assert.ok(recomputed.entries[0].passesNear.includes("beit-hillel"));
assert.equal(
  recomputed.entries[0].placeMatches.find((match) => match.id === "beit-hillel")?.matchType,
  "radius",
);
assert.equal(recomputed.entries[0].regionId, "hula-valley");
assert.equal(recomputed.entries[0].routeShape.type, "circular");
assert.deepEqual(recomputed.entries[0].startPlaceIds, recomputed.entries[0].passesNear);
assert.equal(recomputed.entries[0].surfaceType, "paved");
validateCatalogDraft(recomputed);

let decoderSawEntry = null;
recomputeCatalogMetadata(draft, {
  places,
  zones,
  decodeRoute: (token, entry) => {
    decoderSawEntry = entry;
    return fakeDecode(token);
  },
});
assert.equal(decoderSawEntry?.slug, "test-a");

// promote writes the public file atomically and removes the draft
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rc-promote-"));
const draftPath = path.join(tmpRoot, "draft.json");
const publicPath = path.join(tmpRoot, "public.json");
await fs.writeFile(draftPath, JSON.stringify(draft));

await promoteCatalogDraft({
  draftPath,
  publicPath,
  places,
  zones,
  decodeRoute: fakeDecode,
});

const written = JSON.parse(await fs.readFile(publicPath, "utf-8"));
assert.equal(written.entries.length, 1);
assert.equal(written.entries[0].difficulty, "easy");
assert.ok(written.entries[0].placeMatches.some((match) => match.id === "beit-hillel"));
assert.equal(written.entries[0].routeShape.type, "circular");
assert.deepEqual(written.entries[0].startPlaceIds, written.entries[0].passesNear);
assert.equal(written.entries[0].surfaceType, "paved");
await assert.rejects(fs.stat(draftPath));

console.log("route catalog promote tests passed");
