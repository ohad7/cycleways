import assert from "node:assert/strict";
import {
  buildEffectiveNavigationRoute,
  reverseNavigationRoute,
} from "../packages/core/src/navigation/effectiveNavigationRoute.js";
import { buildNavigationGeometry } from "../packages/core/src/navigation/navigationRoute.js";
import { buildRouteCues } from "../packages/core/src/navigation/navigationCues.js";
import { createRouteProgressTracker } from "../packages/core/src/navigation/routeProgress.js";

function route({ circular = false } = {}) {
  const raw = circular
    ? [
        { lat: 32, lng: 35, elevation: 100 },
        { lat: 32, lng: 35.01, elevation: 120 },
        { lat: 32.01, lng: 35.01, elevation: 110 },
        { lat: 32, lng: 35, elevation: 100 },
      ]
    : [
        { lat: 32, lng: 35, elevation: 100 },
        { lat: 32, lng: 35.01, elevation: 120 },
        { lat: 32.01, lng: 35.01, elevation: 90 },
      ];
  const geometry = buildNavigationGeometry(raw);
  const total = geometry.at(-1).distanceFromStartMeters;
  return {
    id: "catalog:test",
    canNavigate: true,
    geometry,
    points: [raw[0], raw.at(-1)],
    distanceMeters: total,
    distanceKm: total / 1000,
    elevationGainM: 20,
    elevationLossM: 30,
    start: { name: "Start", lat: raw[0].lat, lng: raw[0].lng },
    end: { name: "End", lat: raw.at(-1).lat, lng: raw.at(-1).lng },
    routeShape: circular ? { type: "circular" } : { type: "linear" },
    activeDataPoints: [
      { id: "before", type: "hazard", routeProgressMeters: total * 0.2 },
      { id: "after", type: "water", routeProgressMeters: total * 0.8 },
    ],
    segmentSpans: [
      { name: "A", startMeters: 0, endMeters: total / 2 },
      { name: "B", startMeters: total / 2, endMeters: total },
    ],
  };
}

{
  const source = route();
  const snapshot = structuredClone(source);
  const reversed = reverseNavigationRoute(source);
  assert.deepEqual(source, snapshot, "reverse must not mutate source");
  assert.equal(reversed.start.name, "End");
  assert.equal(reversed.end.name, "Start");
  assert.equal(reversed.elevationGainM, 30);
  assert.equal(reversed.elevationLossM, 20);
  assert.ok(Math.abs(reversed.activeDataPoints[0].routeProgressMeters - source.distanceMeters * 0.8) < 0.01);
  assert.equal(reversed.segmentSpans[0].name, "B");
  const double = reverseNavigationRoute(reversed);
  assert.deepEqual(
    double.geometry.map(({ lat, lng }) => ({ lat, lng })),
    source.geometry.map(({ lat, lng }) => ({ lat, lng })),
  );
}

{
  const effective = buildEffectiveNavigationRoute(route(), {
    direction: "forward",
    startMode: "official",
    startProgressMeters: 0,
  });
  const tracker = createRouteProgressTracker(effective);
  const laterLeg = tracker.update({
    lat: effective.geometry[1].lat,
    lng: effective.geometry[1].lng,
    accuracy: 5,
    speed: 3,
    timestamp: 1000,
  });
  assert.equal(laterLeg.hasAcquiredRoute, true, "an on-route rider can join at a later leg");
  assert.ok(laterLeg.progressMeters > 0, "mid-route acquisition preserves joined progress");
}

{
  const source = route();
  const start = source.distanceMeters * 0.5;
  const effective = buildEffectiveNavigationRoute(source, {
    direction: "forward",
    startMode: "custom",
    startProgressMeters: start,
  });
  assert.equal(effective.isEffectiveLoop, false);
  assert.ok(Math.abs(effective.distanceMeters - source.distanceMeters * 0.5) < 1);
  assert.deepEqual(effective.activeDataPoints.map((point) => point.id), ["after"]);
  assert.equal(effective.segmentSpans[0].name, "B");
  assert.ok(effective.id.includes(":ride:forward:linear:"));
}

{
  const source = route({ circular: true });
  const start = source.distanceMeters * 0.35;
  const effective = buildEffectiveNavigationRoute(source, {
    direction: "forward",
    startMode: "custom",
    startProgressMeters: start,
  });
  assert.equal(effective.isEffectiveLoop, true);
  assert.ok(Math.abs(effective.distanceMeters - source.distanceMeters) < 2);
  assert.equal(effective.activeDataPoints.length, 2);
  assert.equal(new Set(effective.activeDataPoints.map((point) => point.id)).size, 2);
  assert.ok(Math.abs(effective.geometry[0].lat - effective.geometry.at(-1).lat) < 1e-9);
  assert.ok(Math.abs(effective.geometry[0].lng - effective.geometry.at(-1).lng) < 1e-9);
  const tracker = createRouteProgressTracker(effective);
  const atStart = tracker.update({
    lat: effective.geometry[0].lat,
    lng: effective.geometry[0].lng,
    accuracy: 5,
    speed: 2,
    timestamp: 1000,
  });
  assert.equal(atStart.hasAcquiredRoute, true);
  assert.ok(atStart.progressMeters < 2, "loop seam acquires at zero, not at its finish");
  assert.ok(atStart.remainingMeters > effective.distanceMeters - 2);
}

{
  const source = route({ circular: true });
  const effective = buildEffectiveNavigationRoute(source, {
    direction: "reverse",
    startMode: "custom",
    startProgressMeters: source.distanceMeters * 0.25,
  });
  assert.equal(effective.direction, "reverse");
  assert.equal(effective.isEffectiveLoop, true);
  assert.ok(Math.abs(effective.distanceMeters - source.distanceMeters) < 2);
  assert.equal(new Set(effective.activeDataPoints.map((point) => point.id)).size, 2);
}

{
  const source = {
    ...route(),
    geometry: buildNavigationGeometry([
      { lat: 0, lng: 0 },
      { lat: 0.01, lng: 0 },
      { lat: 0.01, lng: 0.01 },
    ]),
    activeDataPoints: [],
    segmentSpans: [],
  };
  source.distanceMeters = source.geometry.at(-1).distanceFromStartMeters;
  const forwardTurn = buildRouteCues(source).find((cue) => cue.type === "turn");
  const reverseTurn = buildRouteCues(reverseNavigationRoute(source)).find((cue) => cue.type === "turn");
  assert.equal(forwardTurn.direction, "right");
  assert.equal(reverseTurn.direction, "left");
}

{
  const junctions = [{ lat: 32, lng: 35.005 }];
  const source = { ...route(), junctions };
  for (const effective of [
    buildEffectiveNavigationRoute(source, { direction: "forward" }),
    buildEffectiveNavigationRoute(source, { direction: "reverse" }),
    buildEffectiveNavigationRoute(source, {
      direction: "forward",
      startProgressMeters: 200,
    }),
  ]) {
    assert.deepEqual(effective.junctions, junctions);
    assert.notEqual(effective.junctions, junctions, "effective route clones junction data");
  }
}

console.log("test-effective-navigation-route: OK");
