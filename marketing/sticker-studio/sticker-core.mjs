export const STICKER_VIEWBOX = 1024;
export const QR_SIZE_UNITS = 190;
export const QR_QUIET_MODULES = 4;

export function mmToPixels(mm, dpi) {
  const size = Number(mm);
  const density = Number(dpi);
  if (!(size > 0) || !(density > 0)) throw new Error("Size and DPI must be positive numbers.");
  return Math.round((size / 25.4) * density);
}

export function resolveDestination({ kind, routeSlug = "", customUrl = "", origin = "https://cycleways.app" }) {
  const base = new URL(origin);
  if (kind === "home") return new URL("/", base).href;

  if (kind === "route") {
    const slug = routeSlug.trim().replace(/^\/+|\/+$/g, "");
    if (!slug) throw new Error("Enter a route slug.");
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) throw new Error("Route slugs may contain letters, numbers, and hyphens.");
    return new URL(`/routes/${slug}`, base).href;
  }

  if (kind === "custom") {
    let parsed;
    try {
      parsed = new URL(customUrl.trim());
    } catch {
      throw new Error("Enter a complete URL, including https://.");
    }
    const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !localHttp) throw new Error("Sticker destinations must use HTTPS.");
    return parsed.href;
  }

  throw new Error("Choose a destination type.");
}

export function captionLines(value, maxLines = 2) {
  const normalized = String(value || "").trim().replace(/\r/g, "");
  if (!normalized) return [];
  const explicit = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  if (explicit.length > maxLines) throw new Error(`Use no more than ${maxLines} caption lines.`);
  if (explicit.length > 1 || normalized.length <= 28) return explicit;

  const words = normalized.split(/\s+/);
  if (words.length === 1) return [normalized];
  let bestIndex = 1;
  let bestDifference = Infinity;
  for (let index = 1; index < words.length; index += 1) {
    const left = words.slice(0, index).join(" ");
    const right = words.slice(index).join(" ");
    const difference = Math.abs(left.length - right.length);
    if (difference < bestDifference) {
      bestDifference = difference;
      bestIndex = index;
    }
  }
  return [words.slice(0, bestIndex).join(" "), words.slice(bestIndex).join(" ")];
}

export function qrPrintMetrics(moduleCount, stickerSizeMm) {
  const modules = Number(moduleCount);
  const sizeMm = Number(stickerSizeMm);
  if (!(modules > 0) || !(sizeMm > 0)) throw new Error("QR modules and sticker size must be positive.");
  const qrMm = (QR_SIZE_UNITS / STICKER_VIEWBOX) * sizeMm;
  const moduleMm = qrMm / (modules + QR_QUIET_MODULES * 2);
  const level = moduleMm >= 0.4 ? "good" : moduleMm >= 0.33 ? "warning" : "risky";
  return { qrMm, moduleMm, level };
}

export function safeFilename({ rider, destinationKind, caption }) {
  const raw = `cycleways-${rider}-${destinationKind}-${caption || "sticker"}`
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9\u0590-\u05ff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return raw.slice(0, 72) || "cycleways-sticker";
}

export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]);
}

export function textDirection(value) {
  return /[\u0590-\u05ff]/.test(value) ? "rtl" : "ltr";
}
