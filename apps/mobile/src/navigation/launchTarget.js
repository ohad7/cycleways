import {
  getNativeRoutePath,
  getNativeRouteToken,
} from "@cycleways/core/platform/location.native.js";

// Maps a launch / deep-link href to the initial navigation target. Catalog
// paths open RouteDetail, shared ?route= tokens open Build, and everything else
// opens the Discover front page.
export function launchTargetFromHref(href) {
  const routePath = getNativeRoutePath(href);
  if (routePath?.slug) {
    return { screen: "RouteDetail", params: { slug: routePath.slug } };
  }
  const routeToken = getNativeRouteToken(href);
  if (routeToken) {
    return { screen: "Build", params: { routeToken } };
  }
  return { screen: "Discover", params: undefined };
}
