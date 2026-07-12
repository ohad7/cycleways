import assert from "node:assert/strict";
import {
  evaluateThresholds,
  latestConnectorLabels,
} from "@cycleways/core/routing/connectorEvaluate.js";
import { DEFAULT_CONNECTOR_THRESHOLDS } from "@cycleways/core/routing/connectorConfidence.js";

const guideFeatures = {
  featureVersion: 1,
  snapOk: true,
  straightLineMeters: 1000,
  routedMeters: 1200,
  detourRatio: 1.2,
  cwNetworkFraction: 0.7,
  worstRouteClass: "road",
  edgeCount: 4,
};
const farFeatures = { ...guideFeatures, straightLineMeters: 999999 };

const labels = [
  { verdict: "valid", features: guideFeatures },
  { verdict: "valid", features: farFeatures },
  { verdict: "unacceptable", features: guideFeatures },
  { verdict: "unacceptable", features: farFeatures },
  { verdict: "borderline", features: guideFeatures },
];
const r = evaluateThresholds(labels, DEFAULT_CONNECTOR_THRESHOLDS);
assert.equal(r.counts.valid.guide, 1);
assert.equal(r.counts.valid.other, 1);
assert.equal(r.counts.unacceptable.guide, 1);
assert.equal(r.counts.unacceptable.other, 1);
assert.equal(r.counts.borderline.guide, 1);
assert.equal(r.counts.total, 5);
assert.equal(r.validGuideRate, 0.5);
assert.equal(r.invalidGuideRate, 0.5);

const relabeled = [
  {
    routeSlug: "r",
    routeStart: { lat: 33, lng: 35 },
    origin: { lat: 33.1, lng: 35.1 },
    strategyHash: "sha256:a",
    verdict: "valid",
    features: guideFeatures,
  },
  {
    routeSlug: "r",
    routeStart: { lat: 33, lng: 35 },
    origin: { lat: 33.1, lng: 35.1 },
    strategyHash: "sha256:a",
    verdict: "unacceptable",
    features: guideFeatures,
  },
];
assert.equal(latestConnectorLabels(relabeled).length, 1);
const deduped = evaluateThresholds(relabeled, DEFAULT_CONNECTOR_THRESHOLDS);
assert.equal(deduped.counts.total, 1);
assert.equal(deduped.counts.unacceptable.guide, 1);

const empty = evaluateThresholds([], DEFAULT_CONNECTOR_THRESHOLDS);
assert.equal(empty.validGuideRate, null);
assert.equal(empty.invalidGuideRate, null);
assert.equal(empty.counts.total, 0);

console.log("connector-evaluate OK");
