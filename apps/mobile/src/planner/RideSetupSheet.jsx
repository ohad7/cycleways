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
import Icon from "./Icon.jsx";
import { palette, radius, space } from "./theme.js";

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

function locationMessage(status, quality) {
  if (status === "loading") return "מאתר את המיקום שלך…";
  if (status === "denied") return "אין הרשאת מיקום. אפשר לבחור התחלה ידנית או לנסות שוב.";
  if (status === "unavailable") return "לא הצלחנו לקבל מיקום עדכני.";
  if (quality === "stale") return "המיקום הקיים אינו עדכני; ההמלצה לא נבחרה אוטומטית.";
  if (quality === "inaccurate") return "דיוק המיקום נמוך; מומלץ לבחור נקודת התחלה ידנית.";
  return "";
}

function primaryLabel(plan) {
  if (!plan) return "המשך";
  if (plan.approachTier === "at") return "התחל ניווט במסלול";
  if (plan.approachTier === "near") return "התחל והראה דרך למסלול";
  return "בחר אפליקציית ניווט";
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
  lockScreenGuidanceNeedsSettings = false,
  onToggleLockScreenGuidance,
  onOpenLocationSettings,
  onTestVoice,
}) {
  const insets = useSafeAreaInsets();
  const candidates = plan?.candidates;
  const nearest = candidates?.nearest;
  const message = locationMessage(locationStatus, plan?.locationQuality);
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
            <Text style={styles.title}>הכנת הרכיבה</Text>
            <Text style={styles.subtitle}>בחרו כיוון ונקודת התחלה לפני הניווט</Text>
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
            <Text style={styles.helper}>המסלול מסומן כחד-כיווני ולכן אי אפשר להפוך אותו.</Text>
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
                  sub={
                    lockScreenGuidanceNeedsSettings
                      ? "צריך לאפשר מיקום תמיד בהגדרות"
                      : "מבקש הרשאת מיקום תמיד רק בזמן התחלת רכיבה"
                  }
                  selected={lockScreenGuidanceEnabled}
                  onPress={onToggleLockScreenGuidance}
                />
              ) : null}
              {lockScreenGuidanceEnabled &&
              lockScreenGuidanceNeedsSettings &&
              onOpenLocationSettings ? (
                <View style={styles.settingsNotice}>
                  <View style={styles.settingsNoticeText}>
                    <Text style={styles.settingsNoticeTitle}>צריך לאפשר מיקום תמיד</Text>
                    <Text style={styles.settingsNoticeSub}>
                      פתחו את הגדרות האפליקציה ובחרו מיקום &gt; תמיד.
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="פתיחת הגדרות מיקום"
                    onPress={onOpenLocationSettings}
                    style={({ pressed }) => [
                      styles.settingsButton,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Text style={styles.settingsButtonText}>הגדרות</Text>
                  </Pressable>
                </View>
              ) : null}
              {voiceEnabled && onTestVoice ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="בדיקת קול"
                  onPress={onTestVoice}
                  style={({ pressed }) => [
                    styles.testVoice,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Icon name="volume-high-outline" color={palette.forest} size={19} />
                  <Text style={styles.testVoiceText}>בדיקת קול</Text>
                </Pressable>
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
              {plan.approachTier === "far" ? (
                <Text style={styles.farText}>המסלול רחוק. מומלץ להגיע לנקודת ההתחלה בעזרת אפליקציית ניווט.</Text>
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
          <Text style={styles.primaryText}>{primaryLabel(plan)}</Text>
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
  title: { color: palette.ink, fontSize: 21, fontWeight: "900", textAlign: "right", writingDirection: "rtl" },
  subtitle: { color: palette.muted, fontSize: 13, marginTop: 2, textAlign: "right", writingDirection: "rtl" },
  sectionTitle: { color: palette.ink, fontSize: 14, fontWeight: "800", marginTop: space.md, marginBottom: space.sm, textAlign: "right", writingDirection: "rtl" },
  directionRow: { flexDirection: "row-reverse", gap: space.sm },
  directionButton: { flex: 1, paddingVertical: 11, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, alignItems: "center", backgroundColor: palette.white },
  directionSelected: { backgroundColor: palette.forest, borderColor: palette.forest },
  directionText: { color: palette.ink, fontSize: 15, fontWeight: "800" },
  directionTextSelected: { color: palette.white },
  helper: { color: palette.muted, fontSize: 12, textAlign: "right", writingDirection: "rtl", marginTop: space.xs },
  choice: { minHeight: 58, flexDirection: "row-reverse", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, backgroundColor: palette.white, marginBottom: space.sm },
  choiceSelected: { borderColor: palette.forest, backgroundColor: "#eef6f0" },
  choiceDisabled: { opacity: 0.45 },
  choiceText: { flex: 1 },
  choiceLabel: { color: palette.ink, fontSize: 15, fontWeight: "800", textAlign: "right", writingDirection: "rtl" },
  choiceSub: { color: palette.muted, fontSize: 12, marginTop: 2, textAlign: "right", writingDirection: "rtl" },
  testVoice: { minHeight: 42, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: space.xs, borderRadius: radius.md, borderWidth: 1, borderColor: palette.forest, backgroundColor: palette.white, marginBottom: space.sm },
  testVoiceText: { color: palette.forest, fontSize: 14, fontWeight: "900", writingDirection: "rtl" },
  settingsNotice: { flexDirection: "row-reverse", alignItems: "center", gap: space.sm, backgroundColor: palette.cream, borderRadius: radius.md, padding: space.md, marginBottom: space.sm },
  settingsNoticeText: { flex: 1 },
  settingsNoticeTitle: { color: palette.ink, fontSize: 13, fontWeight: "900", textAlign: "right", writingDirection: "rtl" },
  settingsNoticeSub: { color: palette.muted, fontSize: 12, lineHeight: 17, marginTop: 2, textAlign: "right", writingDirection: "rtl" },
  settingsButton: { minHeight: 34, justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: palette.forest, paddingHorizontal: space.md, backgroundColor: palette.white },
  settingsButtonText: { color: palette.forest, fontSize: 13, fontWeight: "900", writingDirection: "rtl" },
  notice: { flexDirection: "row-reverse", gap: space.sm, alignItems: "center", backgroundColor: palette.cream, borderRadius: radius.md, padding: space.md, marginTop: space.sm },
  noticeText: { color: palette.ink, flex: 1, fontSize: 12, textAlign: "right", writingDirection: "rtl" },
  retry: { color: palette.forest, fontSize: 13, fontWeight: "900" },
  summary: { borderRadius: radius.md, backgroundColor: "#eef3f1", padding: space.md, gap: 4, marginTop: space.md, marginBottom: space.md },
  summaryTitle: { color: palette.ink, fontSize: 15, fontWeight: "900", textAlign: "right", writingDirection: "rtl" },
  summaryLine: { color: palette.muted, fontSize: 13, textAlign: "right", writingDirection: "rtl" },
  warning: { color: "#92400e", fontSize: 13, fontWeight: "800", textAlign: "right", writingDirection: "rtl" },
  farText: { color: palette.ink, fontSize: 13, lineHeight: 18, fontWeight: "700", marginTop: space.xs, textAlign: "right", writingDirection: "rtl" },
  primary: { minHeight: 50, borderRadius: radius.md, backgroundColor: palette.forest, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  primaryDisabled: { opacity: 0.45 },
  primaryText: { color: palette.white, fontSize: 16, fontWeight: "900", writingDirection: "rtl" },
  pressed: { opacity: 0.72 },
});
