// Web implementation of the location/URL platform service. App orchestration
// reads/writes query params through this module instead of touching
// window.location / window.history directly, so a future React Native app can
// provide a sibling `location.native.js` (deep-link params) — Metro resolves
// `.native.js` automatically, with no web change needed.

export function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function hasQueryParam(name) {
  return new URLSearchParams(window.location.search).has(name);
}

// Updates a query param without navigating (history.replaceState). A null/
// undefined value deletes the param.
export function setUrlParam(name, value) {
  const url = new URL(window.location.href);
  if (value == null) {
    url.searchParams.delete(name);
  } else {
    url.searchParams.set(name, value);
  }
  window.history.replaceState(null, "", url.toString());
}

export function removeUrlParam(name) {
  setUrlParam(name, null);
}

// Like setUrlParam but creates a history entry (history.pushState), so the
// browser back button can step out of a user-initiated navigation (e.g.
// selecting a Discover route).
export function pushUrlParam(name, value) {
  const url = new URL(window.location.href);
  if (value == null) {
    url.searchParams.delete(name);
  } else {
    url.searchParams.set(name, value);
  }
  window.history.pushState(null, "", url.toString());
}

// The base location the routing-shard fetch loader resolves shard URLs against.
export function getShardLoaderLocation() {
  return window.location;
}

// Preserve the current web origin (including localhost during development).
// Production is already hosted at the canonical public share origin.
export function getShareLocation() {
  return window.location;
}
