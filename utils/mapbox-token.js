const TOKEN_STORAGE_KEY = "cycleways.mapboxToken";

export function getMapboxToken() {
  const globalToken = window.CYCLEWAYS_MAPBOX_TOKEN;
  if (typeof globalToken === "string" && globalToken.trim()) {
    return globalToken.trim();
  }

  const metaToken = document.querySelector('meta[name="mapbox-token"]')?.content;
  if (typeof metaToken === "string" && metaToken.trim()) {
    return metaToken.trim();
  }

  try {
    const storedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (storedToken?.trim()) {
      return storedToken.trim();
    }
  } catch {
    // Local storage can be unavailable in some browser privacy modes.
  }

  return "";
}

export function requireMapboxToken() {
  const token = getMapboxToken();
  if (!token) {
    throw new Error(
      `Mapbox token is not configured. Set window.CYCLEWAYS_MAPBOX_TOKEN, ` +
        `add a meta[name="mapbox-token"] tag, or set localStorage ${TOKEN_STORAGE_KEY}.`,
    );
  }
  return token;
}
