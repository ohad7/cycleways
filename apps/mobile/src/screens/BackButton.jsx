import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "../planner/Icon.jsx";
import { palette } from "../planner/theme.js";

// Floating circular back button, pinned top-left and safe-area aware. Used on the
// pushed screens (RouteDetail, Build) where the full-bleed map / scroll content
// would otherwise leave the user with no way back (the swipe-back gesture is
// unreliable over the map).
export default function BackButton({ onPress, accessibilityLabel = "חזרה" }) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [styles.btn, pressed ? styles.pressed : null]}
      >
        <Icon name="chevron-back" size={24} color={palette.ink} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 14, zIndex: 20 },
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
    elevation: 5,
  },
  pressed: { opacity: 0.8 },
});
