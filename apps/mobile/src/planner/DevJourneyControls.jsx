import { Pressable, StyleSheet, Text, View } from "react-native";
import { text } from "../theme/typography.js";

export default function DevJourneyControls({ playback, onReplay, onPauseResume, onStep }) {
  if (!playback || playback.mode !== "cam") return null;
  return (
    <View style={styles.root}>
      <Text style={styles.title} numberOfLines={1}>
        {playback.journey} · {playback.bookmark}
      </Text>
      <Text style={styles.status}>
        {playback.completed ? "HOLD" : playback.paused ? "PAUSED" : "1×"}
        {Number.isFinite(playback.timestamp) ? ` · ${(playback.timestamp / 1000).toFixed(0)}s` : ""}
      </Text>
      <View style={styles.row}>
        <Control label="Replay" onPress={onReplay} />
        <Control
          label={playback.paused ? "Resume" : "Pause"}
          onPress={onPauseResume}
          disabled={playback.completed}
        />
        <Control label="Step" onPress={onStep} disabled={playback.completed} />
      </View>
    </View>
  );
}

function Control({ label, onPress, disabled = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`CAM: ${label}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled ? styles.disabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 118,
    zIndex: 31,
    elevation: 31,
    borderRadius: 10,
    backgroundColor: "rgba(20, 24, 28, 0.9)",
    padding: 10,
  },
  title: { ...text.captionStrong, color: "#fff" },
  status: { ...text.caption, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  row: { flexDirection: "row", gap: 8, marginTop: 8 },
  button: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#5f8",
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  buttonText: { ...text.captionStrong, color: "#fff" },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
});

