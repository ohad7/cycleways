import { catalogFilter } from "./catalogFilter.js";

// Discover filter chip groups (difficulty / surface / distance), shared by the
// web Discover panel and the React Native app so both stay in sync.
export const FILTER_GROUPS = [
  {
    axis: "difficulty",
    label: "רמת קושי",
    options: [
      { value: "easy", label: "קל" },
      { value: "moderate", label: "בינוני" },
      { value: "hard", label: "קשה" },
    ],
  },
  {
    axis: "surface",
    label: "משטח",
    options: [
      { value: "paved", label: "סלול" },
      { value: "mixed", label: "שטח/סלול" },
      { value: "dirt", label: "שטח" },
    ],
  },
  {
    axis: "distance",
    label: "אורך",
    options: [
      { value: "short", label: "עד 10 ק״מ" },
      { value: "medium", label: "10-25 ק״מ" },
      { value: "long", label: "25 ק״מ ומעלה" },
    ],
  },
];

export function emptyFilters() {
  return {
    difficulty: new Set(),
    surface: new Set(),
    distance: new Set(),
    startLocation: new Set(),
    throughLocation: new Set(),
  };
}

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
