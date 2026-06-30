import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import YoutubePlayer from "react-native-youtube-iframe";

// YouTube player (WebView-backed) that reports its playback time while playing,
// so a parent can drive a synced route cursor. Polls the player ref's
// getCurrentTime() at ~4 Hz; stops polling when paused/ended.
export default function SyncedVideoPlayer({
  youtubeId,
  height = 220,
  width,
  onTime,
  onPlayingChange,
}) {
  const playerRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    onPlayingChange?.(playing);
    if (!playing) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return undefined;
    }
    pollRef.current = setInterval(async () => {
      try {
        const t = await playerRef.current?.getCurrentTime?.();
        if (Number.isFinite(t)) onTime?.(t);
      } catch {
        // player not ready / transient — ignore this tick
      }
    }, 250);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [playing, onTime, onPlayingChange]);

  const onChangeState = useCallback((state) => {
    if (state === "playing") setPlaying(true);
    else if (state === "paused" || state === "ended" || state === "unstarted") {
      setPlaying(false);
    }
  }, []);

  return (
    <View style={[styles.wrap, { height }]}>
      <YoutubePlayer
        ref={playerRef}
        height={height}
        {...(Number.isFinite(width) ? { width } : null)}
        play={playing}
        videoId={youtubeId}
        onChangeState={onChangeState}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", borderRadius: 12, overflow: "hidden", backgroundColor: "#000" },
});
