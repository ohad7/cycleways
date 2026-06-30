import { getNativeRoutePath } from "@cycleways/core/platform/location.native.js";

// Maps a launch / deep-link href to the initial navigation target. Catalog
// route links (routes/<slug>, featured/<slug>) open the RouteDetail screen with
// the slug; everything else opens the Discover front page.
export function launchTargetFromHref(href) {
  const routePath = getNativeRoutePath(href);
  if (routePath?.slug) {
    return { screen: "RouteDetail", params: { slug: routePath.slug } };
  }
  return { screen: "Discover", params: undefined };
}
