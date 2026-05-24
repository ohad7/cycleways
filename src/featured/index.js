const metaModules = import.meta.glob("./*.meta.js", {
  eager: true,
  import: "meta",
});
const componentLoaders = import.meta.glob("./*.jsx");

function jsxPathFromMeta(metaPath) {
  return metaPath.replace(/\.meta\.js$/, ".jsx");
}

export const featuredRoutes = Object.entries(metaModules)
  .map(([metaPath, meta]) => {
    const jsxPath = jsxPathFromMeta(metaPath);
    const load = componentLoaders[jsxPath];
    return { meta, load };
  })
  .filter((entry) => entry.meta && entry.meta.slug && entry.load);

export function findFeaturedRoute(slug) {
  return featuredRoutes.find((entry) => entry.meta.slug === slug) || null;
}
