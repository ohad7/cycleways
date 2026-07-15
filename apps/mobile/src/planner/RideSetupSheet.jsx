import { useSyncExternalStore } from "react";
import { text } from "../theme/typography.js";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatDistanceMeters } from "@cycleways/core/navigation/navigationPresentation.js";
import { rideSetupLocationNotice } from "@cycleways/core/navigation/rideIntroPresentation.js";
import {
  getLockScreenVoiceTestSnapshot,
  startLockScreenVoiceTest,
  stopLockScreenVoiceTest,
  subscribeLockScreenVoiceTest,
} from "../navigation/lockScreenVoiceTest.js";
import Icon from "./Icon.jsx";
import { palette, radius, space } from "./theme.js";

function lockScreenTestStatusLine(test) {
  if (test.status === "running") {
    const progress = `${test.tick}/${test.totalTicks}`;
    return test.backgroundUpdates
      ? `בדיקת מסך נעול פעילה — נעלו את המסך (${progress})`
      : `בדיקה פעילה (${progress}) — עדכוני הרקע לא נרשמו, האפליקציה תוקפא כשהמסך נעול`;
  }
  if (test.status === "error") {
    return "אין הרשאת מיקום — אי אפשר להריץ את בדיקת המסך הנעול";
  }
  if (test.status === "finished" && test.results) {
    const base = `בדיקת המסך הנעול הסתיימה: הושמעו ${test.results.completed} מתוך ${test.results.attempts}`;
    return test.results.errors > 0
      ? `${base} — ${test.results.errors} שגיאות${test.results.lastError ? ` (${test.results.lastError})` : ""}`
      : base;
  }
  return null;
}

function Choice({ label, sub, selected, disabled = false, onPress }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        selected ? styles.choiceSelected : null,
        disabled ? styles.choiceDisabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.choiceText}>
        <Text style={styles.choiceLabel}>{label}</Text>
        {sub ? <Text style={styles.choiceSub}>{sub}</Text> : null}
      </View>
      <Icon
        name={selected ? "radio-button-on" : "radio-button-off"}
        color={disabled ? palette.muted : palette.forest}
        size={21}
      />
    </Pressable>
  );
}

function DirectionButton({ label, selected, disabled = false, onPress }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.directionButton,
        selected ? styles.directionSelected : null,
        disabled ? styles.choiceDisabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.directionText, selected ? styles.directionTextSelected : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function RideSetupSheet({
  visible,
  plan,
  selection,
  locationStatus,
  reverseAllowed = true,
  onDirectionChange,
  onStartModeChange,
  onPickCustom,
  onRefreshLocation,
  onConfirm,
  onClose,
  hapticsEnabled = true,
  onToggleHaptics,
  voiceEnabled = true,
  onToggleVoice,
  lockScreenGuidanceEnabled = true,
  onToggleLockScreenGuidance,
  intersectionCrossingGuidanceEnabled = true,
  onToggleIntersectionCrossingGuidance,
  onTestVoice,
}) {
  const insets = useSafeAreaInsets();
  const lockScreenTest = useSyncExternalStore(
    subscribeLockScreenVoiceTest,
    getLockScreenVoiceTestSnapshot,
  );
  const lockScreenTestRunning = lockScreenTest.status === "running";
  const lockScreenTestStatus = lockScreenTestStatusLine(lockScreenTest);
  const candidates = plan?.candidates;
  const nearest = candidates?.nearest;
  const message = rideSetupLocationNotice(locationStatus, plan?.locationQuality);
  const distance = plan?.distanceToStartMeters;
  const showNearest = Boolean(
    plan?.locationQuality === "fresh" && candidates?.nearestIsMeaningful,
  );
  const startLabel = selection.startMode === "official"
    ? "תחילת המסלול"
    : "נקודת ההתחלה שבחרת";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View
        style={[
          styles.sheet,
          {
            paddingTop: insets.top + space.md,
            paddingBottom: insets.bottom + space.md,
          },
        ]}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="סגירה" onPress={onClose}>
            <Icon name="close" size={24} color={palette.ink} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>הגדרות רכיבה</Text>
            <Text style={styles.subtitle}>כיוון, נקודת התחלה והעדפות הנחיה</Text>
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <Text style={styles.sectionTitle}>כיוון המסלול</Text>
          <View accessibilityRole="radiogroup" style={styles.directionRow}>
            <DirectionButton
              label="רגיל"
              selected={selection.direction === "forward"}
              onPress={() => onDirectionChange("forward")}
            />
            <DirectionButton
              label="הפוך"
              selected={selection.direction === "reverse"}
              disabled={!reverseAllowed}
              onPress={() => onDirectionChange("reverse")}
            />
          </View>
          {!reverseAllowed ? (
            <Text style={styles.helper}>לא ניתן להפוך את המסלול בדיוק בכיוון הנגדי. אפשר לחזור לתכנון ולבקש מסלול חזרה נפרד.</Text>
          ) : null}

          <Text style={styles.sectionTitle}>נקודת התחלה</Text>
          <View accessibilityRole="radiogroup">
            <Choice
              label="תחילת המסלול"
              sub={candidates?.official?.distanceMeters != null
                ? `מרחק ממך: ${formatDistanceMeters(candidates.official.distanceMeters)}`
                : "נקודת ההתחלה שפורסמה"}
              selected={selection.startMode === "official"}
              onPress={() => onStartModeChange("official")}
            />
            {showNearest ? (
              <Choice
                label="הנקודה הקרובה אליי"
                sub={`דילוג על ${formatDistanceMeters(nearest.progressMeters)}`}
                selected={selection.startMode === "nearest"}
                onPress={() => onStartModeChange("nearest")}
              />
            ) : null}
            <Choice
              label="בחירת נקודה על המפה"
              sub={selection.startMode === "custom" ? "הנקודה שנבחרה מסומנת במפה" : "הנקודה תיצמד למסלול"}
              selected={selection.startMode === "custom"}
              onPress={onPickCustom}
            />
          </View>

          {onToggleHaptics ? (
            <>
              <Text style={styles.sectionTitle}>התראות רטט</Text>
              <Choice
                label={hapticsEnabled ? "רטט פעיל" : "רטט כבוי"}
                sub="רטט קצר לפני פניות והתראות"
                selected={hapticsEnabled}
                onPress={onToggleHaptics}
              />
            </>
          ) : null}

          {onToggleIntersectionCrossingGuidance ? (
            <>
              <Text style={styles.sectionTitle}>הנחיות בצמתים</Text>
              <Choice
                label={
                  intersectionCrossingGuidanceEnabled
                    ? "הנחיות חצייה לפני פנייה פעילות"
                    : "הנחיות חצייה לפני פנייה כבויות"
                }
                sub="בצמתים שנבדקו: חצו את הכביש ואז פנו. אפשר לכבות אם ההנחיה מיותרת."
                selected={intersectionCrossingGuidanceEnabled}
                onPress={onToggleIntersectionCrossingGuidance}
              />
            </>
          ) : null}

          {onToggleVoice || onToggleLockScreenGuidance ? (
            <>
              <Text style={styles.sectionTitle}>הכוונה קולית</Text>
              {onToggleVoice ? (
                <Choice
                  label={voiceEnabled ? "הנחיות קוליות פעילות" : "הנחיות קוליות כבויות"}
                  sub="פניות, סטייה מהמסלול והגעה ליעד"
                  selected={voiceEnabled}
                  onPress={onToggleVoice}
                />
              ) : null}
              {onToggleLockScreenGuidance ? (
                <Choice
                  label={
                    lockScreenGuidanceEnabled
                      ? "ממשיך להנחות כשהמסך נעול"
                      : "רק כשהמסך ער"
                  }
                  sub="עובד עם הרשאת המיקום הרגילה — בלי הרשאת 'תמיד'"
                  selected={lockScreenGuidanceEnabled}
                  onPress={onToggleLockScreenGuidance}
                />
              ) : null}
              {voiceEnabled && onTestVoice ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={lockScreenTestRunning ? "עצירת בדיקת הקול" : "בדיקת קול"}
                    onPress={() => {
                      if (lockScreenTestRunning) {
                        void stopLockScreenVoiceTest();
                      } else {
                        onTestVoice();
                      }
                    }}
                    onLongPress={() => {
                      if (lockScreenTestRunning) {
                        void stopLockScreenVoiceTest();
                      } else {
                        void startLockScreenVoiceTest();
                      }
                    }}
                    style={({ pressed }) => [
                      styles.testVoice,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Icon name="volume-high-outline" color={palette.forest} size={19} />
                    <Text style={styles.testVoiceText}>
                      {lockScreenTestRunning ? "עצירת הבדיקה" : "בדיקת קול"}
                    </Text>
                  </Pressable>
                  <Text style={styles.testVoiceHint}>
                    {lockScreenTestStatus ??
                      "לחיצה ארוכה: בדיקת קול למסך נעול (כשתי דקות)"}
                  </Text>
                </>
              ) : null}
            </>
          ) : null}

          {message ? (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>{message}</Text>
              <Pressable accessibilityRole="button" onPress={onRefreshLocation}>
                <Text style={styles.retry}>נסה שוב</Text>
              </Pressable>
            </View>
          ) : null}

          {plan ? (
            <View style={styles.summary}>
              <Text style={styles.summaryTitle}>{startLabel}</Text>
              {Number.isFinite(Number(distance)) ? (
                <Text style={styles.summaryLine}>מרחק ממך: {formatDistanceMeters(distance)}</Text>
              ) : null}
              {plan.skippedMeters > 50 ? (
                <Text style={styles.warning}>ההצטרפות תדלג על {formatDistanceMeters(plan.skippedMeters)}</Text>
              ) : null}
              <Text style={styles.summaryLine}>אורך הרכיבה: {formatDistanceMeters(plan.guidedDistanceMeters)}</Text>
              {plan.effectiveRoute?.start?.name ? (
                <Text style={styles.summaryLine}>התחלה: {plan.effectiveRoute.start.name}</Text>
              ) : null}
              {plan.effectiveRoute?.end?.name ? (
                <Text style={styles.summaryLine}>סיום: {plan.effectiveRoute.end.name}</Text>
              ) : null}
              {plan.direction === "reverse" ? (
                <Text style={styles.summaryLine}>המסלול ינווט בכיוון ההפוך.</Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          disabled={!plan || locationStatus === "loading"}
          onPress={onConfirm}
          style={({ pressed }) => [
            styles.primary,
            !plan || locationStatus === "loading" ? styles.primaryDisabled : null,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.primaryText}>אישור</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.paper,
    paddingHorizontal: space.lg,
  },
  scrollContent: { paddingBottom: space.md },
  header: { flexDirection: "row", alignItems: "flex-start", gap: space.md, marginBottom: space.md },
  headerText: { flex: 1 },
  title: { ...text.subheading, color: palette.ink, textAlign: "right", writingDirection: "rtl" },
  subtitle: { ...text.caption, color: palette.muted, marginTop: 2, textAlign: "right", writingDirection: "rtl" },
  sectionTitle: { ...text.bodyStrong, color: palette.ink, marginTop: space.md, marginBottom: space.sm, textAlign: "right", writingDirection: "rtl" },
  directionRow: { flexDirection: "row-reverse", gap: space.sm },
  directionButton: { flex: 1, paddingVertical: 11, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, alignItems: "center", backgroundColor: palette.white },
  directionSelected: { backgroundColor: palette.forest, borderColor: palette.forest },
  directionText: { ...text.bodyStrong, color: palette.ink },
  directionTextSelected: { color: palette.white },
  helper: { ...text.caption, color: palette.muted, textAlign: "right", writingDirection: "rtl", marginTop: space.xs },
  choice: { minHeight: 58, flexDirection: "row-reverse", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, backgroundColor: palette.white, marginBottom: space.sm },
  choiceSelected: { borderColor: palette.forest, backgroundColor: "#eef6f0" },
  choiceDisabled: { opacity: 0.45 },
  choiceText: { flex: 1 },
  choiceLabel: { ...text.bodyStrong, color: palette.ink, textAlign: "right", writingDirection: "rtl" },
  choiceSub: { ...text.caption, color: palette.muted, marginTop: 2, textAlign: "right", writingDirection: "rtl" },
  testVoice: { minHeight: 42, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: space.xs, borderRadius: radius.md, borderWidth: 1, borderColor: palette.forest, backgroundColor: palette.white, marginBottom: space.sm },
  testVoiceText: { ...text.bodyStrong, color: palette.forest, writingDirection: "rtl" },
  testVoiceHint: { ...text.caption, color: palette.muted, textAlign: "right", writingDirection: "rtl", marginBottom: space.sm },
  notice: { flexDirection: "row-reverse", gap: space.sm, alignItems: "center", backgroundColor: palette.cream, borderRadius: radius.md, padding: space.md, marginTop: space.sm },
  noticeText: { ...text.caption, color: palette.ink, flex: 1, textAlign: "right", writingDirection: "rtl" },
  retry: { ...text.captionStrong, color: palette.forest },
  summary: { borderRadius: radius.md, backgroundColor: "#eef3f1", padding: space.md, gap: 4, marginTop: space.md, marginBottom: space.md },
  summaryTitle: { ...text.bodyStrong, color: palette.ink, textAlign: "right", writingDirection: "rtl" },
  summaryLine: { ...text.caption, color: palette.muted, textAlign: "right", writingDirection: "rtl" },
  warning: { ...text.captionStrong, color: "#92400e", textAlign: "right", writingDirection: "rtl" },
  primary: { minHeight: 50, borderRadius: radius.md, backgroundColor: palette.forest, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  primaryDisabled: { opacity: 0.45 },
  primaryText: { ...text.bodyStrong, color: palette.white, writingDirection: "rtl" },
  pressed: { opacity: 0.72 },
});
