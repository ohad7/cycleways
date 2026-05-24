let catalogPromise = null;

export function loadCatalog() {
  if (catalogPromise) return catalogPromise;
  const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
  catalogPromise = fetch(`${base}public-data/route-catalog.json`)
    .then((r) => (r.ok ? r.json() : { version: 1, entries: [] }))
    .catch((err) => {
      console.warn("loadCatalog failed", err);
      return { version: 1, entries: [] };
    });
  return catalogPromise;
}

export function findCatalogEntryBySlug(catalog, slug) {
  return catalog?.entries?.find((e) => e.slug === slug) || null;
}
