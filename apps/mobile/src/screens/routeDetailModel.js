import {
  routeDifficultyLabel,
  routeShapeLabel,
  routeSurfaceLabel,
} from "@cycleways/core/data/catalog.js";

// Build the detail screen's header + stats view-model from a catalog entry and
// its precomputed snapshot. Snapshot route metrics win when finite; otherwise
// the catalog entry's values are used. Stat rows with no value are omitted.
export function routeDetailModel(entry, snapshot) {
  const e = entry || {};
  const route = snapshot?.route || {};

  const distanceKm = Number.isFinite(route.distance)
    ? route.distance / 1000
    : Number.isFinite(e.distanceKm)
      ? e.distanceKm
      : null;
  const gain = Number.isFinite(route.elevationGain)
    ? route.elevationGain
    : Number.isFinite(e.elevationGainM)
      ? e.elevationGainM
      : null;
  const loss = Number.isFinite(route.elevationLoss)
    ? route.elevationLoss
    : Number.isFinite(e.elevationLossM)
      ? e.elevationLossM
      : null;

  const stats = [];
  if (distanceKm != null) {
    stats.push({ label: "מרחק", value: `${roundKm(distanceKm)} ק״מ` });
  }
  if (gain != null) stats.push({ label: "טיפוס", value: `${Math.round(gain)} מ׳` });
  if (loss != null) stats.push({ label: "ירידה", value: `${Math.round(loss)} מ׳` });
  const difficulty = routeDifficultyLabel(e.difficulty);
  if (difficulty) stats.push({ label: "דרגת קושי", value: difficulty });
  const shape = routeShapeLabel(e);
  if (shape) stats.push({ label: "צורה", value: shape });
  const surface = routeSurfaceLabel(e);
  if (surface) stats.push({ label: "משטח", value: surface });

  return {
    title: e.name || "",
    kicker: [e.regionName, "מסלול מומלץ"].filter(Boolean).join(" · "),
    summary: e.summary || "",
    description: e.description || e.notes || e.summary || "",
    stats,
  };
}

function roundKm(km) {
  return Math.round(km * 10) / 10;
}
