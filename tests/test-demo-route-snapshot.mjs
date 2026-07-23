import assert from "node:assert/strict";
import {
  buildNavigationRouteSnapshot,
  routeSnapshotDigest,
} from "../scripts/lib/navigation-route-snapshot.mjs";
import { navigationRouteFromRouteState } from "../packages/core/src/navigation/navigationRoute.js";
import { buildRouteCues } from "../packages/core/src/navigation/navigationCues.js";
import { createNavigationVoicePlanner } from "../packages/core/src/navigation/navigationVoice.js";
import { validateRouteAttestation } from "../packages/core/src/routing/routeAttestation.js";

const first = { geometry: [{ lat: 33, lng: 35 }, { lat: 34, lng: 36 }], points: [], selectedSegments: [], segmentSpans: [] };
const reordered = { selectedSegments: [], points: [], segmentSpans: [], geometry: [{ lng: 35, lat: 33 }, { lng: 36, lat: 34 }] };
assert.equal(routeSnapshotDigest(first), routeSnapshotDigest(reordered));
assert.notEqual(routeSnapshotDigest(first), routeSnapshotDigest({ ...first, geometry: [{ lat: 33, lng: 35 }, { lat: 34.1, lng: 36 }] }));

const ganHatzafon = await buildNavigationRouteSnapshot({
  catalogSlug: "banias-gan-hatsafon",
});
assert.deepEqual(
  validateRouteAttestation(ganHatzafon.routingValidation, {
    geometry: ganHatzafon.geometry,
  }),
  { ok: true, reason: null },
  "the rounded Studio snapshot keeps valid real route evidence",
);
assert.ok(
  ganHatzafon.routingValidation.traversalSlices.some(
    (slice) => Number(slice.edgeShareId) === 31095,
  ),
  "the Studio snapshot must not replace the route with a synthetic edge",
);

const crossing = ganHatzafon.crossings.find(
  (item) => item.crossingId === "manual-crossing-adced33762581564",
);
assert.ok(crossing, "the Nahal Snir road crossing is preserved in the Studio snapshot");
assert.equal(crossing.crossedRoadName, "מעבר על כביש שמורת נחל שניר");

const navigationRoute = navigationRouteFromRouteState(ganHatzafon, {
  param: "demo-route-snapshot-test",
});
const crossingCue = buildRouteCues(navigationRoute).find(
  (cue) => cue.crossingId === crossing.crossingId,
);
assert.ok(crossingCue, "the preserved crossing produces a navigation cue");

const voicePlanner = createNavigationVoicePlanner({
  locale: "he-IL",
  cooldownMs: 0,
});
const spoken = voicePlanner.plan(
  {
    kind: "cue",
    cueType: crossingCue.type,
    phase: "final",
    cue: crossingCue,
  },
  {
    activeCue: {
      cue: crossingCue,
      phase: "final",
      distanceToCueMeters: 20,
    },
  },
  1000,
);
assert.match(
  spoken.utterance?.text || "",
  /^חצו בזהירות לצד השני של הכביש/,
  "the Studio route asks the rider to cross the road",
);

console.log("demo route snapshot tests passed");
