import BottomSheet, {
  BottomSheetFooter,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { useCallback, useMemo, useRef } from "react";
import { StyleSheet } from "react-native";
import { palette } from "./theme.js";

// Draggable bottom sheet hosting the planner (build) content. The Discover/Build
// segmented toggle is gone — discovery is now its own screen.
//
// `renderFooter` pins content (e.g. the primary route actions) to the bottom of
// the sheet so it stays visible no matter how far the body is scrolled. The
// scroll body reserves extra bottom padding so its last row clears the footer.
export default function PlannerSheet({
  sheetRef,
  children,
  renderFooter,
  animatedPosition,
}) {
  const innerRef = useRef(null);
  const ref = sheetRef || innerRef;
  const snapPoints = useMemo(() => ["16%", "48%", "92%"], []);

  const footerComponent = useCallback(
    (props) => (
      <BottomSheetFooter {...props}>{renderFooter?.()}</BottomSheetFooter>
    ),
    [renderFooter],
  );

  return (
    <BottomSheet
      ref={ref}
      index={1}
      snapPoints={snapPoints}
      // Publishes the sheet's live top-edge Y (screen coords) so the bottom-left
      // map legend can ride just above the drawer as it's dragged.
      animatedPosition={animatedPosition}
      // v5 defaults enableDynamicSizing to true, which sizes the sheet to its
      // content — a short empty-build panel then collapses toward the peek snap
      // instead of honoring the 48% (index 1) half snap. Pin it off so the fixed
      // percentage snap points are authoritative.
      enableDynamicSizing={false}
      handleIndicatorStyle={styles.grab}
      backgroundStyle={styles.bg}
      footerComponent={renderFooter ? footerComponent : undefined}
    >
      <BottomSheetScrollView
        contentContainerStyle={[
          styles.body,
          renderFooter ? styles.bodyWithFooter : null,
        ]}
      >
        {children}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  grab: { backgroundColor: palette.line, width: 38 },
  bg: { backgroundColor: palette.paper },
  body: { paddingBottom: 24 },
  // Reserve room so the last scrolled row clears the pinned action footer
  // (single row of actions + safe-area padding).
  bodyWithFooter: { paddingBottom: 120 },
});
