import { loadCatalog } from "@cycleways/core/data/catalog.js";

const moduleLoaders = {
  "sovev-beit-hillel":     () => import("./sovev-beit-hillel.jsx"),
  "banias-gan-hatsafon":   () => import("./banias-gan-hatsafon.jsx"),
};

// Per-page top-nav links. Each featured page declares its own in-page jump
// links (anchor hrefs) plus a route link back to the main map. Pages without
// an entry fall back to the default site nav in TopBar.
const moduleNav = {
  "sovev-beit-hillel": [
    { label: "על המסלול", href: "#fv-about" },
    { label: "נקודות במסלול", href: "#fv-poi-stories" },
    { label: "כל המסלולים", to: "/featured/" },
  ],
  "banias-gan-hatsafon": [
    { label: "על המסלול", href: "#fv-about" },
    { label: "נקודות במסלול", href: "#fv-poi-stories" },
    { label: "כל המסלולים", to: "/featured/" },
  ],
};

export function getFeaturedModuleLoader(slug) {
  return getRouteStoryModuleLoader(slug);
}

export function getFeaturedNav(slug) {
  return getRouteStoryNav(slug);
}

export function getRouteStoryModuleLoader(slug) {
  return moduleLoaders[slug] || null;
}

export function getRouteStoryNav(slug) {
  return moduleNav[slug] || null;
}

export function hasRouteStory(slug) {
  return Boolean(getRouteStoryModuleLoader(slug));
}

export async function loadRecommendedRouteList() {
  const catalog = await loadCatalog();
  return Array.isArray(catalog?.entries) ? catalog.entries : [];
}

export async function loadFeaturedMetaList() {
  const catalog = await loadCatalog();
  return (catalog?.entries || []).filter((e) => e.featured);
}

export async function findRouteMeta(slug) {
  const catalog = await loadCatalog();
  return (catalog?.entries || []).find((e) => e.slug === slug) || null;
}

export async function findFeaturedMeta(slug) {
  const catalog = await loadCatalog();
  return (
    (catalog?.entries || []).find(
      (e) =>
        e.slug === slug &&
        (e.featured || e.story?.enabled === true || hasRouteStory(slug)),
    ) || null
  );
}
