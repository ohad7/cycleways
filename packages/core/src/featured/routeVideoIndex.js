import { getJsonAsset } from "../platform/assets.js";

// Platform-agnostic route-video index loader. Resolves the index + per-route
// keyframe files through the shared asset adapter, so the same code works on
// the web (fetched from the deployed site) and in the native app (bundled
// offline assets). Web and native each provide their own getJsonAsset.

let routeVideoIndexPromise = null;

export function loadRouteVideoIndex() {
  if (!routeVideoIndexPromise) {
    routeVideoIndexPromise = getJsonAsset("public-data/route-videos/index.json")
      .catch(() => ({ routes: {} }));
  }
  return routeVideoIndexPromise;
}

export async function hasRouteVideo(slug) {
  const index = await loadRouteVideoIndex();
  return Boolean(index?.routes?.[slug]);
}

export async function loadRouteVideoKeyframes(filename) {
  return getJsonAsset(`public-data/route-videos/${filename}`);
}
