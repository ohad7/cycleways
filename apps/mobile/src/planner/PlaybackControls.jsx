import { View, Pressable, Text, StyleSheet } from "react-native";
import Slider from "@react-native-community/slider";
import { palette, radius } from "./theme.js";

function formatTime(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// Native equivalent of the web RoutePlaybackControls: play/pause + scrub the
// route-preview marker. Bound to the shared playback engine.
export default function PlaybackControls({
  isPlaying,
  isReady,
  currentTime,
  duration,
  onTogglePlayback,
  onSeekToFraction,
}) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const fraction = safeDuration > 0 ? currentTime / safeDuration : 0;
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? "השהה מסלול" : "נגן מסלול"}
        testID="playback-toggle"
        disabled={!isReady}
        onPress={onTogglePlayback}
        style={[styles.toggle, !isReady ? styles.disabled : null]}
      >
        <Text style={styles.glyph}>{isPlaying ? "❚❚" : "▶"}</Text>
      </Pressable>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={1}
        value={fraction}
        onValueChange={onSeekToFraction}
        disabled={!isReady || safeDuration <= 0}
        minimumTrackTintColor={palette.accent ?? "#1976c9"}
        maximumTrackTintColor={palette.line}
      />
      <Text style={styles.time}>
        {formatTime(currentTime)} / {formatTime(safeDuration)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row-reverse", alignItems: "center", gap: 10, paddingVertical: 8 },
  toggle: {
    width: 40, height: 40, borderRadius: radius.md,
    alignItems: "center", justifyContent: "center", backgroundColor: palette.cream,
  },
  disabled: { opacity: 0.4 },
  glyph: { fontSize: 15, color: palette.ink },
  slider: { flex: 1, height: 40 },
  time: { fontSize: 12, color: palette.muted, minWidth: 72, textAlign: "left" },
});
