const UNAVAILABLE_COPY = Object.freeze({
  no_canonical_alignment: {
    he: "אין למסדרון הזה תוואי רכיבה מפורסם בכיוון הזה",
    en: "This corridor has no published riding alignment in this direction",
  },
  outside_logical_corridor: {
    he: "הדרך האפשרית נמצאת מחוץ למסדרון המוצג",
    en: "The available road lies outside the displayed corridor",
  },
  editorially_not_offered: {
    he: "הכיוון הזה אינו מוצע כרגע על ידי CycleWays",
    en: "CycleWays does not currently offer this direction",
  },
});

export const ROUTE_COMMAND_COPY = Object.freeze({
  "routing-coverage-unavailable": {
    he: "נתוני הניתוב הדרושים אינם זמינים כרגע. המסלול הקיים לא השתנה.",
    en: "Required routing data is unavailable. The existing route was not changed.",
  },
  "return-path-unavailable": {
    he: "לא נמצא מסלול חזרה מותר. המסלול הקיים לא השתנה.",
    en: "No permitted return route was found. The existing route was not changed.",
  },
  "opposite-direction-path-unavailable": {
    he: "לא נמצא מסלול מותר בכיוון ההפוך. המסלול הקיים לא השתנה.",
    en: "No permitted opposite-direction route was found. The existing route was not changed.",
  },
  "return-already-complete": {
    he: "המסלול כבר מסתיים בנקודת ההתחלה.",
    en: "The route already ends at its starting point.",
  },
  "route-proposal-stale": {
    he: "הטיוטה כבר אינה תואמת למסלול הנוכחי. נסו שוב.",
    en: "This proposal no longer matches the current route. Please try again.",
  },
});

export function routeCommandMessage(code, locale = "he") {
  const copy = ROUTE_COMMAND_COPY[code] || {
    he: "לא הצלחנו לתכנן את השינוי. המסלול הקיים לא השתנה.",
    en: "The change could not be planned. The existing route was not changed.",
  };
  return copy[locale === "en" ? "en" : "he"];
}

export function segmentDirectionAvailability(segment, locale = "he") {
  const alignments = segment?.alignments || {};
  const aToB = alignments.aToB?.disposition === "accepted";
  const bToA = alignments.bToA?.disposition === "accepted";
  if (aToB && bToA) {
    return { kind: "both", label: locale === "en" ? "Both directions" : "לשני הכיוונים" };
  }
  if (aToB) {
    return { kind: "aToB", label: directionLabel(segment, "aToB", locale) };
  }
  if (bToA) {
    return { kind: "bToA", label: directionLabel(segment, "bToA", locale) };
  }
  return { kind: "none", label: locale === "en" ? "Display only" : "לתצוגה בלבד" };
}

export function directionLabel(segment, alignmentKey, locale = "he") {
  const targetKey = alignmentKey === "bToA" ? "a" : "b";
  const endpoint = segment?.endpoints?.[targetKey];
  const localized = endpoint?.labels?.[locale === "en" ? "en" : "he"];
  if (typeof localized === "string" && localized.trim()) {
    return locale === "en" ? `Toward ${localized.trim()}` : `לכיוון ${localized.trim()}`;
  }
  const sourceKey = targetKey === "a" ? "b" : "a";
  const bearing = bearingDegrees(
    segment?.endpoints?.[sourceKey]?.coordinate,
    endpoint?.coordinate,
  );
  const compass = localizedCompass(bearing, locale);
  return locale === "en" ? `Toward ${compass}` : `לכיוון ${compass}`;
}

export function unavailableDirectionMessage(alignment, locale = "he") {
  const code = alignment?.unavailableReasonCode || "editorially_not_offered";
  const copy = UNAVAILABLE_COPY[code] || UNAVAILABLE_COPY.editorially_not_offered;
  return copy[locale === "en" ? "en" : "he"];
}

function bearingDegrees(from, to) {
  if (!Array.isArray(from) || !Array.isArray(to)) return null;
  const dx = Number(to[0]) - Number(from[0]);
  const dy = Number(to[1]) - Number(from[1]);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    return null;
  }
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

function localizedCompass(bearing, locale) {
  const names = locale === "en"
    ? ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]
    : ["צפון", "צפון־מזרח", "מזרח", "דרום־מזרח", "דרום", "דרום־מערב", "מערב", "צפון־מערב"];
  if (!Number.isFinite(bearing)) return locale === "en" ? "the destination" : "היעד";
  return names[Math.round(bearing / 45) % names.length];
}
