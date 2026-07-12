const DEFAULT_NATIVE_HREF = "cycleways:///";
const NATIVE_ROUTE_COLLECTIONS = new Set(["routes", "featured"]);
const CYCLEWAYS_WEB_HOSTS = new Set(["cycleways.app", "www.cycleways.app"]);

let nativeLocationHref = DEFAULT_NATIVE_HREF;

export function setNativeLocationHref(href) {
  nativeLocationHref = normalizeNativeHref(href);
  return nativeLocationHref;
}

export function getNativeLocationHref() {
  return nativeLocationHref;
}

export function getNativePathname(href = nativeLocationHref) {
  return pathnameFromUrl(nativeUrl(href));
}

export function getNativeRoutePath(href = nativeLocationHref) {
  const url = nativeUrl(href);
  if (!isSupportedRouteUrl(url)) return null;
  const segments = pathSegmentsFromUrl(url);
  const collection = segments[0] || "";
  if (!NATIVE_ROUTE_COLLECTIONS.has(collection)) return null;
  const slug = safeDecodeURIComponent(segments[1] || "");
  if (!slug) return null;
  return { collection, slug };
}

export function getNativeRouteToken(href = nativeLocationHref) {
  const url = nativeUrl(href);
  if (!isSupportedRouteUrl(url)) return null;
  const token = url.searchParams.get("route");
  return typeof token === "string" && token.length > 0 ? token : null;
}

export function createNativeRouteHref(routeParam, metadata = {}) {
  const url = new URL(DEFAULT_NATIVE_HREF);
  url.searchParams.set("route", routeParam);
  setOptionalSearchParam(url, "routeSource", metadata.source);
  setOptionalSearchParam(url, "routeCollection", metadata.collection);
  setOptionalSearchParam(url, "routeSlug", metadata.slug);
  setOptionalSearchParam(url, "routeName", metadata.name);
  return url.toString();
}

export function resetNativeLocationHref() {
  nativeLocationHref = DEFAULT_NATIVE_HREF;
  return nativeLocationHref;
}

export function getQueryParam(name) {
  return currentUrl().searchParams.get(name);
}

export function hasQueryParam(name) {
  return currentUrl().searchParams.has(name);
}

export function setUrlParam(name, value) {
  const url = currentUrl();
  if (value == null) {
    url.searchParams.delete(name);
  } else {
    url.searchParams.set(name, value);
  }
  nativeLocationHref = url.toString();
  return nativeLocationHref;
}

// Native has no history stack; a push behaves like a plain set.
export function pushUrlParam(name, value) {
  setUrlParam(name, value);
}

export function removeUrlParam(name) {
  return setUrlParam(name, null);
}

export function getShardLoaderLocation() {
  return { href: DEFAULT_NATIVE_HREF };
}

function currentUrl() {
  return new URL(nativeLocationHref);
}

function nativeUrl(href) {
  try {
    return new URL(String(href || DEFAULT_NATIVE_HREF), DEFAULT_NATIVE_HREF);
  } catch {
    return new URL(DEFAULT_NATIVE_HREF);
  }
}

function normalizeNativeHref(href) {
  if (!href) return DEFAULT_NATIVE_HREF;
  try {
    return new URL(String(href), DEFAULT_NATIVE_HREF).toString();
  } catch {
    return DEFAULT_NATIVE_HREF;
  }
}

function pathnameFromUrl(url) {
  const segments = pathSegmentsFromUrl(url);
  return segments.length > 0 ? `/${segments.join("/")}` : "/";
}

function pathSegmentsFromUrl(url) {
  const segments = url.pathname.split("/").filter(Boolean);
  if (isNativeCustomScheme(url.protocol) && url.host) {
    return [url.host, ...segments];
  }
  return segments;
}

function isNativeCustomScheme(protocol) {
  return protocol === "cycleways:" || protocol === "app.cycleways.mobile:";
}

function isSupportedRouteUrl(url) {
  if (isNativeCustomScheme(url.protocol)) return true;
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    CYCLEWAYS_WEB_HOSTS.has(url.host)
  );
}

function setOptionalSearchParam(url, name, value) {
  if (typeof value === "string" && value.length > 0) {
    url.searchParams.set(name, value);
  }
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
