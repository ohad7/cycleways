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

export const DISCOVER_INTENT_FILTERS = [
  { value: "easy", label: "קליל" },
  { value: "family", label: "משפחות" },
  { value: "water", label: "ליד מים" },
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

export function routeDiscoveryKey(entry) {
  return entry?.slug || entry?.id || entry?.name || null;
}

export function discoveryHeroCandidates(entries, { preferEditorial = true } = {}) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!preferEditorial) return list;
  const editorial = list.filter((entry) => entry.featured || entry.recommended);
  return editorial.length > 0 ? editorial : list;
}

export function selectDiscoveryHero(entries, { seed = 0, preferEditorial = true } = {}) {
  const candidates = discoveryHeroCandidates(entries, { preferEditorial });
  if (candidates.length === 0) return null;
  const normalizedSeed = normalizeHeroSeed(seed);
  const index = Math.min(
    candidates.length - 1,
    Math.floor(normalizedSeed * candidates.length),
  );
  return candidates[index] || candidates[0] || null;
}

export function routesWithoutDiscoveryHero(entries, hero) {
  const list = Array.isArray(entries) ? entries : [];
  const heroKey = routeDiscoveryKey(hero);
  if (!heroKey) return list;
  return list.filter((entry) => routeDiscoveryKey(entry) !== heroKey);
}

export function filterRoutesByDiscoveryIntent(entries, selectedIntents, { placeById } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const selected = selectedIntentValues(selectedIntents);
  if (selected.length === 0) return list;
  return list.filter((entry) =>
    selected.every((intent) => routeMatchesDiscoveryIntent(entry, intent, placeById)),
  );
}

export function routeMatchesDiscoveryIntent(entry, intent, placeById) {
  if (!entry) return false;
  switch (intent) {
    case "easy":
      return entry.difficulty === "easy";
    case "family":
      return entry.difficulty === "easy" && Number(entry.distanceKm) <= 10;
    case "water":
      return routeSearchText(entry, placeById).includes("מים") ||
        WATER_TERMS.some((term) => routeSearchText(entry, placeById).includes(term));
    default:
      return true;
  }
}

function normalizeHeroSeed(seed) {
  const n = Number(seed);
  if (!Number.isFinite(n)) return 0;
  const fraction = Math.abs(n) % 1;
  return fraction === 1 ? 0 : fraction;
}

function selectedIntentValues(selectedIntents) {
  if (selectedIntents instanceof Set) return Array.from(selectedIntents);
  if (Array.isArray(selectedIntents)) return selectedIntents;
  if (typeof selectedIntents === "string" && selectedIntents) return [selectedIntents];
  return [];
}

const WATER_TERMS = [
  "נחל",
  "נחלים",
  "דן",
  "בניאס",
  "ירדן",
  "אגמון",
  "חולה",
  "דפנה",
  "בריכות",
  "גן הצפון",
];

function routeSearchText(entry, placeById) {
  const placeNames = (entry?.passesNear || [])
    .map((id) => placeById?.get?.(id)?.name || id)
    .filter(Boolean);
  return [
    entry?.name,
    entry?.summary,
    entry?.description,
    ...(Array.isArray(entry?.tags) ? entry.tags : []),
    ...placeNames,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
