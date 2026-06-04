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
    { label: "כל השבילים", to: "/" },
  ],
  "banias-gan-hatsafon": [
    { label: "על המסלול", href: "#fv-about" },
    { label: "נקודות במסלול", href: "#fv-poi-stories" },
    { label: "כל השבילים", to: "/" },
  ],
};

export function getFeaturedModuleLoader(slug) {
  return moduleLoaders[slug] || null;
}

export function getFeaturedNav(slug) {
  return moduleNav[slug] || null;
}

export async function loadFeaturedMetaList() {
  const catalog = await loadCatalog();
  return (catalog?.entries || []).filter((e) => e.featured);
}

export async function findFeaturedMeta(slug) {
  const catalog = await loadCatalog();
  return (catalog?.entries || []).find((e) => e.featured && e.slug === slug) || null;
}
