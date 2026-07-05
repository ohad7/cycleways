import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "./Icon.jsx";
import { palette } from "./theme.js";

// Native floating map controls: two circular buttons at the top-right — my
// location and the legend open/close toggle. Same pair (and icons) as the web
// mobile map. The legend itself renders bottom-left (see MapLegend), riding
// above the planner drawer.
export default function MapControls({
  onLocate,
  following,
  legendOpen,
  onToggleLegend,
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + 10 }]}
    >
      <CircleButton
        accessibilityLabel="סוגי דרכים"
        icon="layers-outline"
        active={legendOpen}
        onPress={onToggleLegend}
      />
      <CircleButton
        accessibilityLabel="מיקום נוכחי"
        icon="locate-outline"
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
    alignItems: "flex-end",
    gap: 10,
  },
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.96)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
  },
  btnActive: {
    backgroundColor: palette.teal,
  },
  btnPressed: {
    opacity: 0.85,
  },
});
