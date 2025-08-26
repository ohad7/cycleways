
// Analytics tracking utility module
export function trackEvent(eventName, parameters = {}) {
  if (typeof gtag !== "undefined") {
    gtag("event", eventName, parameters);
  }
}

// Route-specific tracking functions
export function trackRoutePointEvent(routePoints, selectedSegments, method, additionalParams = {}) {
  trackEvent("route_point_modified", {
    points: routePoints.length,
    segments: selectedSegments.length,
    method: method,
    ...additionalParams
  });
}

export function trackUndoRedoEvent(action, undoStack, redoStack, routePoints, selectedSegments) {
  trackEvent(`route_${action}`, {
    undo_size: undoStack.length,
    redo_size: redoStack.length,
    segments: selectedSegments.length,
    points: routePoints.length
  });
}

export function trackSearchEvent(query, routePoints, selectedSegments, success = false, additionalParams = {}) {
  const eventName = success ? "location_search_success" : "location_search";
  trackEvent(eventName, {
    query_length: query.length,
    has_route: selectedSegments.length > 0,
    ...additionalParams
  });
}

export function trackSocialShare(platform, routePoints, selectedSegments) {
  trackEvent("social_share", {
    platform: platform,
    segments: selectedSegments.length,
    points: routePoints.length
  });
}

export function trackSegmentFocus(segmentName, source = "unknown") {
  trackEvent("segment_focus", {
    segment: segmentName,
    source: source
  });
}

export function trackWarningClick(warningType, routePoints, selectedSegments, additionalParams = {}) {
  trackEvent("warning_clicked", {
    type: warningType,
    segments: selectedSegments.length,
    ...additionalParams
  });
}

export function trackRouteOperation(operation, routePoints, selectedSegments, additionalParams = {}) {
  const baseParams = {
    segments: selectedSegments.length,
    points: routePoints.length,
    ...additionalParams
  };

  switch (operation) {
    case "share":
      trackEvent("route_share", baseParams);
      break;
    case "download":
      trackEvent("gpx_download", {
        ...baseParams,
        distance_km: baseParams.distance ? parseFloat((baseParams.distance / 1000).toFixed(1)) : 0
      });
      break;
    case "load_from_url":
      trackEvent("route_loaded", {
        segments: selectedSegments.length,
        param_length: additionalParams.route_param_length || 0
      });
      break;
    case "reset":
      trackEvent("route_reset", {
        cleared_segments: additionalParams.cleared_segments || 0,
        cleared_points: additionalParams.cleared_points || 0
      });
      break;
    default:
      trackEvent(`route_${operation}`, baseParams);
  }
}

export function trackPageLoad(hasRouteParam, userAgent) {
  trackEvent("page_load", {
    has_route: hasRouteParam,
    device: userAgent.includes("Mobile") ? "mobile" : "desktop"
  });
}

export function trackTutorial(action, hasCurrentRoute, source = "unknown") {
  trackEvent(`tutorial_${action}`, {
    has_route: hasCurrentRoute,
    source: source
  });
}
