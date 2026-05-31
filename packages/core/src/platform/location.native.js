const SHARD_BASE_LOCATION = { href: "cycleways:///" };

export function getQueryParam() {
  return null;
}

export function hasQueryParam() {
  return false;
}

export function setUrlParam() {
  // Deep-link persistence is intentionally deferred until native routing UI.
}

export function removeUrlParam() {
  // Deep-link persistence is intentionally deferred until native routing UI.
}

export function getShardLoaderLocation() {
  return SHARD_BASE_LOCATION;
}
