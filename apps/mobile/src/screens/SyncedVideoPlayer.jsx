import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Slider from "@react-native-community/slider";
import YoutubePlayer from "react-native-youtube-iframe";
import Icon from "../planner/Icon.jsx";

// YouTube player (WebView-backed) for the route detail stage. Mirrors the
// mobile-web featured player: the landscape 16:9 source is CROPPED into a taller
// frame (the player is oversized and the frame clips the sides), YouTube's own
// chrome is hidden, and we draw our own play/scrub/time bar. Reports playback
// time while playing so a parent can drive the synced route cursor.
//
// variant "primary": cropped + custom controls. variant "pip": small, no
// controls (the corner picture-in-picture).
const HIDE_YT_CHROME = {
  controls: false,
  modestbranding: true,
  rel: false,
  iv_load_policy: 3,
  preventFullScreen: true,
};

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? "0" : ""}${r}`;
}

export default function SyncedVideoPlayer({
  youtubeId,
  duration = 0,
  frameWidth,
  frameHeight,
  variant = "primary",
  onTime,
}) {
  const playerRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const pollRef = useRef(null);
  const scrubbingRef = useRef(false);
  scrubbingRef.current = scrubbing;

  useEffect(() => {
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
        if (Number.isFinite(t)) {
          if (!scrubbingRef.current) setCurrentTime(t);
          onTime?.(t);
        }
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
  }, [playing, onTime]);

  const onChangeState = useCallback((state) => {
    // Only mirror real play/pause transitions. "unstarted"/"buffering"/"cued"
    // are transient — treating "unstarted" as a pause would immediately undo the
    // play we just requested (the video would never start).
    if (state === "playing") setPlaying(true);
    else if (state === "paused" || state === "ended") setPlaying(false);
  }, []);

  const seekTo = useCallback(
    (seconds) => {
      playerRef.current?.seekTo?.(seconds, true);
      setCurrentTime(seconds);
      onTime?.(seconds);
    },
    [onTime],
  );

  // Crop math: keep the source 16:9 while filling the (taller) frame height, so
  // the player is wider than the frame; center it and clip the sides.
  const playerHeight = Math.round(frameHeight);
  const playerWidth =
    variant === "primary"
      ? Math.round(playerHeight * (16 / 9))
      : Math.round(frameWidth);

  return (
    <View style={[styles.frame, { width: frameWidth, height: frameHeight }]}>
      <View style={styles.cropCenter}>
        <YoutubePlayer
          ref={playerRef}
          height={playerHeight}
          width={playerWidth}
          play={playing}
          videoId={youtubeId}
          onChangeState={onChangeState}
          initialPlayerParams={HIDE_YT_CHROME}
          // iOS blocks programmatic play unless the WebView is allowed to play
          // media without an in-WebView user gesture. Our play button lives in
          // RN, so this is required for the custom controls to start playback.
          webViewProps={{
            allowsInlineMediaPlayback: true,
            mediaPlaybackRequiresUserAction: false,
          }}
        />
      </View>

      {variant === "primary" ? (
        <View style={styles.controls} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={playing ? "השהה" : "נגן"}
            onPress={() => setPlaying((p) => !p)}
            style={styles.playBtn}
          >
            <Icon name={playing ? "pause" : "play"} size={20} color="#fff" />
          </Pressable>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={duration > 0 ? duration : 1}
            value={Math.min(currentTime, duration || currentTime)}
            minimumTrackTintColor="#ffffff"
            maximumTrackTintColor="rgba(255,255,255,0.4)"
            thumbTintColor="#ffffff"
            onSlidingStart={() => setScrubbing(true)}
            onValueChange={(v) => setCurrentTime(v)}
            onSlidingComplete={(v) => {
              setScrubbing(false);
              seekTo(v);
            }}
          />
          <Text style={styles.time}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: "hidden",
    borderRadius: 12,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  cropCenter: { alignItems: "center", justifyContent: "center" },
  controls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row-reverse",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  playBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  slider: { flex: 1, height: 34 },
  time: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
