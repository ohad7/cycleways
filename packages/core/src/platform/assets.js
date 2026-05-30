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

// JSON asset resolved relative to a manifest base (segments, network, manifests).
export async function getJsonAsset(filePath, { basePath = null, ...fetchOptions } = {}) {
  const assetPath = resolveAssetPath(filePath, basePath);
  const requestPath =
    assetPath.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(assetPath)
      ? assetPath
      : `${siteBase()}${assetPath}`;
  const response = await fetch(requestPath, fetchOptions);
  if (!response.ok) {
    throw new Error(`${assetPath}: HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
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
