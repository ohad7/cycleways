// Derive the three slug sets that drive the Discover map from the list's scroll
// viewport. Pure: given the catalog-ordered slug list and the set of slugs whose
// cards currently intersect the viewport, return:
//
//   visibleSlugs  – cards intersecting the viewport (drawn bright)
//   ghostSlugs    – the slug just before the first visible and just after the
//                   last visible (drawn faint; 0–2 entries, none at list ends)
//   prefetchSlugs – visibleSlugs ∪ ghostSlugs ∪ up to `lookahead` slugs beyond
//                   each ghost (drives lazy geometry loading)
//
// All three preserve catalog order.
export function deriveViewportSets(orderedSlugs, intersecting, { lookahead = 2 } = {}) {
  const order = Array.isArray(orderedSlugs) ? orderedSlugs : [];
  const hit = intersecting instanceof Set ? intersecting : new Set(intersecting || []);

  const visibleSlugs = order.filter((slug) => hit.has(slug));
  if (visibleSlugs.length === 0) {
    return { visibleSlugs: [], ghostSlugs: [], prefetchSlugs: [] };
  }

  const first = order.indexOf(visibleSlugs[0]);
  const last = order.indexOf(visibleSlugs[visibleSlugs.length - 1]);

  const ghostSlugs = [];
  if (first - 1 >= 0) ghostSlugs.push(order[first - 1]);
  if (last + 1 < order.length) ghostSlugs.push(order[last + 1]);

  const start = Math.max(0, first - 1 - lookahead);
  const end = Math.min(order.length - 1, last + 1 + lookahead);
  const prefetchSlugs = order.slice(start, end + 1);

  return { visibleSlugs, ghostSlugs, prefetchSlugs };
}
