import { useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
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
export default function MapControls({ onLocate, onFit, following, sheetTopY }) {
  const { height } = useWindowDimensions();
  const [legendOpen, setLegendOpen] = useState(false);
  // Ride just above the sheet's top edge at any snap; fade out as the sheet
  // covers the lower screen (so the buttons never sit behind the full sheet).
  const followStyle = useAnimatedStyle(() => {
    const top = sheetTopY?.value ?? height;
    return {
      bottom: Math.max(12, height - top + 12),
      opacity: interpolate(top, [140, 240], [0, 1], Extrapolation.CLAMP),
    };
  });
  return (
    <Animated.View pointerEvents="box-none" style={[styles.wrap, followStyle]}>
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
    </Animated.View>
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
