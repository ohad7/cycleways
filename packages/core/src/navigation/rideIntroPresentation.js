import { formatDistanceMeters } from "./navigationPresentation.js";

export function rideSetupLocationNotice(status, quality) {
  if (status === "loading") return "מאתר את המיקום שלך…";
  if (status === "denied") {
    return "אין הרשאת מיקום. אפשר לבחור התחלה ידנית או לנסות שוב.";
  }
  if (status === "unavailable") return "לא הצלחנו לקבל מיקום עדכני.";
  if (quality === "stale") {
    return "המיקום הקיים אינו עדכני; ההמלצה לא נבחרה אוטומטית.";
  }
  if (quality === "inaccurate") {
    return "דיוק המיקום נמוך; מומלץ לבחור נקודת התחלה ידנית.";
  }
  return "";
}

export function confirmDistanceBucket(meters) {
  if (meters === null || meters === undefined || meters === "") return "unknown";
  const m = Number(meters);
  if (!Number.isFinite(m) || m < 0) return "unknown";
  if (m <= 100) return "at";
  if (m <= 1000) return "1km";
  if (m <= 5000) return "5km";
  if (m <= 20000) return "20km";
  return "20km+";
}

export function getRideIntroPresentation(plan, locationStatus = "idle") {
  const rawDistance = plan?.distanceToStartMeters;
  const distance = Number(rawDistance);
  const hasDistance =
    rawDistance !== null &&
    rawDistance !== undefined &&
    rawDistance !== "" &&
    Number.isFinite(distance) &&
    distance >= 0;
  const atStart =
    plan?.locationQuality === "fresh" && plan?.approachTier === "at";
  const startLabel =
    plan?.startMode === "official" ? "תחילת המסלול" : "נקודת ההתחלה שבחרת";
  const headline = atStart
    ? "אתה בנקודת ההתחלה"
    : hasDistance
      ? `${startLabel} במרחק ${formatDistanceMeters(distance)}`
      : locationStatus === "loading"
        ? "מאתר את המיקום שלך…"
        : "לא הצלחנו לקבל מיקום עדכני";
  const guided = Number(plan?.guidedDistanceMeters);
  const skipped = Number(plan?.skippedMeters);
  return {
    headline,
    expectationText: atStart
      ? ""
      : "הניווט במסלול יתחיל כשתגיע לנקודת ההתחלה.",
    primaryLabel: atStart ? "התחל ניווט במסלול" : "צא לדרך",
    primaryEnabled: Boolean(plan) && locationStatus !== "loading",
    atStart,
    showExternalNav: Boolean(plan) && !atStart,
    nearestHintText:
      !atStart &&
      plan?.locationQuality === "fresh" &&
      plan?.startMode === "official" &&
      plan?.candidates?.nearestIsMeaningful
        ? "אתה קרוב לנקודה על המסלול — אפשר להתחיל ממנה בהגדרות רכיבה."
        : "",
    noticeText: rideSetupLocationNotice(locationStatus, plan?.locationQuality),
    showRetry:
      locationStatus === "denied" ||
      locationStatus === "unavailable" ||
      plan?.locationQuality === "stale" ||
      plan?.locationQuality === "inaccurate" ||
      plan?.locationQuality === "unavailable",
    rideLengthText: Number.isFinite(guided)
      ? `אורך המסלול: ${formatDistanceMeters(guided)}`
      : "",
    skipNoteText:
      Number.isFinite(skipped) && skipped > 50
        ? `ההתחלה שבחרת מדלגת על ${formatDistanceMeters(skipped)}`
        : "",
    directionNoteText:
      plan?.direction === "reverse" ? "המסלול ינווט בכיוון ההפוך." : "",
  };
}
