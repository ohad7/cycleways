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
  rest_stop: "🪑",
};

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
