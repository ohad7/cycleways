import assert from "node:assert/strict";
import RouteManager from "../packages/core/route-manager.js";
import { validateRouteAttestation } from "../packages/core/src/routing/routeAttestation.js";

const policy = {
  policyId: "il-bicycle-v1",
  policyDigest: "via-point-spur-fixture",
  strictTraversalPolicy: true,
};

function allowedTraversal() {
  return {
    policyId: policy.policyId,
    policyDigest: policy.policyDigest,
    forward: "allowed",
    reverse: "allowed",
    forwardReason: "fixture",
    reverseReason: "fixture",
  };
}

function edge(value) {
  return {
    source: "osm",
    routeClass: "local_road",
    cwAlignments: { forward: [], reverse: [] },
    bicycleTraversal: allowedTraversal(),
    ...value,
  };
}

async function buildManager({ spurLength = 10, spurLatitude = 33.0001 } = {}) {
  const manager = new RouteManager();
  await manager.load(
    { type: "FeatureCollection", features: [] },
    {},
    {
      schemaVersion: 3,
      graphVersion: `via-point-spur-${spurLength}`,
      routingContract: policy,
      nodes: [
        { id: "west", coord: [35, 33] },
        { id: "junction", coord: [35.001, 33] },
        { id: "east", coord: [35.002, 33] },
        { id: "spur-end", coord: [35.001, spurLatitude] },
      ],
      edges: [
        edge({
          id: "main-west",
          shareId: 1,
          from: "west",
          to: "junction",
          distanceMeters: 100,
          coordinates: [[35, 33], [35.001, 33]],
        }),
        edge({
          id: "main-east",
          shareId: 2,
          from: "junction",
          to: "east",
          distanceMeters: 100,
          coordinates: [[35.001, 33], [35.002, 33]],
        }),
        edge({
          id: "spur",
          shareId: 3,
          from: "junction",
          to: "spur-end",
          distanceMeters: spurLength,
          coordinates: [[35.001, 33], [35.001, spurLatitude]],
        }),
      ],
    },
  );
  return manager;
}

function immediateBoundaryReversal(route, boundaryIndex = 0) {
  const incoming = route.legs[boundaryIndex]?.traversals?.at(-1);
  const outgoing = route.legs[boundaryIndex + 1]?.traversals?.[0];
  const incomingEdgeId = incoming?.edge?.id || incoming?.edgeId;
  const outgoingEdgeId = outgoing?.edge?.id || outgoing?.edgeId;
  return Boolean(
    incoming &&
      outgoing &&
      incomingEdgeId === outgoingEdgeId &&
      incoming.direction !== outgoing.direction,
  );
}

const start = { id: "start", lat: 33, lng: 35.0001 };
const end = { id: "end", lat: 33, lng: 35.0019 };
const shortVia = { id: "short-via", lat: 33.00005, lng: 35.001 };

{
  const manager = await buildManager();
  const candidate = manager.planBaseRouteCandidate([start, shortVia, end]);
  assert.equal(candidate.ok, true);
  assert.notEqual(
    candidate.routePoints[1].baseEdgeId,
    "spur",
    "a nearby continuous anchor should beat a tiny immediate spur",
  );
  assert.equal(immediateBoundaryReversal(candidate.route), false);
  assert.deepEqual(candidate.routePoints[1].requestedCoordinate, {
    lat: shortVia.lat,
    lng: shortVia.lng,
  });
}

{
  const manager = await buildManager();
  const candidate = manager.planBaseRouteCandidate([start, shortVia, end], {
    maxCandidates: 1,
  });
  assert.equal(candidate.ok, true);
  assert.equal(candidate.routePoints[1].baseEdgeId, "spur");
  assert.equal(
    immediateBoundaryReversal(candidate.route),
    true,
    "the planner must retain an unavoidable short out-and-back",
  );
}

{
  const manager = await buildManager({
    spurLength: 220,
    spurLatitude: 33.002,
  });
  const longVia = { id: "long-via", lat: 33.0012, lng: 35.001 };
  manager.recalculateRoute([start, longVia, end]);
  const routeInfo = manager.getRouteInfo();
  const diagnostics = manager.getBaseRouteDiagnostics();
  assert.equal(routeInfo.points[1].baseEdgeId, "spur");
  assert.equal(immediateBoundaryReversal(diagnostics), true);
  assert.ok(
    diagnostics.legs[0].traversals.at(-1).distanceMeters > 12,
    "the fixture must exercise a long, intentional retrace",
  );
  assert.deepEqual(validateRouteAttestation(routeInfo.routingValidation), {
    ok: true,
    reason: null,
  });
}

console.log("via-point spur routing ok");
