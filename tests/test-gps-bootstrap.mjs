import assert from "node:assert/strict";
import {
  bootstrapKeyframesFromGps,
  parseGpsCsv,
  simplifyFractionCurve,
} from "../src/components/featured/gpsBootstrap.js";
import {
  buildCumulativeDistances,
  pointAtFraction,
} from "../src/components/featured/routeGeometry.js";

const parsed = parseGpsCsv(
  "time_s,latitude,longitude,altitude_m,speed_mps\n" +
  "0.000,33.0,35.0,10,2\n" +
  "1.000,33.0,35.001,11,2\n" +
  "\n" +
  "garbage line\n" +
  "2.000,33.0,35.002,12,2\n",
);
assert.equal(parsed.length, 3, "header/blank/garbage rows are skipped");
assert.deepEqual(parsed[0], { timeS: 0, lat: 33.0, lon: 35.0 });

const route = [
  { lat: 33.0, lng: 35.0 },
  { lat: 33.0, lng: 35.001 },
  { lat: 33.0, lng: 35.002 },
];

{
  const csv =
    "time_s,latitude,longitude\n" +
    "0,33.0,35.0\n" +
    "25,33.0,35.001\n" +
    "50,33.0,35.002\n";
  const { keyframes } = bootstrapKeyframesFromGps({
    csvText: csv,
    routeGeometry: route,
    videoDuration: 10,
    speedFactor: 5,
    maxErrorMeters: 1,
  });
  assert.equal(keyframes[0].t, 0);
  assert.equal(keyframes[keyframes.length - 1].t, 10);
  assert.ok("lat" in keyframes[0] && "lon" in keyframes[0]);
}

{
  let csv = "time_s,latitude,longitude\n";
  for (let i = 0; i <= 10; i++) {
    const lng = 35.0 + (35.002 - 35.0) * (i / 10);
    csv += `${i},33.0,${lng}\n`;
  }
  const { keyframes, stats } = bootstrapKeyframesFromGps({
    csvText: csv,
    routeGeometry: route,
    videoDuration: 10,
    speedFactor: 1,
    maxErrorMeters: 5,
  });
  assert.equal(stats.fixesRead, 11);
  assert.equal(keyframes.length, 2, "constant speed simplifies to 2 keyframes");
}

{
  const csv =
    "time_s,latitude,longitude\n" +
    "0,33.0,35.0\n" +
    "5,33.5,36.0\n" +
    "10,33.0,35.002\n";
  const { keyframes, stats } = bootstrapKeyframesFromGps({
    csvText: csv,
    routeGeometry: route,
    videoDuration: 10,
    speedFactor: 1,
    maxOffRouteMeters: 60,
    maxErrorMeters: 1,
  });
  assert.equal(stats.offRouteDropped, 1);
  assert.equal(keyframes.length, 2);
}

{
  const csv =
    "time_s,latitude,longitude\n" +
    "0,33.0,35.0\n" +
    "10,33.0,35.001\n" +
    "20,33.0,35.002\n";
  const { keyframes, stats } = bootstrapKeyframesFromGps({
    csvText: csv,
    routeGeometry: route,
    videoDuration: 15,
    speedFactor: 1,
    maxErrorMeters: 1,
  });
  assert.equal(stats.beyondDurationDropped, 1);
  assert.ok(keyframes.every((keyframe) => keyframe.t <= 15));
}

{
  const csv =
    "time_s,latitude,longitude\n" +
    "0,33.0,35.0\n" +
    "5,33.0,35.001\n" +
    "5,33.0,35.0015\n" +
    "10,33.0,35.002\n";
  const { keyframes, stats } = bootstrapKeyframesFromGps({
    csvText: csv,
    routeGeometry: route,
    videoDuration: 10,
    speedFactor: 1,
    maxErrorMeters: 0,
  });
  assert.equal(stats.nonIncreasingDropped, 1);
  for (let i = 1; i < keyframes.length; i++) {
    assert.ok(keyframes[i].t > keyframes[i - 1].t, "t is strictly increasing");
  }
}

{
  const source = [];
  for (let i = 0; i <= 100; i++) {
    const t = i / 10;
    source.push({ t, fraction: (t / 10) ** 2 });
  }
  const epsilon = 0.01;
  const simplified = simplifyFractionCurve(source, epsilon);
  assert.ok(simplified.length > 2, "curved progress keeps interior points");

  for (const point of source) {
    const hi = simplified.findIndex((candidate) => candidate.t >= point.t);
    const upper = simplified[hi === -1 ? simplified.length - 1 : hi];
    const lower = simplified[Math.max(0, (hi === -1 ? simplified.length - 1 : hi) - 1)];
    const span = upper.t - lower.t;
    const local = span > 0 ? (point.t - lower.t) / span : 0;
    const reconstructed = lower.fraction + (upper.fraction - lower.fraction) * local;
    assert.ok(
      Math.abs(point.fraction - reconstructed) <= epsilon + 1e-12,
      `point at t=${point.t} exceeds simplification tolerance`,
    );
  }
}

{
  const loopRoute = [
    { lat: 33.0, lng: 35.0 },
    { lat: 33.0, lng: 35.004 },
    { lat: 33.004, lng: 35.004 },
    { lat: 33.004, lng: 35.0 },
    { lat: 33.0, lng: 35.0001 },
  ];
  const cumulative = buildCumulativeDistances(loopRoute);
  const rowFor = (t, fraction) => {
    const point = pointAtFraction(loopRoute, cumulative, fraction);
    return `${t},${point.lat},${point.lng}`;
  };
  const csv =
    "time_s,latitude,longitude\n" +
    [
      rowFor(0, 0.999),
      rowFor(20, 0.05),
      rowFor(40, 0.25),
      rowFor(60, 0.5),
      rowFor(80, 0.75),
      rowFor(100, 0.95),
      rowFor(120, 0.999),
    ].join("\n");
  const { stats } = bootstrapKeyframesFromGps({
    csvText: csv,
    routeGeometry: loopRoute,
    videoDuration: 120,
    speedFactor: 1,
    maxErrorMeters: 1,
    maxOffRouteMeters: 25,
  });
  assert.ok(stats.ambiguousFixes > 0, "loop seam produces ambiguous candidates");
  assert.ok(stats.continuityCorrections > 0, "continuity chooses a non-nearest seam candidate");
  assert.ok(stats.startFraction < 0.05, `expected start near 0, got ${stats.startFraction}`);
  assert.ok(stats.endFraction > 0.95, `expected end near 1, got ${stats.endFraction}`);
}

{
  const longRoute = [];
  for (let i = 0; i <= 100; i++) {
    longRoute.push({ lat: 33.0, lng: 35.0 + i * 0.001 });
  }
  let csv = "time_s,latitude,longitude\n";
  for (let i = 0; i <= 50; i++) {
    const t = i / 5;
    const frac = (t / 10) ** 2;
    const lng = 35.0 + frac * 0.1;
    csv += `${t.toFixed(3)},33.0,${lng.toFixed(6)}\n`;
  }
  const coarse = bootstrapKeyframesFromGps({
    csvText: csv,
    routeGeometry: longRoute,
    videoDuration: 10,
    speedFactor: 1,
    maxErrorMeters: 50,
  });
  const fine = bootstrapKeyframesFromGps({
    csvText: csv,
    routeGeometry: longRoute,
    videoDuration: 10,
    speedFactor: 1,
    maxErrorMeters: 5,
  });
  assert.ok(coarse.keyframes.length >= 2);
  assert.ok(
    fine.keyframes.length > coarse.keyframes.length,
    `fine=${fine.keyframes.length}, coarse=${coarse.keyframes.length}`,
  );
}

console.log("gpsBootstrap tests passed");
