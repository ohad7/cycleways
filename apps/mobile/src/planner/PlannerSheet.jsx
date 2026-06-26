import BottomSheet, { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useMemo, useRef } from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import { palette, radius } from "./theme.js";

// Real draggable bottom sheet that hosts the planner's Discover/Build content.
// The header carries the Discover/Build segmented control; the scrollable body
// renders whichever panel matches the current panelState.
export default function PlannerSheet({
  panelState,
  onPanelStateChange,
  discover,
  build,
}) {
  const ref = useRef(null);
  const snapPoints = useMemo(() => ["16%", "48%", "92%"], []);

  return (
    <BottomSheet
      ref={ref}
      index={1}
      snapPoints={snapPoints}
      handleIndicatorStyle={styles.grab}
      backgroundStyle={styles.bg}
    >
      <View style={styles.head}>
        <SegToggle state={panelState} onChange={onPanelStateChange} />
      </View>
      <BottomSheetScrollView contentContainerStyle={styles.body}>
        {panelState === "discover" ? discover : build}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

// Native equivalent of the web PanelStateToggle: switches the sheet between the
// catalog browser ("חפש מסלול") and the planner ("בניית מסלול").
function SegToggle({ state, onChange }) {
  return (
    <View style={styles.track}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="חפש מסלול"
        testID="seg-discover"
        onPress={() => onChange("discover")}
        style={[styles.tab, state === "discover" ? styles.tabOn : null]}
      >
        <Text
          style={[styles.tabText, state === "discover" ? styles.tabTextOn : null]}
        >
          חפש מסלול
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="בניית מסלול"
        testID="seg-build"
        onPress={() => onChange("build")}
        style={[styles.tab, state === "build" ? styles.tabOn : null]}
      >
        <Text
          style={[styles.tabText, state === "build" ? styles.tabTextOn : null]}
        >
          בניית מסלול
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  grab: { backgroundColor: palette.line, width: 38 },
  bg: { backgroundColor: palette.paper },
  head: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  body: {
    paddingBottom: 24,
  },
  track: {
    flexDirection: "row-reverse",
    backgroundColor: palette.cream,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  tab: {
    flex: 1,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  tabOn: {
    backgroundColor: palette.white,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
  },
  tabText: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "700",
    writingDirection: "rtl",
  },
  tabTextOn: {
    color: palette.ink,
  },
});
