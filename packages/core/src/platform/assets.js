// Web asset transport. Resolves LOGICAL asset paths (a relative file path plus
// an optional base) to URLs on the deployed site and fetches them. A React
// Native app provides a sibling `assets.native.js` that resolves the same
// logical paths against bundled assets. Keeps the rest of core free of
// fetch / import.meta / window.location specifics.

export function resolveAssetPath(filePath, basePath = null) {
  const path = String(filePath);
  if (!basePath || path.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return path;
  }
  const base = String(basePath).split("?")[0];
  const lastSlash = base.lastIndexOf("/");
  if (lastSlash < 0) {
    return path;
  }
  return `${base.slice(0, lastSlash + 1)}${path}`;
}

function siteBase() {
  return (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
}

// JSON assets injected by a host (the native app's WebView) keyed by logical
// path. When present, getJsonAsset returns the injected value without a network
// fetch — this is how the bundled, offline-embedded featured page gets its data.
export function getInjectedJsonAsset(filePath) {
  const injected =
    typeof globalThis !== "undefined" ? globalThis.__CW_ASSETS__ : null;
  const stablePath = typeof filePath === "string"
    ? filePath.split("#")[0].split("?")[0]
    : filePath;
  if (
    injected &&
    typeof filePath === "string" &&
    (Object.prototype.hasOwnProperty.call(injected, filePath) ||
      Object.prototype.hasOwnProperty.call(injected, stablePath))
  ) {
    return Object.prototype.hasOwnProperty.call(injected, filePath)
      ? injected[filePath]
      : injected[stablePath];
  }
  return undefined;
}

// JSON asset resolved relative to a manifest base (segments, network, manifests).
export async function getJsonAsset(filePath, { basePath = null, ...fetchOptions } = {}) {
  const injected = getInjectedJsonAsset(filePath);
  if (injected !== undefined) return injected;
  const assetPath = resolveAssetPath(filePath, basePath);
  const requestPath =
    assetPath.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(assetPath)
      ? assetPath
      : `${siteBase()}${assetPath}`;
  const response = await fetch(requestPath, fetchOptions);
  if (!response.ok) {
    throw new Error(`${assetPath}: HTTP ${response.status} ${response.statusText}`);
  }
  const contentType = response.headers?.get?.("content-type") || "";
  if (/text\/html/i.test(contentType)) {
    throw new Error(`${assetPath}: expected JSON asset but received HTML from ${requestPath}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${assetPath}: failed to parse JSON asset: ${error.message}`);
  }
}

// Binary asset (a routing shard) resolved relative to a base href.
export async function getBinaryAsset(
  relativePath,
  { baseHref, sha256, ...fetchOptions } = {},
) {
  const url = new URL(relativePath, baseHref);
  if (sha256) {
    url.searchParams.set("h", sha256);
  }
  const response = await fetch(url, fetchOptions);
  if (!response.ok) {
    throw new Error(
      `${relativePath}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  return response.arrayBuffer();
}
