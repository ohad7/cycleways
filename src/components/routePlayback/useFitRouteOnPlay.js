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

// Fires onRequestFit({ id, geometry, padding }) when playback starts fresh.
//   getMapEl   - () => element whose rect Mapbox pads against
//   getScopeEl - optional () => element to scope selector queries within
//   registry   - [{ selector, side? }] of obstruction overlays
export function useFitRouteOnPlay({
  isPlaying,
  currentTime,
  geometry,
  getMapEl,
  getScopeEl,
  registry,
  onRequestFit,
  gap = 16,
  freshStartSec = 0.25,
}) {
  const wasPlayingRef = useRef(false);
  const latestRef = useRef(null);
  latestRef.current = {
    currentTime,
    geometry,
    getMapEl,
    getScopeEl,
    registry,
    onRequestFit,
    gap,
    freshStartSec,
  };

  useEffect(() => {
    const latest = latestRef.current;
    const geometryLength = Array.isArray(latest.geometry) ? latest.geometry.length : 0;
    const fit = shouldFitOnPlayStart({
      wasPlaying: wasPlayingRef.current,
      isPlaying,
      currentTime: latest.currentTime,
      geometryLength,
      freshStartSec: latest.freshStartSec,
    });
    wasPlayingRef.current = isPlaying;
    if (!fit) return;
    const mapEl = latest.getMapEl?.();
    if (!mapEl) return;
    const padding = computeOverlayFitPadding({
      mapEl,
      registry: latest.registry,
      scopeEl: latest.getScopeEl?.(),
      gap: latest.gap,
    });
    latest.onRequestFit?.({
      id: `play-fit-${Date.now()}`,
      geometry: latest.geometry,
      padding,
    });
  }, [isPlaying]);
}
