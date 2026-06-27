import { isWarningType, primaryPoiImage } from "./poiTypes.js";

// Ordered list of a route's points-of-interest for the "נקודות עניין בדרך"
// panel, shared by the web POIList and the React Native app. Warnings are
// excluded (they get their own treatment); the rest are ordered by route
// progress with the primary image path resolved for the card thumbnail.
export function routePoiList(activeDataPoints) {
  const items = (Array.isArray(activeDataPoints) ? activeDataPoints : [])
    .filter((point) => point && !isWarningType(point.type))
    .map((point) => {
      const image = primaryPoiImage(point);
      return {
        id: point.id,
        type: point.type,
        name: point.name || "",
        information: point.information || "",
        description: point.description || "",
        imagePath: image?.thumbnail || image?.photo || null,
        routeProgressMeters: Number.isFinite(point.routeProgressMeters)
          ? point.routeProgressMeters
          : null,
      };
    });

  items.sort((a, b) => {
    const ap = a.routeProgressMeters ?? Number.POSITIVE_INFINITY;
    const bp = b.routeProgressMeters ?? Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  return items;
}
