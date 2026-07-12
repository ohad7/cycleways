import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getNavigationPresentation } from "@cycleways/core/navigation/navigationPresentation.js";
import Icon from "./Icon.jsx";
import ManeuverIcon from "./ManeuverIcon.jsx";
import { palette, radius, space } from "./theme.js";
import { text } from "../theme/typography.js";

// Active turn-by-turn overlay. Decision logic lives in navigationPresentation;
// this component renders the cue card/status pill, contextual controls, and
// arrival summary for the active navigation session.
export default function NavPanel({
  sessionState,
  onRecenter,
  onPauseResume,
  onStop,
  compassHeading = null,
  voiceEnabled = true,
  onToggleVoice,
  onCameraLayout,
}) {
  const insets = useSafeAreaInsets();
  const p = getNavigationPresentation(sessionState);
  const paused = sessionState?.status === "paused";
  const arrived = p.cardMode === "arrived";
  const showRecenter = sessionState?.cameraIntent === "free";
  const showCurrentRoadPill =
    p.cardMode === "status" &&
    sessionState?.status === "navigating" &&
    Boolean(p.currentRoadText) &&
    !p.justAcquired &&
    !p.wrongWay;
  const showTopCard = !arrived && !showCurrentRoadPill;
  const dataPillMainText =
    p.remainingText ||
    (p.cardMode === "off-route"
      ? p.offRouteDistanceText
        ? `${p.offRouteDistanceText} למסלול`
        : p.speedText || "מחוץ למסלול"
      : "");
  const showSpeedInDataPill = Boolean(p.remainingText && p.speedText);

  // Direction-to-route arrow: phone-relative when the compass is available
  // (bearing-to-target minus device heading), else the movement-course arrow.
  const approachArrowDeg =
    Number.isFinite(p.approachBearingDeg) && Number.isFinite(compassHeading)
      ? ((p.approachBearingDeg - compassHeading) % 360 + 360) % 360
      : p.guidanceArrowDeg;
  const showApproachArrow = Number.isFinite(approachArrowDeg);

  return (
    <View style={styles.root} pointerEvents="box-none">
      {!showTopCard ? (
        <View
          onLayout={(event) => {
            const layout = event?.nativeEvent?.layout;
            if (layout) onCameraLayout?.({ topOverlayBottom: layout.y + layout.height });
          }}
        />
      ) : (
        <View
          style={[styles.banner, { marginTop: insets.top + space.sm }]}
          onLayout={(event) => {
            const layout = event?.nativeEvent?.layout;
            if (layout) onCameraLayout?.({ topOverlayBottom: layout.y + layout.height });
          }}
        >
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

          {p.cardMode === "off-route" ? (
            <>
              <Text style={[styles.approachHeading, p.offRoute ? styles.offText : null]}>
                {p.offRouteText}
              </Text>
              <View style={p.offRoute ? [styles.cueRow, styles.offRow] : styles.cueRow}>
                {p.showApproachCue ? (
                  <Icon name={p.approachCueIcon} color={palette.white} size={26} />
                ) : showApproachArrow ? (
                  <View style={{ transform: [{ rotate: `${approachArrowDeg}deg` }] }}>
                    <Icon
                      name="navigate"
                      color={p.offRoute ? palette.white : palette.forest}
                      size={26}
                    />
                  </View>
                ) : null}
                <View style={styles.cueTextWrap}>
                  <Text
                    style={[styles.cueText, styles.offTextColor]}
                    numberOfLines={1}
                  >
                    {p.offRouteInstructionText}
                  </Text>
                  {p.showApproachCue && p.approachCueSecondaryText ? (
                    <Text style={[styles.context, styles.offTextColor]} numberOfLines={1}>
                      {p.approachCueSecondaryText}
                    </Text>
                  ) : null}
                </View>
                {p.showApproachCue && p.approachCueDistanceText ? (
                  <Text style={[styles.cueBigDistance, styles.offTextColor]}>
                    {p.approachCueDistanceText}
                  </Text>
                ) : null}
              </View>
              {p.approachSupportText ? (
                <Text style={styles.approachSupport}>{p.approachSupportText}</Text>
              ) : null}
            </>
          ) : p.cardMode === "cue" ? (
            <View
              style={styles.cueRow}
              accessible
              accessibilityLabel={[
                p.cuePrimaryText || p.cueText,
                p.cueNextText,
                p.cueSecondaryText,
                p.cueDistanceText,
              ].filter(Boolean).join(". ")}
            >
              <View style={styles.cueInstructions}>
                <CueManeuverRow
                  maneuver={p.cueManeuver}
                  fallbackIcon={p.cueIcon}
                >
                  <Text style={[styles.cueText, styles.maneuverCopy]}>
                    {p.cuePrimaryText || p.cueText}
                  </Text>
                </CueManeuverRow>
                {p.cueNextText && p.cueNextManeuver ? (
                  <CueManeuverRow maneuver={p.cueNextManeuver} secondary>
                    <Text style={[styles.nextCueText, styles.maneuverCopy]}>
                      {p.cueNextText}
                    </Text>
                  </CueManeuverRow>
                ) : null}
                {p.cueSecondaryText ? (
                  <Text style={[styles.context, styles.cueContextIndent]} numberOfLines={2}>
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
              {p.statusText || p.cueText}
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
        <View
          style={[styles.arrivalCard, { marginBottom: insets.bottom + space.md }]}
          onLayout={(event) => {
            const layout = event?.nativeEvent?.layout;
            if (layout) onCameraLayout?.({ bottomOverlayTop: layout.y });
          }}
        >
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
        <View
          style={[styles.bottomStack, { marginBottom: insets.bottom + space.md }]}
          onLayout={(event) => {
            const layout = event?.nativeEvent?.layout;
            if (layout) onCameraLayout?.({ bottomOverlayTop: layout.y });
          }}
        >
          {showCurrentRoadPill ? (
            <View style={styles.roadPill}>
              <Text style={styles.roadPillText} numberOfLines={1}>
                {p.currentRoadText}
              </Text>
            </View>
          ) : null}
          <View style={styles.controls}>
            <View
              style={styles.dataPill}
              accessible
              accessibilityLabel={
                showSpeedInDataPill
                  ? `${dataPillMainText}. ${p.speedText}`
                  : dataPillMainText
              }
            >
              <View style={styles.dataPillCopy}>
                <Text style={styles.dataPillMain} numberOfLines={1}>
                  {dataPillMainText}
                </Text>
                {showSpeedInDataPill ? (
                  <Text style={styles.dataPillSub} numberOfLines={1}>
                    {p.speedText}
                  </Text>
                ) : null}
              </View>
            </View>
            <RoundButton
              icon={paused ? "play" : "pause"}
              label={paused ? "המשך" : "השהה"}
              onPress={onPauseResume}
            />
            {onToggleVoice ? (
              <RoundButton
                icon={voiceEnabled ? "volume-high-outline" : "volume-mute-outline"}
                label={voiceEnabled ? "השתק" : "קול"}
                onPress={onToggleVoice}
              />
            ) : null}
            <RoundButton icon="stop" label="סיום" danger onPress={onStop} />
          </View>
        </View>
      )}
    </View>
  );
}

function CueManeuverRow({ maneuver, fallbackIcon, secondary = false, children }) {
  const size = secondary ? 23 : 32;
  return (
    <View style={styles.maneuverRow}>
      <View style={styles.maneuverIconSlot}>
        {maneuver ? (
          <ManeuverIcon maneuver={maneuver} color={palette.forest} size={size} />
        ) : fallbackIcon ? (
          <Icon name={fallbackIcon} color={palette.forest} size={size} />
        ) : null}
      </View>
      {children}
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
    ...text.navBody,
    color: palette.white,
    flex: 1,
    textAlign: "right",
    writingDirection: "rtl",
  },
  cueTextWrap: { flex: 1 },
  cueInstructions: {
    flex: 1,
    minWidth: 0,
    gap: space.xs,
  },
  maneuverRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: space.sm,
  },
  maneuverIconSlot: {
    width: 34,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  maneuverCopy: {
    flex: 1,
    flexShrink: 1,
  },
  cueText: {
    ...text.navTitle,
    color: palette.ink,
    writingDirection: "rtl",
    textAlign: "right",
  },
  nextCueText: {
    ...text.navBody,
    color: palette.ink,
    writingDirection: "rtl",
    textAlign: "right",
  },
  offText: { color: palette.white, flex: 1 },
  offTextColor: { color: palette.white },
  approachHeading: {
    ...text.navBody,
    color: palette.ink,
    writingDirection: "rtl",
    textAlign: "right",
    marginBottom: space.xs,
  },
  approachSupport: {
    ...text.navCaption,
    color: palette.muted,
    writingDirection: "rtl",
    textAlign: "right",
    marginTop: space.xs,
  },
  cueBigDistance: {
    ...text.display,
    color: "#1c4fd6",
    flexShrink: 0,
  },
  statusText: {
    ...text.navBody,
    color: palette.ink,
    writingDirection: "rtl",
    textAlign: "right",
  },
  context: {
    ...text.navCaption,
    color: palette.muted,
    writingDirection: "rtl",
    textAlign: "right",
    marginTop: 2,
  },
  cueContextIndent: {
    marginRight: 34 + space.sm,
  },
  destBtnPressed: { opacity: 0.7 },
  bottomStack: {
    gap: space.sm,
  },
  roadPill: {
    alignSelf: "stretch",
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
  roadPillText: {
    ...text.navTitle,
    color: palette.ink,
    writingDirection: "rtl",
    textAlign: "center",
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
  dataPillCopy: {
    flex: 1,
    minWidth: 0,
  },
  dataPillMain: {
    ...text.navBody,
    color: palette.ink,
    writingDirection: "rtl",
  },
  dataPillSub: {
    ...text.navCaption,
    color: palette.muted,
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
    ...text.navTitle,
    color: palette.ink,
    textAlign: "center",
    writingDirection: "rtl",
  },
  arrivalStats: {
    flexDirection: "row-reverse",
    justifyContent: "space-around",
    marginTop: space.md,
  },
  arrivalStat: { alignItems: "center" },
  arrivalStatValue: { ...text.navTitle, color: palette.ink },
  arrivalStatLabel: { ...text.label, color: palette.muted },
  arrivalDone: {
    marginTop: space.md,
    backgroundColor: palette.forest,
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    alignItems: "center",
  },
  arrivalDoneText: {
    ...text.navBody,
    color: palette.white,
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
    ...text.navCaption,
    color: palette.ink,
    writingDirection: "rtl",
  },
});
