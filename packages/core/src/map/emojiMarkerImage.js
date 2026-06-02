// Rasterize POI type emoji into Mapbox marker images.
//
// Mapbox GL JS renders `text-field` glyphs through a 16-bit glyph atlas and
// throws "glyphs > 65535 not supported" for astral-plane code points — which is
// most emoji (🌳 U+1F333, 🏖️ U+1F3D6, …). Drawing the emoji to a canvas and
// registering it as an `icon-image` sidesteps the glyph system entirely and
// renders full-color emoji on every browser.
//
// Browser-only (needs `document`/canvas). Callers guard for non-browser envs.

import {
  POI_TYPES,
  isWarningType,
  poiEmoji,
  poiMarkerIconName,
} from "../data/poiTypes.js";

// Render a single emoji glyph (transparent background) into ImageData.
// The colored disc behind it comes from the separate circle layer, so this
// image only carries the glyph.
export function createEmojiMarkerImageData(emoji, { size = 22, pixelRatio = 2 } = {}) {
  if (typeof document === "undefined") return null;
  const px = Math.max(1, Math.round(size * pixelRatio));
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, px, px);
  ctx.font = `${Math.round(px * 0.72)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Nudge baseline slightly so the glyph sits centered in the disc.
  ctx.fillText(emoji, px / 2, px / 2 + px * 0.04);
  return ctx.getImageData(0, 0, px, px);
}

// Register a per-type emoji image for every non-warning POI type on the map,
// under the `icon-image` name from poiMarkerIconName. Idempotent: skips images
// already present (e.g. after a style reload re-runs the loader).
export function registerPoiEmojiImages(map, options = {}) {
  if (!map || typeof document === "undefined") return;
  const pixelRatio = options.pixelRatio ?? 2;
  const size = options.size ?? 22;
  for (const type of POI_TYPES) {
    if (isWarningType(type)) continue;
    const name = poiMarkerIconName(type);
    if (typeof map.hasImage === "function" && map.hasImage(name)) continue;
    const imageData = createEmojiMarkerImageData(poiEmoji(type), { size, pixelRatio });
    if (!imageData) continue;
    try {
      map.addImage(name, imageData, { pixelRatio });
    } catch {
      // addImage throws if the id already exists (race with another loader); ignore.
    }
  }
}
