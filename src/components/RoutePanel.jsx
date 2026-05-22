import React from "react";

function RoutePanel({
  error,
  onRemoveRoutePoint,
  onSelectRoutePoint,
  routeState,
  selectedRoutePointIndex,
}) {
  const message = getRouteMessage(routeState);
  const canDownload = routeState.geometry.length >= 2;
  const hasBrokenRoute =
    routeState.points.length >= 2 && routeState.geometry.length < 2;
  const selectedRoutePoint =
    Number.isInteger(selectedRoutePointIndex) &&
    selectedRoutePointIndex >= 0 &&
    selectedRoutePointIndex < routeState.points.length
      ? routeState.points[selectedRoutePointIndex]
      : null;

  return (
    <section
      className={`react-route-panel${canDownload ? "" : " react-route-panel--empty"}`}
      aria-live="polite"
    >
      <div>
        <h2>מסלול</h2>
        <p>{message}</p>
        {error && (
          <p className="react-route-panel__error">
            {error.message || "לא הצלחנו לעדכן את המסלול"}
          </p>
        )}
        {(hasBrokenRoute || routeState.activeDataPoints.length > 0) && (
          <ul className="react-route-panel__warnings">
            {hasBrokenRoute && <li>מסלול שבור בין הנקודות שנבחרו.</li>}
            {routeState.activeDataPoints.length > 0 && (
              <li>
                יש {routeState.activeDataPoints.length} נקודות מידע חשובות
                במסלול.
              </li>
            )}
          </ul>
        )}
        {routeState.points.length > 0 && (
          <div className="react-route-panel__point-list">
            <span>נקודות מסלול</span>
            <div>
              {routeState.points.map((point, index) => (
                <button
                  className={`react-route-panel__point-chip${
                    index === selectedRoutePointIndex
                      ? " react-route-panel__point-chip--selected"
                      : ""
                  }`}
                  key={point.id || `${point.lat}-${point.lng}-${index}`}
                  type="button"
                  onClick={() => onSelectRoutePoint(index)}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          </div>
        )}
        {selectedRoutePoint && (
          <div className="react-route-panel__point-actions">
            <span>נקודה {selectedRoutePointIndex + 1} נבחרה</span>
            <button
              className="react-button react-button--secondary"
              type="button"
              onClick={() => onRemoveRoutePoint(selectedRoutePointIndex)}
            >
              הסר נקודה
            </button>
          </div>
        )}
      </div>
      <dl className="react-route-panel__stats">
        <div>
          <dt>נקודות</dt>
          <dd>{routeState.points.length}</dd>
        </div>
        <div>
          <dt>מקטעי CW</dt>
          <dd>{routeState.selectedSegments.length}</dd>
        </div>
        <div>
          <dt>מרחק</dt>
          <dd>{formatDistance(routeState.distance)}</dd>
        </div>
        <div>
          <dt>עליות</dt>
          <dd>{Math.round(routeState.elevationGain || 0)} מ׳</dd>
        </div>
        <div>
          <dt>ירידות</dt>
          <dd>{Math.round(routeState.elevationLoss || 0)} מ׳</dd>
        </div>
      </dl>
    </section>
  );
}

export function getRouteMessage(routeState) {
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

export function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return "0 ק״מ";
  return `${(distanceMeters / 1000).toFixed(1)} ק״מ`;
}

export default RoutePanel;
