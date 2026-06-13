const DEFAULT_NATIVE_HREF = "cycleways:///";

let nativeLocationHref = DEFAULT_NATIVE_HREF;

export function setNativeLocationHref(href) {
  nativeLocationHref = normalizeNativeHref(href);
  return nativeLocationHref;
}

export function getNativeLocationHref() {
  return nativeLocationHref;
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

function normalizeNativeHref(href) {
  if (!href) return DEFAULT_NATIVE_HREF;
  try {
    return new URL(String(href), DEFAULT_NATIVE_HREF).toString();
  } catch {
    return DEFAULT_NATIVE_HREF;
  }
}
