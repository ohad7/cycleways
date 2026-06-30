import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getNavigationPresentation } from "@cycleways/core/navigation/navigationPresentation.js";
import Icon from "./Icon.jsx";
import { palette, radius, space } from "./theme.js";

// Active turn-by-turn overlay (turn-by-turn Phase 8). Replaces the planner sheet
// while a navigation session is active: a top cue banner (or off-route warning)
// plus a bottom control row (recenter / pause-resume / stop). Pure renderer over
// the session state via getNavigationPresentation.
//
// NOTE: native UI — verified visually in the simulator, not by the node suite.
export default function NavPanel({
  sessionState,
  hapticsEnabled = true,
  onToggleHaptics,
  onRecenter,
  onPauseResume,
  onStop,
  onOpenDestinations,
  compassHeading = null,
}) {
  const insets = useSafeAreaInsets();
  const p = getNavigationPresentation(sessionState);
  const paused = sessionState?.status === "paused";

  // Direction-to-route arrow: phone-relative when the compass is available
  // (bearing-to-target minus device heading), else the movement-course arrow.
  const approachArrowDeg =
    Number.isFinite(p.approachBearingDeg) && Number.isFinite(compassHeading)
      ? ((p.approachBearingDeg - compassHeading) % 360 + 360) % 360
      : p.guidanceArrowDeg ?? 0;

  return (
    <View style={styles.root} pointerEvents="box-none">
      <View style={[styles.banner, { marginTop: insets.top + space.sm }]}>
        {p.wrongWay ? (
          <View style={styles.wrongWayRow}>
            <Icon name="warning-outline" color={palette.white} size={22} />
            <Text style={[styles.cueText, styles.offText]} numberOfLines={1}>
              {p.wrongWayText}
            </Text>
          </View>
        ) : null}
        {p.showApproach ? (
          <View style={p.offRoute ? [styles.cueRow, styles.offRow] : styles.cueRow}>
            <Icon
              name="navigate"
              color={p.offRoute ? palette.white : palette.forest}
              size={26}
              style={{ transform: [{ rotate: `${approachArrowDeg}deg` }] }}
            />
            <Text
              style={[styles.cueText, p.offRoute ? styles.offText : null]}
              numberOfLines={1}
            >
              {p.destinationLabel}
              {p.approachDistanceShort ? ` · ${p.approachDistanceShort}` : ""}
            </Text>
          </View>
        ) : p.showCue ? (
          <View style={styles.cueRow}>
            <Icon name={p.cueIcon} color={palette.forest} size={28} />
            <View style={styles.cueTextWrap}>
              <Text style={styles.cueText} numberOfLines={1}>
                {p.cueText}
              </Text>
              {p.cueDistanceText ? (
                <Text style={styles.cueDistance}>{p.cueDistanceText}</Text>
              ) : null}
            </View>
          </View>
        ) : (
          <Text style={styles.statusText} numberOfLines={1}>
            {p.statusText || p.cueText}
          </Text>
        )}
        {p.remainingText ? (
          <Text style={styles.remaining}>{p.remainingText}</Text>
        ) : null}
        {p.showContext && p.contextText ? (
          <Text style={styles.context} numberOfLines={1}>{p.contextText}</Text>
        ) : null}
        {p.showApproach ? (
          <Pressable
            style={({ pressed }) => [
              styles.destBtn,
              pressed ? styles.destBtnPressed : null,
            ]}
            onPress={onOpenDestinations}
            accessibilityRole="button"
            accessibilityLabel="אפשרויות יעד"
          >
            <Icon name="options-outline" color={palette.forest} size={18} />
            <Text style={styles.destBtnText}>יעד</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.controls, { marginBottom: insets.bottom + space.md }]}>
        <NavButton icon="locate-outline" label="מרכוז" onPress={onRecenter} />
        <NavButton
          icon={paused ? "play" : "pause"}
          label={paused ? "המשך" : "השהה"}
          onPress={onPauseResume}
        />
        <NavButton
          icon={hapticsEnabled ? "notifications-outline" : "notifications-off-outline"}
          label={hapticsEnabled ? "רטט" : "מושתק"}
          onPress={onToggleHaptics}
        />
        <NavButton icon="stop" label="סיום" danger onPress={onStop} />
      </View>
    </View>
  );
}

function NavButton({ icon, label, onPress, danger = false }) {
  return (
    <View style={styles.navBtnWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [
          styles.navBtn,
          danger ? styles.navBtnDanger : null,
          pressed ? styles.navBtnPressed : null,
        ]}
      >
        <Icon name={icon} color={danger ? palette.white : palette.ink} size={22} />
      </Pressable>
      <Text style={styles.navBtnLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
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
  cueRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: space.md,
  },
  offRow: {
    backgroundColor: palette.danger,
    margin: -space.md,
    marginHorizontal: -space.lg,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
  },
  wrongWayRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: space.md,
    backgroundColor: palette.danger,
    marginTop: -space.md,
    marginHorizontal: -space.lg,
    marginBottom: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  cueTextWrap: { flex: 1 },
  cueText: {
    color: palette.ink,
    fontSize: 20,
    fontWeight: "800",
    writingDirection: "rtl",
    textAlign: "right",
  },
  offText: { color: palette.white, flex: 1 },
  cueDistance: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
  },
  statusText: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
  },
  remaining: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
    marginTop: space.xs,
  },
  context: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "600",
    writingDirection: "rtl",
    textAlign: "right",
    marginTop: 2,
  },
  destBtn: {
    flexDirection: "row-reverse",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: space.xs,
    marginTop: space.sm,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.forest,
    backgroundColor: palette.white,
  },
  destBtnPressed: { opacity: 0.7 },
  destBtnText: {
    color: palette.forest,
    fontSize: 14,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  controls: {
    flexDirection: "row-reverse",
    justifyContent: "center",
    gap: space.lg,
  },
  navBtnWrap: { alignItems: "center", gap: 4 },
  navBtn: {
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
  navBtnDanger: { backgroundColor: palette.danger },
  navBtnPressed: { opacity: 0.85 },
  navBtnLabel: {
    color: palette.ink,
    fontSize: 12,
    fontWeight: "700",
    writingDirection: "rtl",
  },
});
