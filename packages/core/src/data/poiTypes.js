export const POI_LABELS = {
  // existing warnings
  payment: "תשלום",
  gate: "שער",
  mud: "בוץ",
  warning: "אזהרה",
  slope: "שיפוע",
  narrow: "שוליים צרים",
  severe: "סכנה",
  // new POI types
  viewpoint: "תצפית",
  landmark: "אתר היסטורי",
  cafe: "בית קפה",
  restaurant: "מסעדה",
  bike_shop: "חנות אופניים",
  flora: "פרחים",
  nature: "טבע",
  tree: "עץ מיוחד",
  river: "נחל",
  beach: "חוף",
  rest_stop: "פינת מנוחה",
};

export const POI_COLORS = {
  // existing warnings
  payment: "#4a5783",
  mud: "#9d744d",
  warning: "#FF9800",
  slope: "#8e5b9a",
  narrow: "#d6568b",
  severe: "#ff675b",
  gate: "#FF5722",
  // new POI types
  viewpoint: "#3aa17e",
  landmark: "#6c5ce7",
  cafe: "#b07a3f",
  restaurant: "#c0392b",
  bike_shop: "#2980b9",
  flora: "#e84393",
  nature: "#27ae60",
  tree: "#2e7d32",
  river: "#1580b7",
  beach: "#d99f3d",
  rest_stop: "#16a085",
};

export const POI_EMOJIS = {
  // existing warnings
  payment: "💵",
  gate: "🚧",
  mud: "⚠️",
  warning: "⚠️",
  slope: "⛰️",
  narrow: "⛍",
  severe: "‼️",
  // new POI types
  viewpoint: "🔭",
  landmark: "🏛️",
  cafe: "☕",
  restaurant: "🍽️",
  bike_shop: "🚲",
  flora: "🌼",
  nature: "🌿",
  tree: "🌳",
  river: "💧",
  beach: "🏖️",
  rest_stop: "🪑",
};

export const POI_ICONS = {
  payment: "bank-11",
  gate: "barrier-11",
  mud: "wetland-11",
  warning: "caution-11",
  slope: "mountain-11",
  narrow: "car-11",
  severe: "roadblock-11",
  viewpoint: "marker-11",
  landmark: "marker-11",
  cafe: "marker-11",
  restaurant: "marker-11",
  bike_shop: "marker-11",
  flora: "marker-11",
  nature: "marker-11",
  tree: "marker-11",
  river: "marker-11",
  beach: "marker-11",
  rest_stop: "marker-11",
};

export const POI_TYPES = Object.freeze(Object.keys(POI_LABELS));

export const POI_TYPE_OPTIONS = Object.freeze(
  POI_TYPES.map((value) => ({
    value,
    label: POI_LABELS[value] || value,
  })),
);

export const POI_WARNING_PRIORITY = [
  "severe",
  "narrow",
  "gate",
  "slope",
  "mud",
  "payment",
  "warning",
];

export const POI_WARNING_TYPES = new Set(POI_WARNING_PRIORITY);

export function isWarningType(type) {
  return POI_WARNING_TYPES.has(type);
}

export function poiLabel(type) {
  return POI_LABELS[type] || type || "נקודה";
}

export function poiColor(type) {
  return POI_COLORS[type] || "#607076";
}

export function poiEmoji(type) {
  return POI_EMOJIS[type] || "📍";
}

export function poiIcon(type) {
  return POI_ICONS[type] || "marker-11";
}

export function isGalleryEligiblePoi(point) {
  if (!point || isWarningType(point.type)) return false;
  if (point.gallery === false) return false;
  return normalizePoiImages(point).length > 0;
}

function imageEntry(photo, thumbnail) {
  const p = typeof photo === "string" ? photo.trim() : "";
  if (!p) return null;
  const t = typeof thumbnail === "string" && thumbnail.trim() ? thumbnail.trim() : p;
  return { photo: p, thumbnail: t };
}

// Normalize a data marker's images to an array of { photo, thumbnail }.
// Prefers marker.images; falls back to legacy photo/thumbnail; else [].
export function normalizePoiImages(marker) {
  if (!marker || typeof marker !== "object") return [];
  if (Array.isArray(marker.images) && marker.images.length > 0) {
    return marker.images
      .map((entry) =>
        entry && typeof entry === "object"
          ? imageEntry(entry.photo, entry.thumbnail)
          : null,
      )
      .filter(Boolean);
  }
  const legacy = imageEntry(marker.photo, marker.thumbnail);
  return legacy ? [legacy] : [];
}

export function primaryPoiImage(marker) {
  const images = normalizePoiImages(marker);
  return images.length > 0 ? images[0] : null;
}
