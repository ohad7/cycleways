const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:/i;

export function routeImageSrc(src) {
  const value = String(src || "").trim();
  if (!value) return "";
  if (value.startsWith("/") || ABSOLUTE_URL_RE.test(value)) return value;
  const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
  return `${base}${value.replace(/^\.?\//, "")}`;
}
