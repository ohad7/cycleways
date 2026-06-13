import { useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { nextSnap, PEEK_PX } from "@cycleways/core/ui/sheetSnap.js";

function previousSnap(snap) {
  if (snap === "full") return "half";
  if (snap === "half") return "peek";
  return "peek";
}

function heightForSnap(shellHeight, snap) {
  const h = Math.max(Number(shellHeight) || 0, 1);
  if (snap === "full") return Math.max(h - 12, PEEK_PX);
  if (snap === "half") return Math.max(Math.round(h * 0.52), PEEK_PX);
  return Math.min(PEEK_PX, h);
}

export default function NativeBottomSheet({
  children,
  onSnapChange,
  peekContent,
  snap = "peek",
}) {
  const [containerHeight, setContainerHeight] = useState(0);
  const { height: windowHeight } = useWindowDimensions();
  const shellHeight = containerHeight || windowHeight || 0;
  const dragRef = useRef(null);
  const sheetHeight = heightForSnap(shellHeight, snap);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dy) > 3,
        onPanResponderGrant: (evt) => {
          const y = evt.nativeEvent.pageY;
          dragRef.current = {
            lastT: Date.now(),
            lastY: y,
            velocity: 0,
          };
        },
        onPanResponderMove: (evt, gestureState) => {
          const drag = dragRef.current;
          if (!drag) return;
          const y = evt.nativeEvent.pageY;
          const now = Date.now();
          const dt = Math.max(now - drag.lastT, 1);
          drag.velocity = (y - drag.lastY) / dt;
          drag.lastY = y;
          drag.lastT = now;
        },
        onPanResponderRelease: (_, gestureState) => {
          const drag = dragRef.current;
          dragRef.current = null;
          const dy = Number(gestureState.dy) || 0;
          const velocity = Number(drag?.velocity) || 0;
          if (dy < -36 || velocity < -0.45) onSnapChange?.(nextSnap(snap));
          else if (dy > 36 || velocity > 0.45) onSnapChange?.(previousSnap(snap));
        },
        onPanResponderTerminate: (_, gestureState) => {
          dragRef.current = null;
          if ((Number(gestureState.dy) || 0) > 36) {
            onSnapChange?.(previousSnap(snap));
          }
        },
      }),
    [onSnapChange, snap],
  );

  return (
    <View
      pointerEvents="box-none"
      style={styles.overlay}
      onLayout={(event) => {
        setContainerHeight(event.nativeEvent.layout.height);
      }}
    >
      <View
        pointerEvents="auto"
        style={[
          styles.sheet,
          {
            height: sheetHeight,
          },
        ]}
      >
        <View style={styles.handleWrap} {...panResponder.panHandlers}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="שינוי גודל פאנל"
            onPress={() => onSnapChange?.(nextSnap(snap))}
            style={styles.grip}
          />
        </View>
        {peekContent && snap === "peek" ? (
          <View style={styles.peek}>{peekContent}</View>
        ) : null}
        {snap === "peek" ? null : <View style={styles.body}>{children}</View>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-start",
    zIndex: 50,
    elevation: 50,
  },
  sheet: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 0,
    zIndex: 51,
    elevation: 51,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderColor: "#c6d4cf",
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
  },
  handleWrap: {
    minHeight: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  grip: {
    width: 48,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#aab7b2",
  },
  peek: {
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  body: {
    flex: 1,
  },
});
