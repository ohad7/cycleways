import {
  POI_COLORS,
  POI_EMOJIS,
  POI_LABELS,
  POI_WARNING_PRIORITY,
} from "../data/poiTypes.js";

export const ROUTE_SEARCH_PLACEHOLDER = "ישוב/עיר, לדוגמא: דפנה";

export function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return "0 ק״מ";
  return `${(distanceMeters / 1000).toFixed(1)} ק״מ`;
}

export function getRouteMessage(routeState) {
  if (routeState.pendingPoints?.length > 0) {
    return routeState.pendingPoints.length === 1
      ? "בודק את נקודת המסלול על רשת הדרכים..."
      : `בודק ${routeState.pendingPoints.length} נקודות מסלול על רשת הדרכים...`;
  }

  if (routeState.points.length === 0) {
    return "לחץ על נקודות במפה ליד דרך או שביל כדי לבנות מסלול.";
  }

  if (routeState.points.length === 1) {
    return "נקודת התחלה נוספה. הוסף נקודה נוספת כדי ליצור מסלול.";
  }

  if (routeState.geometry.length < 2) {
    return "לא הצלחנו ליצור מסלול בין הנקודות האלה על רשת הדרכים.";
  }

  return `מרחק: ${formatDistance(routeState.distance)} • ↑ ${Math.round(
    routeState.elevationGain || 0,
  )} מ׳ • ↓ ${Math.round(routeState.elevationLoss || 0)} מ׳`;
}

export function getRoutePlannerPresentation(
  routeState,
  selectedRoutePointIndex,
) {
  const selectedRoutePoint =
    Number.isInteger(selectedRoutePointIndex) &&
    selectedRoutePointIndex >= 0 &&
    selectedRoutePointIndex < routeState.points.length
      ? routeState.points[selectedRoutePointIndex]
      : null;
  const hasBrokenRoute =
    routeState.points.length >= 2 && routeState.geometry.length < 2;
  const activeDataPoints = Array.isArray(routeState.activeDataPoints)
    ? routeState.activeDataPoints
    : [];

  return {
    canDownload: routeState.geometry.length >= 2,
    hasBrokenRoute,
    message: getRouteMessage(routeState),
    selectedRoutePoint,
    stats: [
      ["נקודות", String(routeState.points.length)],
      ["מקטעי CW", String(routeState.selectedSegments.length)],
      ["מרחק", formatDistance(routeState.distance)],
      ["עליות", `${Math.round(routeState.elevationGain || 0)} מ׳`],
      ["ירידות", `${Math.round(routeState.elevationLoss || 0)} מ׳`],
    ],
    warnings: [
      ...(hasBrokenRoute ? ["מסלול שבור בין הנקודות שנבחרו."] : []),
      ...(activeDataPoints.length > 0
        ? [`יש ${activeDataPoints.length} נקודות מידע חשובות במסלול.`]
        : []),
    ],
  };
}

export function getRouteWarningPresentation(
  activeDataPoints = [],
  selectedDataMarker = null,
) {
  const warnings = normalizeWarnings(activeDataPoints, selectedDataMarker);
  const countText = warnings.length > 1 ? ` (${warnings.length})` : "";

  return {
    count: warnings.length,
    countText,
    groups: getWarningGroups(warnings),
    toggleLabel: `⚠️ מידע חשוב${countText}`,
    warnings,
  };
}

export function getWarningGroups(warnings = []) {
  const grouped = new Map();
  warnings.forEach((warning) => {
    const segmentName = warning?.segmentName || "מידע חשוב";
    if (!grouped.has(segmentName)) {
      grouped.set(segmentName, []);
    }
    grouped.get(segmentName).push(warning);
  });

  return [...grouped.entries()].map(([segmentName, segmentWarnings]) => {
    const types = getWarningTypes(segmentWarnings);
    return {
      backgroundColor: getWarningBackgroundColor(types),
      icons: types.map((type) => POI_EMOJIS[type] || "⚠️"),
      label: getWarningLabel(types),
      segmentName,
      types,
      warnings: segmentWarnings,
    };
  });
}

export function getWarningTypes(warnings = []) {
  return [
    ...new Set(
      warnings.map((warning) => warning?.type || "warning").filter(Boolean),
    ),
  ];
}

export function getWarningLabel(warningTypes = []) {
  if (warningTypes.length === 1) {
    const [type] = warningTypes;
    return POI_LABELS[type] || type;
  }
  return "אזהרות";
}

export function getWarningBackgroundColor(warningTypes = []) {
  if (warningTypes.length === 1) {
    const [type] = warningTypes;
    return POI_COLORS[type] || "#f44336";
  }

  const highestPriority = POI_WARNING_PRIORITY.find((type) =>
    warningTypes.includes(type),
  );
  return POI_COLORS[highestPriority] || "#f44336";
}

function normalizeWarnings(activeDataPoints, selectedDataMarker) {
  const routeWarnings = Array.isArray(activeDataPoints)
    ? activeDataPoints
    : [];
  if (routeWarnings.length > 0) return routeWarnings;
  return selectedDataMarker ? [selectedDataMarker] : [];
}
