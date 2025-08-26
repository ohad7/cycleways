
// Analytics tracking utility module
export function trackEvent(eventName, parameters = {}) {
  if (typeof gtag !== "undefined") {
    gtag("event", eventName, parameters);
  }
}

// Route-specific tracking functions
export function trackRouteEvent(eventName, routePoints, selectedSegments, additionalParams = {}) {
  const baseParams = {
    point_count: routePoints.length,
    segments_count: selectedSegments.length,
    ...additionalParams
  };
  trackEvent(eventName, baseParams);
}

export function trackRoutePointEvent(eventName, routePoints, selectedSegments, method, additionalParams = {}) {
  trackRouteEvent(eventName, routePoints, selectedSegments, {
    method: method,
    ...additionalParams
  });
}

export function trackUndoRedoEvent(eventName, undoStack, redoStack, routePoints, selectedSegments) {
  trackEvent(eventName, {
    undo_stack_size: undoStack.length,
    redo_stack_size: redoStack.length,
    current_segments: selectedSegments.length,
    current_points: routePoints.length
  });
}

export function trackSearchEvent(eventName, query, routePoints, selectedSegments, additionalParams = {}) {
  trackEvent(eventName, {
    query_length: query.length,
    has_current_route: selectedSegments.length > 0,
    ...additionalParams
  });
}

export function trackSocialShare(platform, routePoints, selectedSegments) {
  trackEvent("social_share", {
    platform: platform,
    route_segments: selectedSegments.length,
    route_points: routePoints.length
  });
}

export function trackSegmentFocus(segmentName, source = "unknown") {
  trackEvent("segment_focus", {
    segment_name: segmentName,
    source: source
  });
}

export function trackWarningClick(warningType, routePoints, selectedSegments, additionalParams = {}) {
  trackEvent("warning_clicked", {
    warning_type: warningType,
    segments_count: selectedSegments.length,
    ...additionalParams
  });
}

export function trackRouteOperation(operationType, routePoints, selectedSegments, additionalParams = {}) {
  const routeInfo = {
    distance: additionalParams.distance || 0,
    segments: selectedSegments.length,
    points: routePoints.length
  };

  switch (operationType) {
    case "share":
      trackEvent("route_share", {
        route_segments: selectedSegments.length,
        route_points: routePoints.length,
        route_id: additionalParams.route_id || "",
        ...additionalParams
      });
      break;
    case "download":
      trackEvent("gpx_download", {
        route_segments: selectedSegments.length,
        route_points: routePoints.length,
        route_distance_km: parseFloat((routeInfo.distance / 1000).toFixed(1)),
        ...additionalParams
      });
      break;
    case "load_from_url":
      trackEvent("route_loaded_from_url", {
        segments_count: selectedSegments.length,
        route_param_length: additionalParams.route_param_length || 0
      });
      break;
    default:
      trackRouteEvent(operationType, routePoints, selectedSegments, additionalParams);
  }
}

export function trackPageLoad(hasRouteParam, userAgent) {
  trackEvent("page_load", {
    has_route_param: hasRouteParam,
    user_agent: userAgent.includes("Mobile") ? "mobile" : "desktop"
  });
}

export function trackTutorial(action, hasCurrentRoute, source = "unknown") {
  trackEvent(`tutorial_${action}`, {
    has_current_route: hasCurrentRoute,
    source: source
  });
}
