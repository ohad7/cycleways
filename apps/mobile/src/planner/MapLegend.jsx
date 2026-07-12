import { Dimensions, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { palette, radius } from "./theme.js";
import { text } from "../theme/typography.js";

// Road-type legend (same labels/colors as the desktop map-corner legend).
const LEGEND = [
  { color: "rgb(101, 170, 162)", label: "שביל סלול" },
  { color: "rgb(174, 144, 103)", label: "שביל עפר" },
  { color: "rgb(138, 147, 158)", label: "כביש" },
];

const SCREEN_H = Dimensions.get("window").height;
// Rough legend height (title + 3 rows + padding); used to clamp it on screen
// when the drawer is dragged to full and its top edge nears the status bar.
const LEGEND_BLOCK = 96;

// Bottom-left map legend that rides just above the planner drawer as it is
// dragged (via the sheet's animated top-edge position), mirroring the desktop
// bottom-left legend. Toggled open/closed by the map-controls legend button.
export default function MapLegend({ open, sheetTop }) {
  const insets = useSafeAreaInsets();
  const animatedStyle = useAnimatedStyle(() => {
    // sheetTop = Y of the drawer's top edge from the screen top. The legend's
    // bottom offset is the drawer height (SCREEN_H - sheetTop) plus a small gap,
    // clamped so it never slides under the status bar at the full snap.
    const raw = SCREEN_H - sheetTop.value + 8;
    const maxBottom = SCREEN_H - insets.top - LEGEND_BLOCK;
    return { bottom: Math.min(raw, maxBottom) };
  });

  if (!open) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, animatedStyle]}
      accessibilityLabel="מקרא סוגי דרכים"
    >
      <View style={styles.box}>
        <Text style={styles.title}>סוגי דרכים</Text>
        {LEGEND.map((item) => (
          <View key={item.label} style={styles.row}>
            <View style={[styles.swatch, { backgroundColor: item.color }]} />
            <Text style={styles.label}>{item.label}</Text>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 14 },
  box: {
    backgroundColor: "rgba(255,255,255,0.97)",
    borderRadius: radius.md,
    padding: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  title: {
    ...text.label,
    color: palette.ink,
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 6,
  },
  row: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  swatch: { width: 16, height: 4, borderRadius: 2 },
  label: {
    ...text.label,
    color: palette.ink,
    writingDirection: "rtl",
  },
});
