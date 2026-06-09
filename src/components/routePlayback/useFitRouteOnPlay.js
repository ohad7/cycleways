import { useEffect, useRef } from "react";
import { computeOverlayFitPadding } from "../../map/routeFitPadding.js";

// True only on a false->true play transition that starts at the beginning of a
// real route. Resumes (currentTime past the threshold) and non-transitions are
// excluded. See plans/route-fit-on-play/design.md.
export function shouldFitOnPlayStart({
  wasPlaying,
  isPlaying,
  currentTime,
  geometryLength,
  freshStartSec = 0.25,
}) {
  if (!isPlaying || wasPlaying) return false;
  if (!(geometryLength >= 2)) return false;
  return Number(currentTime) <= freshStartSec;
}
