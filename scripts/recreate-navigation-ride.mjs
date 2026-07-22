#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { createShardedRouteSession } from "../packages/core/src/routing/shardedRouteSession.js";
import { decodeCompactBaseRoutingShard } from "../packages/core/src/routing/compactBaseRoutingShard.js";
import { decodeMessagePack } from "../packages/core/src/routing/messagePack.js";
import { validateRouteAttestation } from "../packages/core/src/routing/routeAttestation.js";
import { roundaboutsOnRoute } from "../packages/core/src/routing/roundaboutsOnRoute.js";
import { crossingsOnRoute } from "../packages/core/src/routing/crossingsOnRoute.js";
import { navigationRouteFromRouteState } from "../packages/core/src/navigation/navigationRoute.js";
import { buildRouteCues } from "../packages/core/src/navigation/navigationCues.js";
import { createNavigationVoicePlanner } from "../packages/core/src/navigation/navigationVoice.js";
import { joinCrossingReviews } from "../editor/lib/crossingReview.mjs";
import {
  reportedRideFingerprintDisposition,
  reportedRideTraversalPathFingerprint,
} from "./lib/reportedRideAcceptance.mjs";

const require = createRequire(import.meta.url);
const RouteManager = require("../packages/core/route-manager.js");
const { values } = parseArgs({
  options: {
    root: { type: "string", default: "build/public-data" },
    fixture: {
      type: "string",
      default: "tests/fixtures/bicycle-traversal/road-99-ride-candidate.json",
    },
    "geojson-output": { type: "string" },
    "crossings-source": { type: "string", default: "auto" },
    "crossing-review": { type: "string", default: "data/crossing-review.json" },
    check: { type: "boolean", default: false },
  },
});

const root = path.resolve(values.root);
const fixture = JSON.parse(await readFile(path.resolve(values.fixture), "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "map-manifest.json"), "utf8"));
const geoJsonData = JSON.parse(await readFile(path.join(root, manifest.bikeRoads), "utf8"));
const segmentsData = JSON.parse(await readFile(path.join(root, manifest.segments), "utf8"));
const cwBaseIndex = JSON.parse(await readFile(path.join(root, manifest.cwBaseIndex), "utf8"));
const roundaboutsData = manifest.roundabouts
  ? JSON.parse(await readFile(path.join(root, manifest.roundabouts), "utf8"))
  : null;
const shardManifestPath = path.join(root, manifest.baseRoutingShards);
const shardManifest = JSON.parse(await readFile(shardManifestPath, "utf8"));
const shardRoot = path.dirname(shardManifestPath);

async function loadShard(entry) {
  const bytes = await readFile(path.join(shardRoot, entry.path));
  const expected = entry.formats?.[entry.format]?.sha256;
  if (expected) {
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) throw new Error(`shard digest mismatch: ${entry.id}`);
  }
  if (entry.format === "compact") return decodeCompactBaseRoutingShard(bytes);
  if (entry.format === "msgpack") return decodeMessagePack(bytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}

const session = await createShardedRouteSession(
  RouteManager,
  geoJsonData,
  segmentsData,
  shardManifest,
  loadShard,
  { cwBaseIndex, paddingShards: 1 },
);
const replan = fixture.acceptedReplacement || fixture.coordinateReplan;
const points = replan.coordinates.map((point, index) => ({
  ...point,
  id: `reported-ride-${index}`,
}));
const route = await session.restorePoints(points);
const crossingSourceMode = values["crossings-source"];
if (!new Set(["auto", "published", "review", "none"]).has(crossingSourceMode)) {
  throw new Error(`unsupported crossings source: ${crossingSourceMode}`);
}
let crossingArtifact = null;
let crossingArtifactSource = "none";
let crossingArtifactIssues = [];
if (route && crossingSourceMode !== "none" && manifest.crossings
  && (crossingSourceMode === "auto" || crossingSourceMode === "published")) {
  crossingArtifact = JSON.parse(await readFile(path.join(root, manifest.crossings), "utf8"));
  crossingArtifactSource = "published";
} else if (route && (crossingSourceMode === "review"
  || (crossingSourceMode === "auto" && !manifest.crossings))) {
  const reviewData = JSON.parse(await readFile(path.resolve(values["crossing-review"]), "utf8"));
  const joinedCrossings = joinCrossingReviews(
    { schemaVersion: 1, coverage: { baseGraph: "current-review" }, crossings: [] },
    reviewData,
  );
  crossingArtifactIssues = joinedCrossings.blockingIssues || [];
  const validationContext = route.routingValidation?.validationContext || {};
  crossingArtifact = {
    schemaVersion: 1,
    graphVersion: validationContext.graphVersion,
    traversalPolicyDigest: validationContext.policyDigest,
    crossings: joinedCrossings.runtimeCrossings,
  };
  crossingArtifactSource = "current-review-unpublished";
}
const routeCrossings = route
  ? crossingsOnRoute(crossingArtifact, route.routingValidation, route.geometry)
  : null;
const nearbyJunctions = route && typeof session.junctionsNearRoute === "function"
  ? await session.junctionsNearRoute(route.geometry)
  : null;
const routeRoundabouts = route
  ? roundaboutsOnRoute(roundaboutsData?.roundabouts, route.geometry)
  : [];
const navigationRouteState = route
  ? {
      ...route,
      junctions: Array.isArray(nearbyJunctions)
        ? [...nearbyJunctions, ...routeRoundabouts]
        : nearbyJunctions,
      crossings: routeCrossings,
    }
  : null;
const slices = route?.routingValidation?.traversalSlices || [];
const forbidden = slices.filter((slice) => slice.policyState !== "allowed");
const traversedShareIds = new Set(slices.map((slice) => Number(slice.edgeShareId)));
const requiredSegments = (replan.requiredSegmentIds || []).map((value) => {
  const segmentId = Number(value);
  const segment = cwBaseIndex.segments?.[String(segmentId)];
  const acceptedShareIds = [...new Set(
    Object.values(segment?.alignments || {})
      .filter((alignment) => alignment?.disposition === "accepted")
      .flatMap((alignment) => alignment.edgeRefs || [])
      .map((ref) => Number(ref[0])),
  )];
  const traversedAcceptedShareIds = acceptedShareIds.filter((shareId) =>
    traversedShareIds.has(shareId),
  );
  return {
    segmentId,
    published: acceptedShareIds.length > 0,
    traversed: traversedAcceptedShareIds.length > 0,
    traversedAcceptedShareIds,
  };
});
const edge370Reverse = slices.filter(
  (slice) =>
    Number(slice.edgeShareId) === 370 &&
    Number(slice.fromFractionQ) > Number(slice.toFractionQ),
);
const blockers = [];
if (!route || route.routeFailure) blockers.push("coordinate-replan-failed");
if (!validateRouteAttestation(route?.routingValidation, { geometry: route?.geometry }).ok) {
  blockers.push("route-attestation-invalid");
}
if (forbidden.length > 0) blockers.push("non-allowed-traversal");
if (edge370Reverse.length > 0) blockers.push("road-99-edge-370-reverse");
for (const required of requiredSegments) {
  if (!required.published) blockers.push(`required-segment-unpublished:${required.segmentId}`);
  else if (!required.traversed) blockers.push(`required-segment-not-traversed:${required.segmentId}`);
}
const acceptedFingerprint = replan.acceptedFingerprint;
const actualFingerprint = route?.routingValidation?.contentFingerprint || null;
const traversalPathFingerprint = reportedRideTraversalPathFingerprint(slices);
const fingerprintDisposition = reportedRideFingerprintDisposition({
  acceptedFingerprint,
  actualFingerprint,
  acceptedTraversalPathFingerprint: replan.acceptedTraversalPathFingerprint,
  actualTraversalPathFingerprint: traversalPathFingerprint,
  acceptedDistanceMeters: replan.acceptedDistanceMeters,
  actualDistanceMeters: route?.distance,
  distanceToleranceMeters: replan.distanceToleranceMeters,
});
if (fingerprintDisposition === "unaccepted") {
  blockers.push("replacement-fingerprint-unaccepted");
} else if (fingerprintDisposition === "changed") {
  blockers.push("replacement-fingerprint-changed");
}

const navigationCues = navigationRouteState
  ? buildRouteCues(navigationRouteFromRouteState(navigationRouteState, { param: "reported-ride" }))
  : [];
const replayVoicePlanner = createNavigationVoicePlanner({ locale: "he-IL", cooldownMs: 0 });
const spokenInstructions = [];
for (const [index, cue] of navigationCues.entries()) {
  const planned = replayVoicePlanner.plan(
    { kind: "cue", cueType: cue.type, phase: "final", cue },
    { activeCue: { cue, phase: "final", distanceToCueMeters: 20 } },
    1000 + index * 1000,
  );
  if (!planned.utterance) continue;
  spokenInstructions.push({
    distanceMeters: Math.round(Number(cue.distanceMeters) * 10) / 10,
    type: cue.type,
    direction: cue.direction || null,
    crossedRoadName: cue.crossedRoadName || null,
    thenType: cue.thenManeuver?.type || null,
    thenDirection: cue.thenManeuver?.direction || null,
    spokenText: planned.utterance.text,
  });
}

const report = {
  schemaVersion: 1,
  status: blockers.length === 0 ? "ready" : "blocked",
  root,
  fixture: path.resolve(values.fixture),
  replanSource: fixture.acceptedReplacement ? "acceptedReplacement" : "coordinateReplan",
  blockers,
  requiredSegments,
  route: route
    ? {
      distanceMeters: route.distance,
      waypointCount: route.points?.length || 0,
      traversalCount: slices.length,
      contentFingerprint: actualFingerprint,
      traversalPathFingerprint,
      fingerprintDisposition,
      requiresReview: route.requiresReview === true,
      routeFailure: route.routeFailure || null,
      unsnappedPoints: (route.points || [])
        .map((point, index) => ({ index, lat: point.lat, lng: point.lng, unsnapped: point.unsnapped === true }))
        .filter((point) => point.unsnapped),
      guidanceMode: route.guidanceMode || "legacy",
      navigationEvidence: {
        nearbyJunctions: Array.isArray(nearbyJunctions) ? nearbyJunctions.length : null,
        roundaboutTraversals: routeRoundabouts.length,
        crossingArtifactSource,
        crossingArtifactCount: crossingArtifact?.crossings?.length ?? null,
        crossingArtifactIssues,
        matchedCrossings: Array.isArray(routeCrossings) ? routeCrossings.map((crossing) => ({
          id: crossing.crossingId,
          mappingId: crossing.mappingId,
          name: crossing.crossedRoadName || null,
          entryMeters: Math.round(Number(crossing.entryMeters) * 10) / 10,
          exitMeters: Math.round(Number(crossing.exitMeters) * 10) / 10,
        })) : null,
        maneuverCues: navigationCues
          .filter((cue) => ["turn", "roundabout", "crossing", "enter-segment"].includes(cue.type))
          .map((cue) => ({
            type: cue.type,
            distanceMeters: Math.round(Number(cue.distanceMeters) * 10) / 10,
            completionMeters: Math.round(Number(
              cue.exitDistanceMeters ?? cue.completionDistanceMeters ?? cue.distanceMeters,
            ) * 10) / 10,
            direction: cue.direction || null,
            roundaboutId: cue.roundaboutId || null,
            crossingId: cue.crossingId || null,
            ontoSegmentName: cue.ontoSegmentName || cue.ontoGuidance?.name || null,
            thenType: cue.thenManeuver?.type || null,
            thenDirection: cue.thenManeuver?.direction || null,
            thenOntoSegmentName:
              cue.thenManeuver?.ontoSegmentName || cue.thenManeuver?.ontoGuidance?.name || null,
          })),
        segmentSpans: (route.segmentSpans || []).map((span) => ({
          segmentId: span.segmentId ?? null,
          name: span.name || null,
          networkRole: span.networkRole || null,
          startMeters: Math.round(Number(span.startMeters) * 10) / 10,
          endMeters: Math.round(Number(span.endMeters) * 10) / 10,
        })),
      },
      spokenInstructions,
      guidanceSpans: (route.guidanceSpans || []).map((span) => ({
        startMeters: Math.round(Number(span.startMeters) * 10) / 10,
        endMeters: Math.round(Number(span.endMeters) * 10) / 10,
        resolutionStatus: span.resolutionStatus,
        guidanceIdentity: span.guidanceIdentity || null,
        name: span.name || null,
        segmentIds: span.segmentIds || [],
      })),
      guidanceCues: navigationCues
        .filter((cue) =>
          cue.ontoGuidance ||
          cue.thenManeuver?.ontoGuidance ||
          cue.stayOnGuidance ||
          Number.isFinite(Number(cue.continueOnWayMeters)),
        )
        .map((cue) => ({
          distanceMeters: Math.round(Number(cue.distanceMeters) * 10) / 10,
          type: cue.type,
          direction: cue.direction || null,
          guidanceIdentity:
            cue.thenManeuver?.ontoGuidance?.guidanceIdentity ||
            cue.ontoGuidance?.guidanceIdentity ||
            cue.stayOnGuidance?.guidanceIdentity ||
            null,
          name:
            cue.thenManeuver?.ontoGuidance?.name ||
            cue.ontoGuidance?.name ||
            cue.stayOnGuidance?.name ||
            null,
          semantics: cue.stayOnGuidance ? "stay-on" : "enter",
          continueOnWayMeters: Number.isFinite(Number(cue.continueOnWayMeters))
            ? Math.round(Number(cue.continueOnWayMeters) * 10) / 10
            : null,
          spokenText: createNavigationVoicePlanner().plan(
            { kind: "cue", cueType: cue.type, phase: "final", cue },
            { activeCue: { cue, phase: "final", distanceToCueMeters: 20 } },
            1000,
          ).utterance?.text || null,
        })),
      }
    : null,
};
if (values["geojson-output"] && Array.isArray(route?.geometry) && route.geometry.length >= 2) {
  await writeFile(
    path.resolve(values["geojson-output"]),
    `${JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            scenario: "road-99-reported-ride",
            kind: "current-policy-recreation",
            distanceMeters: route.distance,
            traversalCount: slices.length,
            stroke: "#16833f",
            "stroke-width": 6,
            "stroke-opacity": 0.9,
          },
          geometry: {
            type: "LineString",
            coordinates: route.geometry.map((point) => [
              Number(point.lng),
              Number(point.lat),
            ]),
          },
        },
      ],
    }, null, 2)}\n`,
  );
}
console.log(JSON.stringify(report, null, 2));
if (values.check && blockers.length > 0) process.exitCode = 1;
