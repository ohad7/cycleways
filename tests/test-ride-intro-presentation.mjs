import assert from "node:assert/strict";
import {
  confirmDistanceBucket,
  getRideIntroPresentation,
  rideSetupLocationNotice,
} from "@cycleways/core/navigation/rideIntroPresentation.js";

{
  const p = getRideIntroPresentation(
    {
      distanceToStartMeters: 12000,
      approachTier: "far",
      locationQuality: "fresh",
      startMode: "official",
      direction: "forward",
      skippedMeters: 0,
      guidedDistanceMeters: 24600,
      candidates: { nearestIsMeaningful: false },
    },
    "ready",
  );
  assert.equal(p.headline, "תחילת המסלול במרחק 12.0 ק״מ");
  assert.equal(p.expectationText, "נכוון אותך לנקודת ההתחלה ומשם נמשיך במסלול.");
  assert.equal(p.primaryLabel, "התחל הכוונה");
  assert.equal(p.primaryEnabled, true);
  assert.equal(p.atStart, false);
  assert.equal(p.showExternalNav, false);
  assert.equal(p.nearestHintText, "");
  assert.equal(p.rideLengthText, "");
  assert.equal(p.skipNoteText, "");
  assert.equal(p.directionNoteText, "");
}

{
  const p = getRideIntroPresentation(
    {
      distanceToStartMeters: 10,
      approachTier: "at",
      locationQuality: "fresh",
      startMode: "official",
      direction: "forward",
      skippedMeters: 0,
      guidedDistanceMeters: 24600,
      candidates: { nearestIsMeaningful: false },
    },
    "ready",
  );
  assert.equal(p.headline, "אתה בנקודת ההתחלה");
  assert.equal(p.expectationText, "");
  assert.equal(p.primaryLabel, "התחל ניווט");
  assert.equal(p.atStart, true);
  assert.equal(p.showExternalNav, false);
}

{
  const p = getRideIntroPresentation(null, "loading");
  assert.equal(p.headline, "מאתר את המיקום שלך…");
  assert.equal(p.primaryEnabled, false);
}

{
  const p = getRideIntroPresentation(
    {
      distanceToStartMeters: null,
      approachTier: "unknown",
      locationQuality: "unavailable",
      startMode: "official",
      direction: "forward",
      skippedMeters: 0,
      guidedDistanceMeters: 24600,
      candidates: null,
    },
    "unavailable",
  );
  assert.equal(p.headline, "לא הצלחנו לקבל מיקום עדכני");
  assert.equal(p.showRetry, true);
  assert.equal(p.primaryEnabled, true);
  assert.equal(p.showExternalNav, false);
}

{
  const base = {
    distanceToStartMeters: 8000,
    approachTier: "far",
    locationQuality: "fresh",
    startMode: "official",
    direction: "forward",
    skippedMeters: 0,
    guidedDistanceMeters: 24600,
    candidates: { nearestIsMeaningful: true },
  };
  assert.equal(getRideIntroPresentation(base, "ready").nearestHintText, "");
  assert.equal(
    getRideIntroPresentation({ ...base, locationQuality: "stale" }, "ready")
      .nearestHintText,
    "",
  );
  assert.equal(
    getRideIntroPresentation({ ...base, startMode: "nearest" }, "ready")
      .nearestHintText,
    "",
  );
}

{
  const p = getRideIntroPresentation(
    {
      distanceToStartMeters: 650,
      approachTier: "near",
      locationQuality: "fresh",
      startMode: "custom",
      direction: "reverse",
      skippedMeters: 3100,
      guidedDistanceMeters: 21500,
      candidates: { nearestIsMeaningful: true },
    },
    "ready",
  );
  assert.equal(p.headline, "נקודת ההתחלה שבחרת במרחק 650 מ׳");
  assert.equal(p.skipNoteText, "ההתחלה שבחרת מדלגת על 3.1 ק״מ");
  assert.equal(p.directionNoteText, "המסלול ינווט בכיוון ההפוך.");
}

{
  const p = getRideIntroPresentation(
    {
      distanceToStartMeters: 2000,
      approachTier: "unknown",
      locationQuality: "stale",
      startMode: "official",
      direction: "forward",
      skippedMeters: 0,
      guidedDistanceMeters: 24600,
      candidates: null,
    },
    "ready",
  );
  assert.equal(p.headline, "תחילת המסלול במרחק 2.0 ק״מ");
  assert.equal(p.noticeText, rideSetupLocationNotice("ready", "stale"));
  assert.equal(p.showRetry, true);
}

assert.equal(rideSetupLocationNotice("loading"), "מאתר את המיקום שלך…");
assert.equal(
  rideSetupLocationNotice("denied"),
  "אין הרשאת מיקום. אפשר לבחור התחלה ידנית או לנסות שוב.",
);
assert.equal(rideSetupLocationNotice("unavailable"), "לא הצלחנו לקבל מיקום עדכני.");
assert.equal(
  rideSetupLocationNotice("ready", "stale"),
  "המיקום הקיים אינו עדכני; ההמלצה לא נבחרה אוטומטית.",
);
assert.equal(
  rideSetupLocationNotice("ready", "inaccurate"),
  "דיוק המיקום נמוך; מומלץ לבחור נקודת התחלה ידנית.",
);
assert.equal(rideSetupLocationNotice("ready", "fresh"), "");

assert.equal(confirmDistanceBucket(40), "at");
assert.equal(confirmDistanceBucket(900), "1km");
assert.equal(confirmDistanceBucket(4200), "5km");
assert.equal(confirmDistanceBucket(18000), "20km");
assert.equal(confirmDistanceBucket(30000), "20km+");
assert.equal(confirmDistanceBucket(null), "unknown");
assert.equal(confirmDistanceBucket(-5), "unknown");

console.log("test-ride-intro-presentation OK");
