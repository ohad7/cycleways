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
    ["journey", diagnostics.journey || "-"],
    ["bookmark", diagnostics.bookmark || "-"],
    ["time", diagnostics.journeyTime === null || diagnostics.journeyTime === undefined
      ? "-"
      : `${Math.round(Number(diagnostics.journeyTime) / 1000)}s`],
    ["stage", diagnostics.stage || "-"],
    ["mode", diagnostics.mode || "-"],
    ["geometry", diagnostics.geometryRole || "-"],
    ["pitch", `${fmt(diagnostics.pitch)} → ${fmt(diagnostics.appliedPitch)}`],
    ["zoom", `${fmt(diagnostics.zoom)} → ${fmt(diagnostics.appliedZoom)}`],
    ["fit", diagnostics.fitKind || "-"],
    ["focus", diagnostics.focusKind || "-"],
    ["target", fmt(diagnostics.headingTarget)],
    ["heading", fmt(diagnostics.heading)],
    ["tier", diagnostics.approachTier || "-"],
    ["intent", diagnostics.cameraIntent || "-"],
    ["owner", diagnostics.owner || "-"],
    ["transition", diagnostics.transitionState || "-"],
    ["anchor", fmt(diagnostics.riderAnchorY, 2)],
    ["viewport", diagnostics.viewport || "-"],
    ["fit count", diagnostics.fitCount ?? 0],
    [
      "visibility",
      diagnostics.validation
        ? diagnostics.validation.valid
          ? "ok"
          : `outside:${diagnostics.validation.outside?.length || 0}`
        : "-",
    ],
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
