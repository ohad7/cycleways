export const SNAPS = ["full", "half", "peek"];
export const PEEK_PX = 164;
const TOP_GAP_PX = 12;
const FLING_LOOKAHEAD_MS = 300;

export function offsetsForHeight(shellHeight) {
  const h = Math.max(shellHeight, 0);
  return {
    full: Math.min(TOP_GAP_PX, h),
    half: Math.round(h * 0.5),
    peek: Math.max(h - PEEK_PX, 0),
  };
}

export function resolveSnap(offsetPx, velocityPxPerMs, offsets) {
  const projected = offsetPx + velocityPxPerMs * FLING_LOOKAHEAD_MS;
  let best = "peek";
  let bestDistance = Infinity;
  for (const snap of SNAPS) {
    const distance = Math.abs(offsets[snap] - projected);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = snap;
    }
  }
  return best;
}

export function nextSnap(snap) {
  if (snap === "peek") return "half";
  if (snap === "half") return "full";
  if (snap === "full") return "peek";
  return "half";
}
