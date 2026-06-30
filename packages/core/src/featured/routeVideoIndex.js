let routeVideoIndexPromise = null;

export function loadRouteVideoIndex() {
  if (!routeVideoIndexPromise) {
    const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
    routeVideoIndexPromise = fetch(`${base}public-data/route-videos/index.json`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : { routes: {} }))
      .catch(() => ({ routes: {} }));
  }
  return routeVideoIndexPromise;
}

export async function hasRouteVideo(slug) {
  const index = await loadRouteVideoIndex();
  return Boolean(index?.routes?.[slug]);
}

export async function loadRouteVideoKeyframes(filename) {
  const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
  const response = await fetch(`${base}public-data/route-videos/${filename}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`keyframes ${filename}: HTTP ${response.status}`);
  return response.json();
}
