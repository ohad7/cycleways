import { distanceToLineSegment, getDistance } from "../utils/distance.js";

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function pointToRoute(point, geometry) {
  let distanceMeters = Infinity;
  let segmentIndex = -1;
  let progressMeters = 0;
  let cumulative = 0;
  for (let index = 1; index < geometry.length; index += 1) {
    const start = geometry[index - 1];
    const end = geometry[index];
    const distance = distanceToLineSegment(point, start, end);
    if (distance < distanceMeters) {
      distanceMeters = distance;
      segmentIndex = index - 1;
      progressMeters = cumulative;
    }
    cumulative += getDistance(start, end);
  }
  return { distanceMeters, segmentIndex, progressMeters };
}

export function validateDemoRideAgainstRoute(fixes, routeState, options = {}) {
  const geometry = routeState?.geometry || [];
  if (geometry.length < 2) throw new Error("route geometry requires at least two points");
  const maxP95DistanceMeters = Number(options.maxP95DistanceMeters) || 45;
  const maxDistanceMeters = Number(options.maxDistanceMeters) || 120;
  const maxGapSeconds = Number(options.maxGapSeconds) || 5;
  const samples = fixes.map((fix) => ({ timestamp: fix.timestamp, ...pointToRoute(fix, geometry) }));
  const distances = samples.map((sample) => sample.distanceMeters);
  const gaps = [];
  for (let index = 1; index < fixes.length; index += 1) {
    const seconds = (fixes[index].timestamp - fixes[index - 1].timestamp) / 1000;
    if (seconds > maxGapSeconds) gaps.push({ fromMs: fixes[index - 1].timestamp, toMs: fixes[index].timestamp, seconds });
  }
  const metrics = {
    sampleCount: samples.length,
    p50DistanceMeters: percentile(distances, 0.5),
    p95DistanceMeters: percentile(distances, 0.95),
    maxDistanceMeters: Math.max(...distances),
    offRouteSamples: distances.filter((distance) => distance > maxP95DistanceMeters).length,
    gaps,
  };
  const gates = [
    { code: "route-fit-p95", pass: metrics.p95DistanceMeters <= maxP95DistanceMeters, actual: metrics.p95DistanceMeters, limit: maxP95DistanceMeters },
    { code: "route-fit-max", pass: metrics.maxDistanceMeters <= maxDistanceMeters, actual: metrics.maxDistanceMeters, limit: maxDistanceMeters },
    { code: "gps-gaps", pass: gaps.length === 0, actual: gaps.length, limit: 0 },
  ];
  return { pass: gates.every((gate) => gate.pass), metrics, gates, samples };
}
