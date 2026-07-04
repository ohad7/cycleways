import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getNavigationPresentation } from "@cycleways/core/navigation/navigationPresentation.js";
import Icon from "./Icon.jsx";
import { palette, radius, space } from "./theme.js";

// Active turn-by-turn overlay. Decision logic lives in navigationPresentation;
// this component renders the cue card/status pill, contextual controls, and
// arrival summary for the active navigation session.
export default function NavPanel({
  sessionState,
  onRecenter,
  onPauseResume,
  onStop,
  onOpenExternal,
  onChangeRideSettings,
  compassHeading = null,
}) {
  const insets = useSafeAreaInsets();
  const p = getNavigationPresentation(sessionState);
  const paused = sessionState?.status === "paused";
  const arrived = p.cardMode === "arrived";
  const showRecenter = sessionState?.cameraIntent === "free";

  // Direction-to-route arrow: phone-relative when the compass is available
  // (bearing-to-target minus device heading), else the movement-course arrow.
  const approachArrowDeg =
    Number.isFinite(p.approachBearingDeg) && Number.isFinite(compassHeading)
      ? ((p.approachBearingDeg - compassHeading) % 360 + 360) % 360
      : p.guidanceArrowDeg;
  const showApproachArrow = Number.isFinite(approachArrowDeg);

  return (
    <View style={styles.root} pointerEvents="box-none">
      {arrived ? (
        <View />
      ) : (
        <View style={[styles.banner, { marginTop: insets.top + space.sm }]}>
          {p.justAcquired ? (
            <View style={styles.acquiredRow}>
              <Icon name="checkmark-circle" color={palette.white} size={22} />
              <Text style={styles.acquiredText}>{p.acquisitionText}</Text>
            </View>
          ) : null}
          {p.wrongWay ? (
            <View style={styles.wrongWayRow}>
              <Icon name="warning-outline" color={palette.white} size={22} />
              <Text style={[styles.cueText, styles.offText]} numberOfLines={1}>
                {p.wrongWayText}
              </Text>
            </View>
          ) : null}

          {p.cardMode === "approach" || p.cardMode === "off-route" ? (
            <>
              <Text style={[styles.approachHeading, p.offRoute ? styles.offText : null]}>
                {p.approachHeading}
              </Text>
              <View style={p.offRoute ? [styles.cueRow, styles.offRow] : styles.cueRow}>
                {showApproachArrow ? (
                  <View style={{ transform: [{ rotate: `${approachArrowDeg}deg` }] }}>
                    <Icon
                      name="navigate"
                      color={p.offRoute ? palette.white : palette.forest}
                      size={26}
                    />
                  </View>
                ) : null}
                <Text
                  style={[styles.cueText, p.offRoute ? styles.offText : null]}
                  numberOfLines={1}
                >
                  {p.destinationLabel}
                  {p.approachDistanceShort ? ` · ${p.approachDistanceShort}` : ""}
                </Text>
              </View>
              {p.approachSupportText ? (
                <Text style={styles.approachSupport}>{p.approachSupportText}</Text>
              ) : null}
              {p.cardMode === "approach" ? (
                <View style={styles.approachActions}>
                  <Pressable
                    style={({ pressed }) => [styles.destBtn, pressed ? styles.destBtnPressed : null]}
                    onPress={onOpenExternal}
                    accessibilityRole="button"
                    accessibilityLabel="פתיחה באפליקציית ניווט"
                  >
                    <Icon name="open-outline" color={palette.forest} size={18} />
                    <Text style={styles.destBtnText}>אפליקציית ניווט</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.destBtn, pressed ? styles.destBtnPressed : null]}
                    onPress={onChangeRideSettings}
                    accessibilityRole="button"
                    accessibilityLabel="שינוי הגדרות רכיבה"
                  >
                    <Icon name="options-outline" color={palette.forest} size={18} />
                    <Text style={styles.destBtnText}>הגדרות רכיבה</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : p.cardMode === "cue" ? (
            <View style={styles.cueRow}>
              <Icon name={p.cueIcon} color={palette.forest} size={30} />
              <View style={styles.cueTextWrap}>
                <Text style={styles.cueText} numberOfLines={1}>
                  {p.cuePrimaryText || p.cueText}
                </Text>
                {p.cueSecondaryText ? (
                  <Text style={styles.context} numberOfLines={1}>
                    {p.cueSecondaryText}
                  </Text>
                ) : null}
              </View>
              {p.cueDistanceText ? (
                <Text style={styles.cueBigDistance}>{p.cueDistanceText}</Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.statusText} numberOfLines={1}>
              {p.contextText || p.statusText || p.cueText}
            </Text>
          )}
        </View>
      )}

      {showRecenter && !arrived ? (
        <View style={[styles.recenterWrap, { bottom: insets.bottom + 84 }]}>
          <NavButton icon="locate-outline" label="מרכוז" onPress={onRecenter} />
        </View>
      ) : null}

      {arrived && p.arrivalSummary ? (
        <View style={[styles.arrivalCard, { marginBottom: insets.bottom + space.md }]}>
          <Text style={styles.arrivalTitle}>הגעת ליעד 🎉</Text>
          <View style={styles.arrivalStats}>
            <ArrivalStat value={p.arrivalSummary.distanceText} label="מרחק" />
            <ArrivalStat value={p.arrivalSummary.elapsedText} label="זמן" />
            <ArrivalStat value={p.arrivalSummary.avgSpeedText} label="ממוצע" />
          </View>
          <Pressable
            style={({ pressed }) => [styles.arrivalDone, pressed ? styles.destBtnPressed : null]}
            onPress={onStop}
            accessibilityRole="button"
            accessibilityLabel="סיום הניווט"
          >
            <Text style={styles.arrivalDoneText}>סיום</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[styles.controls, { marginBottom: insets.bottom + space.md }]}>
          <View style={styles.dataPill}>
            <Text style={styles.dataPillMain} numberOfLines={1}>
              {p.remainingText || ""}
            </Text>
            {p.speedText ? (
              <Text style={styles.dataPillSub}>{p.speedText}</Text>
            ) : null}
          </View>
          <RoundButton
            icon={paused ? "play" : "pause"}
            label={paused ? "המשך" : "השהה"}
            onPress={onPauseResume}
          />
          <RoundButton icon="stop" label="סיום" danger onPress={onStop} />
        </View>
      )}
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

function RoundButton({ icon, label, onPress, danger = false }) {
  return (
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
  );
}

function ArrivalStat({ value, label }) {
  return (
    <View style={styles.arrivalStat}>
      <Text style={styles.arrivalStatValue}>{value}</Text>
      <Text style={styles.arrivalStatLabel}>{label}</Text>
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
  acquiredRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: palette.forest,
    marginTop: -space.md,
    marginHorizontal: -space.lg,
    marginBottom: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  acquiredText: {
    color: palette.white,
    flex: 1,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
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
  approachHeading: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: "900",
    writingDirection: "rtl",
    textAlign: "right",
    marginBottom: space.xs,
  },
  approachSupport: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
    marginTop: space.xs,
  },
  cueBigDistance: {
    color: "#1c4fd6",
    fontSize: 22,
    fontWeight: "900",
  },
  statusText: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
  },
  context: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "700",
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
  approachActions: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: space.sm,
    marginTop: space.sm,
  },
  destBtnText: {
    color: palette.forest,
    fontSize: 14,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  controls: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: space.sm,
  },
  dataPill: {
    flex: 1,
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: palette.white,
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 3,
  },
  dataPillMain: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: "900",
    writingDirection: "rtl",
  },
  dataPillSub: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "700",
    writingDirection: "rtl",
  },
  recenterWrap: { position: "absolute", left: space.md },
  arrivalCard: {
    backgroundColor: palette.paper,
    borderRadius: radius.lg,
    padding: space.lg,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  arrivalTitle: {
    color: palette.ink,
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
    writingDirection: "rtl",
  },
  arrivalStats: {
    flexDirection: "row-reverse",
    justifyContent: "space-around",
    marginTop: space.md,
  },
  arrivalStat: { alignItems: "center" },
  arrivalStatValue: { color: palette.ink, fontSize: 18, fontWeight: "900" },
  arrivalStatLabel: { color: palette.muted, fontSize: 11, fontWeight: "700" },
  arrivalDone: {
    marginTop: space.md,
    backgroundColor: palette.forest,
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    alignItems: "center",
  },
  arrivalDoneText: {
    color: palette.white,
    fontSize: 15,
    fontWeight: "900",
    writingDirection: "rtl",
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
