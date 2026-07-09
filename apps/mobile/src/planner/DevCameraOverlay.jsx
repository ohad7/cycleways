import { StyleSheet, Text, View } from "react-native";
import { text } from "../theme/typography.js";

function fmt(value, digits = 1) {
  if (value === null || value === undefined) return "-";
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "-";
}

export default function DevCameraOverlay({ diagnostics }) {
  if (!diagnostics) return null;
  const rows = [
    ["stage", diagnostics.stage || "-"],
    ["mode", diagnostics.mode || "-"],
    ["pitch", fmt(diagnostics.pitch)],
    ["zoom", fmt(diagnostics.zoom)],
    ["fit", diagnostics.fitKind || "-"],
    ["focus", diagnostics.focusKind || "-"],
    ["target", fmt(diagnostics.headingTarget)],
    ["heading", fmt(diagnostics.heading)],
    ["tier", diagnostics.approachTier || "-"],
    ["intent", diagnostics.cameraIntent || "-"],
  ];
  return (
    <View pointerEvents="none" style={styles.root}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value} numberOfLines={1}>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    left: 12,
    top: 92,
    zIndex: 30,
    elevation: 30,
    minWidth: 132,
    borderRadius: 8,
    backgroundColor: "rgba(20, 24, 28, 0.82)",
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  label: {
    ...text.caption,
    color: "rgba(255,255,255,0.62)",
  },
  value: {
    ...text.captionStrong,
    color: "#fff",
    maxWidth: 74,
  },
});
