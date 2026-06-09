// Overlay-aware route-fit padding.
//
// Mapbox fitBounds takes a rectangular { top, right, bottom, left } padding, so
// each obstructing overlay is assigned to a single map edge and contributes the
// depth it intrudes from that edge (plus a gap). Per edge we keep the largest
// intrusion. See plans/route-fit-on-play/design.md.

const EDGES = ["top", "right", "bottom", "left"];

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function nearestEdge(mapRect, rect) {
  const gaps = {
    top: rect.top - mapRect.top,
    bottom: mapRect.bottom - rect.bottom,
    left: rect.left - mapRect.left,
    right: mapRect.right - rect.right,
  };
  let best = "top";
  let bestGap = Infinity;
  for (const edge of EDGES) {
    if (gaps[edge] < bestGap) {
      bestGap = gaps[edge];
      best = edge;
    }
  }
  return best;
}

function insetForEdge(edge, mapRect, rect) {
  switch (edge) {
    case "top": return rect.bottom - mapRect.top;
    case "bottom": return mapRect.bottom - rect.top;
    case "left": return rect.right - mapRect.left;
    case "right": return mapRect.right - rect.left;
    default: return 0;
  }
}

export function resolveOverlayInsets({ mapRect, overlays = [], gap = 16, base = 24 }) {
  const result = { top: base, right: base, bottom: base, left: base };
  for (const overlay of overlays) {
    const rect = overlay?.rect;
    if (!rect || !rectsOverlap(mapRect, rect)) continue;
    const side = EDGES.includes(overlay.side) ? overlay.side : nearestEdge(mapRect, rect);
    const inset = Math.max(0, insetForEdge(side, mapRect, rect)) + gap;
    result[side] = Math.max(result[side], inset);
  }
  const maxV = (mapRect.bottom - mapRect.top) * 0.8;
  const maxH = (mapRect.right - mapRect.left) * 0.8;
  result.top = Math.min(result.top, maxV);
  result.bottom = Math.min(result.bottom, maxV);
  result.left = Math.min(result.left, maxH);
  result.right = Math.min(result.right, maxH);
  return result;
}

function isHidden(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return true;
  if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return true;
  const view = el.ownerDocument?.defaultView || window;
  const style = view.getComputedStyle(el);
  return style.display === "none" || style.visibility === "hidden";
}

// Measure obstruction overlays (resolved from a per-surface selector registry)
// against the map element and return overlay-aware fit padding.
//   mapEl   - element whose rect Mapbox pads against (the map container)
//   registry - [{ selector, side? }] of overlays to clear
//   scopeEl  - optional element to run selector queries within (default: mapEl)
export function computeOverlayFitPadding({ mapEl, registry = [], scopeEl, gap = 16, base = 24 }) {
  if (!mapEl) return { top: base, right: base, bottom: base, left: base };
  const mapRect = mapEl.getBoundingClientRect();
  const root = scopeEl || mapEl;
  const overlays = [];
  for (const entry of registry) {
    if (!entry?.selector || !root.querySelectorAll) continue;
    root.querySelectorAll(entry.selector).forEach((el) => {
      if (isHidden(el)) return;
      overlays.push({ rect: el.getBoundingClientRect(), side: entry.side });
    });
  }
  return resolveOverlayInsets({ mapRect, overlays, gap, base });
}
