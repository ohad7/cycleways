import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getRideIntroPresentation } from "@cycleways/core/navigation/rideIntroPresentation.js";
import Icon from "./Icon.jsx";
import { palette, radius, space } from "./theme.js";
import { text } from "../theme/typography.js";

export default function RideIntroCard({
  visible,
  plan,
  locationStatus,
  onConfirm,
  onOpenExternal,
  onOpenSettings,
  onRefreshLocation,
  onClose,
  onLayout,
}) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  const intro = getRideIntroPresentation(plan, locationStatus);
  const showNotice = Boolean(
    intro.noticeText && intro.noticeText !== intro.headline,
  );

  return (
    <View
      style={[styles.wrap, { paddingBottom: insets.bottom + space.md }]}
      pointerEvents="box-none"
      onLayout={onLayout}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="סגירה"
            onPress={onClose}
            hitSlop={8}
          >
            <Icon name="close" size={22} color={palette.muted} />
          </Pressable>
          <Text style={styles.headline}>{intro.headline}</Text>
        </View>
        {intro.expectationText ? (
          <Text style={styles.expectation}>{intro.expectationText}</Text>
        ) : null}
        {intro.rideLengthText ? (
          <Text style={styles.meta}>{intro.rideLengthText}</Text>
        ) : null}
        {intro.skipNoteText ? (
          <Text style={styles.warning}>{intro.skipNoteText}</Text>
        ) : null}
        {intro.directionNoteText ? (
          <Text style={styles.meta}>{intro.directionNoteText}</Text>
        ) : null}
        {intro.nearestHintText ? (
          <Text style={styles.hint}>{intro.nearestHintText}</Text>
        ) : null}
        {showNotice ? (
          <View style={styles.noticeRow}>
            <Text style={styles.notice}>{intro.noticeText}</Text>
            {intro.showRetry ? (
              <Pressable accessibilityRole="button" onPress={onRefreshLocation}>
                <Text style={styles.retry}>נסה שוב</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={!intro.primaryEnabled}
          onPress={onConfirm}
          style={({ pressed }) => [
            styles.primary,
            !intro.primaryEnabled ? styles.primaryDisabled : null,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.primaryText}>{intro.primaryLabel}</Text>
        </Pressable>

        <View style={styles.secondaryRow}>
          {intro.showExternalNav ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="ניווט לנקודת ההתחלה באפליקציית ניווט"
              onPress={onOpenExternal}
              style={({ pressed }) => [
                styles.secondary,
                pressed ? styles.pressed : null,
              ]}
            >
              <Icon name="open-outline" color={palette.forest} size={17} />
              <Text style={styles.secondaryText}>אפליקציית ניווט</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="הגדרות רכיבה"
            onPress={onOpenSettings}
            style={({ pressed }) => [
              styles.secondary,
              pressed ? styles.pressed : null,
            ]}
          >
            <Icon name="options-outline" color={palette.forest} size={17} />
            <Text style={styles.secondaryText}>הגדרות רכיבה</Text>
          </Pressable>
        </View>
        <Text style={styles.safety}>
          ההנחיות הן עזר לתכנון בלבד. רכבו בזהירות וצייתו לתמרורים ולתנאי הדרך.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.md,
    zIndex: 25,
    elevation: 25,
  },
  card: {
    backgroundColor: palette.paper,
    borderRadius: radius.lg,
    padding: space.lg,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
  },
  headline: {
    ...text.subheading,
    color: palette.ink,
    flex: 1,
    textAlign: "right",
    writingDirection: "rtl",
  },
  expectation: {
    ...text.body,
    color: palette.ink,
    marginTop: space.xs,
    textAlign: "right",
    writingDirection: "rtl",
  },
  meta: {
    ...text.caption,
    color: palette.muted,
    marginTop: 2,
    textAlign: "right",
    writingDirection: "rtl",
  },
  warning: {
    ...text.captionStrong,
    color: "#92400e",
    marginTop: 2,
    textAlign: "right",
    writingDirection: "rtl",
  },
  hint: {
    ...text.caption,
    color: palette.forest,
    marginTop: space.xs,
    textAlign: "right",
    writingDirection: "rtl",
  },
  noticeRow: {
    flexDirection: "row-reverse",
    gap: space.sm,
    alignItems: "center",
    backgroundColor: palette.cream,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.sm,
  },
  notice: {
    ...text.caption,
    color: palette.ink,
    flex: 1,
    textAlign: "right",
    writingDirection: "rtl",
  },
  retry: { ...text.captionStrong, color: palette.forest },
  primary: {
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: palette.forest,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.md,
  },
  primaryDisabled: { opacity: 0.45 },
  primaryText: {
    ...text.bodyStrong,
    color: palette.white,
    writingDirection: "rtl",
  },
  secondaryRow: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: space.sm,
    marginTop: space.sm,
  },
  secondary: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: space.xs,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.forest,
    backgroundColor: palette.white,
  },
  secondaryText: {
    ...text.navBody,
    color: palette.forest,
    writingDirection: "rtl",
  },
  safety: {
    ...text.caption,
    color: palette.muted,
    marginTop: space.md,
    textAlign: "right",
    writingDirection: "rtl",
  },
  pressed: { opacity: 0.72 },
});
