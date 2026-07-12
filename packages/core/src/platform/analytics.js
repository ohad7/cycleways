// Privacy-minimized Google Analytics adapter for the public website. Callers
// can only use event-specific helpers; raw URLs, coordinates, geometry and
// user-entered values are intentionally not accepted by this module.

const SAFE_METHODS = new Set(["click", "drag", "remove", "unknown"]);
const SAFE_PLATFORMS = new Set(["facebook", "whatsapp", "copy", "native", "other"]);
let lastTrackedPath = null;

export function analyticsEnabled(
  locationLike = globalThis.window?.location,
  navigatorLike = globalThis.navigator,
) {
  const host = String(locationLike?.hostname || "");
  if (!host || host === "localhost" || host === "127.0.0.1" || host.startsWith("10.0.")) {
    return false;
  }
  if (navigatorLike?.webdriver) return false;
  if (String(locationLike?.search || "").includes("app=1")) return false;
  if (globalThis.document?.documentElement?.classList?.contains("app-embed-bootstrap")) {
    return false;
  }
  return typeof globalThis.gtag === "function";
}

export function analyticsPagePath(locationLike = globalThis.window?.location) {
  const pathname = String(locationLike?.pathname || "/");
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return normalized.replace(/\/{2,}/g, "/") || "/";
}

export function analyticsPageLocation(locationLike = globalThis.window?.location) {
  const origin = String(locationLike?.origin || "").replace(/\/$/, "");
  return `${origin}${analyticsPagePath(locationLike)}`;
}

export function trackPageView(locationLike = globalThis.window?.location) {
  const pagePath = analyticsPagePath(locationLike);
  if (pagePath === lastTrackedPath) return;
  lastTrackedPath = pagePath;
  emitEvent("page_view", {
    page_location: analyticsPageLocation(locationLike),
    page_path: pagePath,
  });
}

export function trackRoutePointEvent(routePoints, selectedSegments, method) {
  emitEvent("route_point_modified", {
    points: count(routePoints),
    segments: count(selectedSegments),
    method: SAFE_METHODS.has(method) ? method : "unknown",
  });
}

export function trackUndoRedoEvent(action, undoStack, redoStack, routePoints, selectedSegments) {
  const safeAction = action === "redo" ? "redo" : "undo";
  emitEvent(`route_${safeAction}`, {
    undo_size: count(undoStack),
    redo_size: count(redoStack),
    segments: count(selectedSegments),
    points: count(routePoints),
  });
}

export function trackSearchEvent(query, routePoints, selectedSegments, success = false, options = {}) {
  emitEvent(success ? "location_search_success" : "location_search", {
    query_length: boundedNumber(String(query || "").length, 0, 500),
    has_route: count(selectedSegments) > 0,
    ...(success && typeof options.within_bounds === "boolean"
      ? { within_bounds: options.within_bounds }
      : {}),
  });
}

export function trackSocialShare(platform, routePoints, selectedSegments) {
  emitEvent("social_share", {
    platform: SAFE_PLATFORMS.has(platform) ? platform : "other",
    segments: count(selectedSegments),
    points: count(routePoints),
  });
}

export function trackSegmentFocus(_segmentName, source = "unknown") {
  emitEvent("segment_focus", { source: safeToken(source) });
}

export function trackWarningClick(warningType, routePoints, selectedSegments) {
  emitEvent("warning_clicked", {
    type: safeToken(warningType),
    segments: count(selectedSegments),
    points: count(routePoints),
  });
}

export function trackRouteOperation(operation, routePoints, selectedSegments, options = {}) {
  const points = count(routePoints);
  const segments = count(selectedSegments);
  switch (operation) {
    case "share":
      emitEvent("route_share", { points, segments });
      break;
    case "download":
      emitEvent("gpx_download", {
        points,
        segments,
        distance_km: boundedNumber(Number(options.distance) / 1000, 0, 10000, 1),
      });
      break;
    case "load_from_url":
      emitEvent("route_loaded", {
        segments,
        param_length: boundedNumber(options.route_param_length, 0, 100000),
      });
      break;
    case "reset":
      emitEvent("route_reset", {
        cleared_segments: boundedNumber(options.cleared_segments, 0, 10000),
        cleared_points: boundedNumber(options.cleared_points, 0, 10000),
      });
      break;
    default:
      emitEvent(`route_${safeToken(operation)}`, { points, segments });
  }
}

export function trackPageLoad(hasRouteParam, userAgent = "") {
  emitEvent("page_load", {
    has_route: Boolean(hasRouteParam),
    device: String(userAgent).includes("Mobile") ? "mobile" : "desktop",
  });
}

function emitEvent(eventName, parameters) {
  if (!analyticsEnabled()) return;
  globalThis.gtag("event", eventName, parameters);
}

function count(value) {
  return Array.isArray(value) ? boundedNumber(value.length, 0, 10000) : 0;
}

function safeToken(value) {
  const token = String(value || "unknown").toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(token) ? token : "other";
}

function boundedNumber(value, min, max, decimals = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  const bounded = Math.min(max, Math.max(min, number));
  return decimals > 0 ? Number(bounded.toFixed(decimals)) : Math.round(bounded);
}
