import { catalogFilter } from "@cycleways/core/data/catalog.js";

// True if any filter axis has a selected value.
export function hasActiveDiscoverFilters(filters) {
  if (!filters) return false;
  return Object.values(filters).some(
    (value) => value instanceof Set && value.size > 0,
  );
}

// No active filters → "all" = the full catalog, catalog order.
// Any active filter → "results" = the full catalog finder.
export function selectDiscoverRoutes(entries, filters) {
  const list = Array.isArray(entries) ? entries : [];
  if (!hasActiveDiscoverFilters(filters)) {
    return { mode: "all", routes: list };
  }
  return { mode: "results", routes: catalogFilter(list, filters) };
}
