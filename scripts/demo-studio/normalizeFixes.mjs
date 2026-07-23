import { getDistance } from "../../packages/core/src/utils/distance.js";

function bearing(from, to) {
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const delta = (to.lng - from.lng) * Math.PI / 180;
  const y = Math.sin(delta) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(delta);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function interpolate(from, to, timestamp) {
  const ratio = (timestamp - from.timestamp) / (to.timestamp - from.timestamp);
  return {
    lat: from.lat + (to.lat - from.lat) * ratio,
    lng: from.lng + (to.lng - from.lng) * ratio,
    altitude: finite(from.altitude) && finite(to.altitude) ? from.altitude + (to.altitude - from.altitude) * ratio : null,
    speed: from.speed + (to.speed - from.speed) * ratio,
    heading: from.heading,
    accuracy: Math.max(from.accuracy, to.accuracy),
    timestamp,
    synthesized: true,
  };
}

export function normalizeRideFixes(rows, options = {}) {
  const trimInSeconds = Number(options.trimInSeconds) || 0;
  const trimOutSeconds = Number.isFinite(Number(options.trimOutSeconds)) ? Number(options.trimOutSeconds) : Infinity;
  const gpsOffsetSeconds = Number(options.gpsOffsetSeconds) || 0;
  const defaultAccuracyMeters = Math.max(1, Number(options.defaultAccuracyMeters) || 12);
  const maxTeleportKmh = Math.max(20, Number(options.maxTeleportKmh) || 200);
  const maxInterpolatedGapSeconds = Math.max(0, Number(options.maxInterpolatedGapSeconds) || 0);
  const rejected = [];
  const cleanup = {
    inputRows: Array.isArray(rows) ? rows.length : 0,
    acceptedRows: 0,
    synthesizedFixes: 0,
    dropped: { noLock: 0, nonFinite: 0, bounds: 0, outsideTrim: 0, nonIncreasing: 0, teleport: 0 },
    gpsOffsetSeconds,
    defaultAccuracyMeters,
    maxTeleportKmh,
    maxInterpolatedGapSeconds,
  };
  const fixes = [];
  let lastHeading = 0;
  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    if (row.measureMode !== undefined && ![2, 3].includes(Number(row.measureMode))) {
      cleanup.dropped.noLock += 1;
      rejected.push({ index, reason: "no-lock" });
      continue;
    }
    if (![row.timeSeconds, row.latitude, row.longitude].every(finite)) {
      cleanup.dropped.nonFinite += 1;
      rejected.push({ index, reason: "non-finite" });
      continue;
    }
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      cleanup.dropped.bounds += 1;
      rejected.push({ index, reason: "coordinate-bounds" });
      continue;
    }
    const mediaSeconds = Number(row.timeSeconds) + gpsOffsetSeconds;
    if (mediaSeconds < trimInSeconds || mediaSeconds > trimOutSeconds) {
      cleanup.dropped.outsideTrim += 1;
      continue;
    }
    const timestamp = Math.round(mediaSeconds * 1000);
    const previous = fixes.at(-1);
    if (previous && timestamp <= previous.timestamp) {
      cleanup.dropped.nonIncreasing += 1;
      rejected.push({ index, reason: "non-increasing" });
      continue;
    }
    const dt = previous ? (timestamp - previous.timestamp) / 1000 : null;
    const distance = previous ? getDistance(previous, { lat, lng }) : 0;
    const derivedSpeed = previous && dt > 0 ? distance / dt : 0;
    if (previous && derivedSpeed * 3.6 > maxTeleportKmh) {
      cleanup.dropped.teleport += 1;
      rejected.push({ index, reason: "teleport", speedKmh: derivedSpeed * 3.6 });
      continue;
    }
    const speed = finite(row.speed) && Number(row.speed) >= 0 ? Number(row.speed) : derivedSpeed;
    if (previous && distance >= 1 && speed >= 0.5) lastHeading = bearing(previous, { lat, lng });
    fixes.push({
      lat,
      lng,
      altitude: finite(row.altitude) ? Number(row.altitude) : null,
      speed,
      heading: lastHeading,
      accuracy: finite(row.accuracy) && Number(row.accuracy) > 0 ? Number(row.accuracy) : defaultAccuracyMeters,
      timestamp,
    });
  }

  if (maxInterpolatedGapSeconds > 0 && fixes.length > 1) {
    const withInterpolation = [];
    for (let index = 0; index < fixes.length; index += 1) {
      const current = fixes[index];
      const previous = withInterpolation.at(-1);
      if (previous) {
        const gap = (current.timestamp - previous.timestamp) / 1000;
        if (gap > 2 && gap <= maxInterpolatedGapSeconds) {
          for (let timestamp = previous.timestamp + 1000; timestamp < current.timestamp; timestamp += 1000) {
            withInterpolation.push(interpolate(previous, current, timestamp));
            cleanup.synthesizedFixes += 1;
          }
        }
      }
      withInterpolation.push(current);
    }
    fixes.splice(0, fixes.length, ...withInterpolation);
  }
  cleanup.acceptedRows = fixes.length - cleanup.synthesizedFixes;
  const warnings = [];
  for (let index = 1; index < fixes.length; index += 1) {
    const gapSeconds = (fixes[index].timestamp - fixes[index - 1].timestamp) / 1000;
    if (gapSeconds > 3) warnings.push({ code: "gps-gap", fromMs: fixes[index - 1].timestamp, toMs: fixes[index].timestamp, gapSeconds });
  }
  if (fixes.length < 2) throw new Error("normalization produced fewer than two usable GPS fixes");
  return { fixes, cleanup, warnings, rejected };
}

export function largestCoherentGpsRun(rows, options = {}) {
  const trimInSeconds = Number(options.trimInSeconds) || 0;
  const trimOutSeconds = Number.isFinite(Number(options.trimOutSeconds)) ? Number(options.trimOutSeconds) : Infinity;
  const gpsOffsetSeconds = Number(options.gpsOffsetSeconds) || 0;
  const maxTeleportKmh = Math.max(20, Number(options.maxTeleportKmh) || 200);
  const eligible = (Array.isArray(rows) ? rows : []).filter((row) => {
    if (row.measureMode !== undefined && ![2, 3].includes(Number(row.measureMode))) return false;
    if (![row.timeSeconds, row.latitude, row.longitude].every(finite)) return false;
    if (Math.abs(Number(row.latitude)) > 90 || Math.abs(Number(row.longitude)) > 180) return false;
    const mediaSeconds = Number(row.timeSeconds) + gpsOffsetSeconds;
    return mediaSeconds >= trimInSeconds && mediaSeconds <= trimOutSeconds;
  });
  const runs = [];
  let current = [];
  for (const row of eligible) {
    const previous = current.at(-1);
    if (previous) {
      const seconds = Number(row.timeSeconds) - Number(previous.timeSeconds);
      const distance = seconds > 0
        ? getDistance(
            { lat: Number(previous.latitude), lng: Number(previous.longitude) },
            { lat: Number(row.latitude), lng: Number(row.longitude) },
          )
        : Infinity;
      const speedKmh = seconds > 0 ? distance / seconds * 3.6 : Infinity;
      if (speedKmh > maxTeleportKmh) {
        if (current.length) runs.push(current);
        current = [];
      }
    }
    current.push(row);
  }
  if (current.length) runs.push(current);
  return runs.sort((left, right) => right.length - left.length)[0] || [];
}

export function normalizeRideFixesWithRecovery(rows, options = {}) {
  try {
    return { ...normalizeRideFixes(rows, options), recovery: null };
  } catch (error) {
    if (!/fewer than two usable GPS fixes/.test(error.message)) throw error;
    const recoveredRows = largestCoherentGpsRun(rows, options);
    if (recoveredRows.length < 2) throw error;
    const normalized = normalizeRideFixes(recoveredRows, options);
    return {
      ...normalized,
      recovery: {
        kind: "largest-coherent-run",
        inputRows: Array.isArray(rows) ? rows.length : 0,
        recoveredRows: recoveredRows.length,
        fromSeconds: Number(recoveredRows[0].timeSeconds),
        toSeconds: Number(recoveredRows.at(-1).timeSeconds),
      },
    };
  }
}
