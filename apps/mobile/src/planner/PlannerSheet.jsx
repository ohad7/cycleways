import BottomSheet, { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useMemo, useRef } from "react";
import { StyleSheet } from "react-native";
import { palette } from "./theme.js";

// Draggable bottom sheet hosting the planner (build) content. The Discover/Build
// segmented toggle is gone — discovery is now its own screen.
export default function PlannerSheet({ sheetRef, children }) {
  const innerRef = useRef(null);
  const ref = sheetRef || innerRef;
  const snapPoints = useMemo(() => ["16%", "48%", "92%"], []);

  return (
    <BottomSheet
      ref={ref}
      index={1}
      snapPoints={snapPoints}
      handleIndicatorStyle={styles.grab}
      backgroundStyle={styles.bg}
    >
      <BottomSheetScrollView contentContainerStyle={styles.body}>
        {children}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  grab: { backgroundColor: palette.line, width: 38 },
  bg: { backgroundColor: palette.paper },
  body: { paddingBottom: 24 },
});
