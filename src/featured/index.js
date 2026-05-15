const metaModules = import.meta.glob("./*.jsx", {
  eager: true,
  import: "meta",
});
const componentLoaders = import.meta.glob("./*.jsx");

export const featuredRoutes = Object.entries(metaModules)
  .map(([path, meta]) => ({ meta, load: componentLoaders[path] }))
  .filter((entry) => entry.meta && entry.meta.slug);

export function findFeaturedRoute(slug) {
  return featuredRoutes.find((entry) => entry.meta.slug === slug) || null;
}
