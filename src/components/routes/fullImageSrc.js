import { routeImageSrc } from "./routeImageSrc.js";

const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:/i;

export function remoteAssetBase() {
  if (typeof window === "undefined") return "";
  return String(window.CYCLEWAYS_REMOTE_ASSET_BASE || "")
    .trim()
    .replace(/\/+$/, "");
}

export function fullImageSrc(item) {
  const photo = String(item?.photo || "").trim();
  const thumbnail = String(item?.thumbnail || "").trim();
  const base = remoteAssetBase();

  if (photo && base) {
    if (ABSOLUTE_URL_RE.test(photo) || photo.startsWith("//")) return photo;
    if (!photo.startsWith("/")) {
      return `${base}/${photo.replace(/^\.?\//, "")}`;
    }
  }

  return routeImageSrc(thumbnail || photo);
}

