import { loadCatalog } from "../data/catalog.js";

const moduleLoaders = {
  "sovev-beit-hillel":     () => import("./sovev-beit-hillel.jsx"),
  "shdeh-nehemia-baniyas": () => import("./shdeh-nehemia-baniyas.jsx"),
};

export function getFeaturedModuleLoader(slug) {
  return moduleLoaders[slug] || null;
}

export async function loadFeaturedMetaList() {
  const catalog = await loadCatalog();
  return (catalog?.entries || []).filter((e) => e.featured);
}

export async function findFeaturedMeta(slug) {
  const catalog = await loadCatalog();
  return (catalog?.entries || []).find((e) => e.featured && e.slug === slug) || null;
}
