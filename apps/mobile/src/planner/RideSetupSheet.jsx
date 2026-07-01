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
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="סגירה" onPress={onClose}>
            <Icon name="close" size={24} color={palette.ink} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>הכנת הרכיבה</Text>
            <Text style={styles.subtitle}>בחרו כיוון ונקודת התחלה לפני הניווט</Text>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
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
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.34)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "88%",
    backgroundColor: palette.paper,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  handle: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, backgroundColor: palette.line, marginBottom: space.md },
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
