import { catalogFilter } from "../catalogFilter.js";

// True if any filter axis has a selected value.
export function hasActiveDiscoverFilters(filters) {
  if (!filters) return false;
  return Object.values(filters).some(
    (value) => value instanceof Set && value.size > 0,
  );
}

// No active filters → curated "recommended" = featured entries.
// Any active filter → "results" = the full catalog finder.
export function selectDiscoverRoutes(entries, filters) {
  const list = Array.isArray(entries) ? entries : [];
  if (!hasActiveDiscoverFilters(filters)) {
    return { mode: "recommended", routes: list.filter((e) => e && e.featured) };
  }
  return { mode: "results", routes: catalogFilter(list, filters) };
}
