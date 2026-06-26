import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Icon from "./Icon.jsx";
import { palette, radius } from "./theme.js";

// Road-type legend (same labels/colors as the old map-corner legend box).
const LEGEND = [
  { color: "rgb(101, 170, 162)", label: "שביל סלול" },
  { color: "rgb(174, 144, 103)", label: "שביל עפר" },
  { color: "rgb(138, 147, 158)", label: "כביש" },
];

// Native floating map controls: a vertical stack of circular buttons (locate,
// fit-to-route, layers) above the sheet peek. The layers button toggles a
// compact road-type legend popover, replacing the old always-on legend box.
export default function MapControls({ onLocate, onFit, following }) {
  const [legendOpen, setLegendOpen] = useState(false);
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      {legendOpen ? (
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>סוגי דרכים</Text>
          {LEGEND.map((item) => (
            <View key={item.label} style={styles.legendRow}>
              <View style={[styles.swatch, { backgroundColor: item.color }]} />
              <Text style={styles.legendLabel}>{item.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <CircleButton
        accessibilityLabel="סוגי דרכים"
        icon="layers-outline"
        active={legendOpen}
        onPress={() => setLegendOpen((v) => !v)}
      />
      <CircleButton
        accessibilityLabel="התאם מסלול"
        icon="scan-outline"
        onPress={onFit}
      />
      <CircleButton
        accessibilityLabel="מיקום נוכחי"
        icon={following ? "navigate" : "navigate-outline"}
        active={following}
        onPress={onLocate}
      />
    </View>
  );
}

function CircleButton({ accessibilityLabel, icon, onPress, active }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        active ? styles.btnActive : null,
        pressed ? styles.btnPressed : null,
      ]}
    >
      <Icon
        name={icon}
        size={20}
        color={active ? palette.white : palette.teal}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    right: 14,
    // Sit above the sheet peek snap (~16% of an ~844pt screen ≈ 135pt).
    bottom: 160,
    alignItems: "flex-end",
    gap: 10,
  },
  btn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(255,255,255,0.96)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  btnActive: {
    backgroundColor: palette.teal,
  },
  btnPressed: {
    opacity: 0.85,
  },
  legend: {
    backgroundColor: "rgba(255,255,255,0.97)",
    borderRadius: radius.md,
    padding: 10,
    marginBottom: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  legendTitle: {
    color: palette.ink,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 6,
  },
  legendRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  swatch: { width: 16, height: 4, borderRadius: 2 },
  legendLabel: {
    color: palette.ink,
    fontSize: 11,
    fontWeight: "600",
    writingDirection: "rtl",
  },
});
