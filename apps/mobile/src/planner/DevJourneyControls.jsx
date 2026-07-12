import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { text } from "../theme/typography.js";
import { journeyLifecycleLabel } from "../navigation/journeyHarnessState.js";

export default function DevJourneyControls({ playback, onReplay, onPauseResume, onStep }) {
  const [minimized, setMinimized] = useState(true);
  const playbackKey = `${playback?.journey || ""}:${playback?.bookmarkId || ""}`;
  useEffect(() => {
    setMinimized(true);
  }, [playbackKey]);
  if (!playback || playback.mode !== "cam") return null;
  const waitingForStart = playback.lifecycle === "waiting-for-start";
  if (minimized) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="CAM: show playback controls"
        onPress={() => setMinimized(false)}
        style={[styles.root, styles.rootMinimized, waitingForStart ? styles.rootWaiting : null]}
      >
        <Text style={styles.minimizedText} numberOfLines={1}>
          CAM · {journeyLifecycleLabel(playback)}
        </Text>
        <Text style={styles.toggleText}>Show</Text>
      </Pressable>
    );
  }
  return (
    <View style={[styles.root, waitingForStart ? styles.rootWaiting : null]}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={1}>
          {playback.journey} · {playback.bookmark}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="CAM: minimize playback controls"
          onPress={() => setMinimized(true)}
          hitSlop={8}
        >
          <Text style={styles.toggleText}>Hide</Text>
        </Pressable>
      </View>
      <Text style={styles.status}>
        {journeyLifecycleLabel(playback)}
        {Number.isFinite(playback.timestamp) ? ` · ${(playback.timestamp / 1000).toFixed(0)}s` : ""}
      </Text>
      {playback.expectedStage ? (
        <Text style={styles.expectation}>Expect: {playback.expectedStage}</Text>
      ) : null}
      {waitingForStart ? null : (
        <View style={styles.row}>
          <Control label="Replay from intro" onPress={onReplay} />
          <Control
            label={playback.paused ? "Resume" : "Pause"}
            onPress={onPauseResume}
            disabled={playback.completed}
          />
          <Control label="Step" onPress={onStep} disabled={playback.completed} />
        </View>
      )}
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
  rootWaiting: {
    top: 44,
    bottom: undefined,
  },
  rootMinimized: {
    left: 12,
    right: undefined,
    maxWidth: "78%",
    paddingVertical: 7,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { ...text.captionStrong, color: "#fff", flex: 1 },
  minimizedText: { ...text.captionStrong, color: "#fff", flexShrink: 1 },
  toggleText: { ...text.captionStrong, color: "#8ee6ae" },
  status: { ...text.caption, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  expectation: { ...text.caption, color: "#9fe8ba", marginTop: 2 },
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
