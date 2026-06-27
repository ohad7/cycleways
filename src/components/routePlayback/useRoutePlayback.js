import { useCallback, useRef, useState } from "react";
import {
  useSyntheticRoutePlaybackEngine,
  MAP_PLAYBACK_BORING_RATE,
  MAP_PLAYBACK_DURATION_SCALE,
  MAP_PLAYBACK_PREVIEW_MAX_FRACTION,
  MAP_PLAYBACK_PREVIEW_MAX_METERS,
} from "@cycleways/core/ui/routePlaybackEngine.js";

export const MAP_PLAYBACK_ROUTE_FIT_PADDING = Object.freeze({
  top: 24, right: 24, bottom: 108, left: 24,
});

export function useSyntheticRoutePlayback(options) {
  const engine = useSyntheticRoutePlaybackEngine(options);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const scrubbingRef = useRef(false);
  const wasPlayingRef = useRef(false);

  const onScrubStart = useCallback((event) => {
    if (event?.currentTarget?.setPointerCapture && Number.isFinite(event.pointerId)) {
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    }
    scrubbingRef.current = true;
    setIsScrubbing(true);
    wasPlayingRef.current = engine.isPlaying;
    if (engine.isPlaying) engine.pause();
  }, [engine]);

  const onScrubChange = useCallback((event) => {
    engine.seekToTime(event.currentTarget.value);
  }, [engine]);

  const onScrubEnd = useCallback((event) => {
    if (event?.currentTarget?.releasePointerCapture && Number.isFinite(event.pointerId)) {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    }
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    setIsScrubbing(false);
    if (wasPlayingRef.current) engine.play();
    wasPlayingRef.current = false;
  }, [engine]);

  return { ...engine, isScrubbing, onScrubStart, onScrubChange, onScrubEnd };
}

export {
  MAP_PLAYBACK_BORING_RATE,
  MAP_PLAYBACK_DURATION_SCALE,
  MAP_PLAYBACK_PREVIEW_MAX_FRACTION,
  MAP_PLAYBACK_PREVIEW_MAX_METERS,
};
