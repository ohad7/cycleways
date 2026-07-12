import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getNavigationPresentation } from "@cycleways/core/navigation/navigationPresentation.js";
import Icon from "./Icon.jsx";
import { palette, radius, space } from "./theme.js";
import { text } from "../theme/typography.js";

export default function ApproachPanel({
  sessionState,
  compassHeading = null,
  onOpenExternal,
  onOpenSettings,
  onStop,
  onRecenter,
  onCameraLayout,
}) {
  const insets = useSafeAreaInsets();
  const p = getNavigationPresentation(sessionState);
  const showRecenter = sessionState?.cameraIntent === "free";
  const arrowDeg =
    Number.isFinite(p.approachBearingDeg) && Number.isFinite(compassHeading)
      ? ((p.approachBearingDeg - compassHeading) % 360 + 360) % 360
      : p.guidanceArrowDeg;
  const showExternal = p.handoffProminence !== "hidden";

  return (
    <View style={styles.root} pointerEvents="box-none">
      <View
        style={[styles.banner, { marginTop: insets.top + space.sm }]}
        onLayout={(event) => {
          const layout = event?.nativeEvent?.layout;
          if (layout) onCameraLayout?.({ topOverlayBottom: layout.y + layout.height });
        }}
      >
        <Text style={styles.heading}>{p.approachHeading}</Text>
        {p.showApproachCue ? (
          <View style={styles.pointerRow}>
            <Icon name={p.approachCueIcon} color={palette.forest} size={28} />
            <View style={styles.cueTextWrap}>
              <Text style={styles.pointerText} numberOfLines={1}>
                {p.approachCuePrimaryText || p.approachCueText}
              </Text>
              {p.approachCueSecondaryText ? (
                <Text style={styles.support} numberOfLines={1}>
                  {p.approachCueSecondaryText}
                </Text>
              ) : null}
            </View>
            {p.approachCueDistanceText ? (
              <Text style={styles.cueDistance}>{p.approachCueDistanceText}</Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.pointerRow}>
            {Number.isFinite(arrowDeg) ? (
              <View style={{ transform: [{ rotate: `${arrowDeg}deg` }] }}>
                <Icon name="navigate" color={palette.forest} size={26} />
              </View>
            ) : null}
            <Text style={styles.pointerText} numberOfLines={1}>
              {p.destinationLabel}
              {p.approachDistanceShort ? ` · ${p.approachDistanceShort}` : ""}
            </Text>
          </View>
        )}
        {p.approachSupportText ? (
          <Text style={styles.support}>{p.approachSupportText}</Text>
        ) : null}
      </View>

      {showRecenter ? (
        <View style={[styles.recenterWrap, { bottom: insets.bottom + 96 }]}>
          <ActionButton icon="locate-outline" label="מרכוז" onPress={onRecenter} />
        </View>
      ) : null}

      <View
        style={[styles.controls, { marginBottom: insets.bottom + space.md }]}
        onLayout={(event) => {
          const layout = event?.nativeEvent?.layout;
          if (layout) onCameraLayout?.({ bottomOverlayTop: layout.y });
        }}
      >
        {showExternal ? (
          <ActionButton
            icon="open-outline"
            label="אפליקציית ניווט"
            onPress={onOpenExternal}
            primary={p.handoffProminence === "primary"}
          />
        ) : null}
        <ActionButton
          icon="options-outline"
          label="הגדרות רכיבה"
          onPress={onOpenSettings}
        />
        <ActionButton icon="stop" label="סיום" danger onPress={onStop} />
      </View>
    </View>
  );
}

function ActionButton({ icon, label, onPress, danger = false, primary = false }) {
  return (
    <View style={styles.actionWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [
          styles.actionBtn,
          primary ? styles.actionBtnPrimary : null,
          danger ? styles.actionBtnDanger : null,
          pressed ? styles.pressed : null,
        ]}
      >
        <Icon
          name={icon}
          color={danger || primary ? palette.white : palette.ink}
          size={22}
        />
      </Pressable>
      <Text style={styles.actionLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    elevation: 20,
    justifyContent: "space-between",
    paddingHorizontal: space.md,
  },
  banner: {
    backgroundColor: palette.paper,
    borderRadius: radius.lg,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  heading: {
    ...text.navBody,
    color: palette.ink,
    writingDirection: "rtl",
    textAlign: "right",
    marginBottom: space.xs,
  },
  pointerRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: space.md,
  },
  pointerText: {
    ...text.navTitle,
    color: palette.ink,
    writingDirection: "rtl",
    textAlign: "right",
    flex: 1,
  },
  cueTextWrap: { flex: 1 },
  cueDistance: {
    ...text.navTitle,
    color: palette.forest,
    writingDirection: "rtl",
  },
  support: {
    ...text.navCaption,
    color: palette.muted,
    writingDirection: "rtl",
    textAlign: "right",
    marginTop: space.xs,
  },
  controls: {
    flexDirection: "row-reverse",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: space.lg,
  },
  recenterWrap: { position: "absolute", left: space.md },
  actionWrap: { alignItems: "center", gap: 4, maxWidth: 96 },
  actionBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.white,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 3,
  },
  actionBtnPrimary: { backgroundColor: palette.forest },
  actionBtnDanger: { backgroundColor: palette.danger },
  actionLabel: {
    ...text.navCaption,
    color: palette.ink,
    writingDirection: "rtl",
  },
  pressed: { opacity: 0.85 },
});
