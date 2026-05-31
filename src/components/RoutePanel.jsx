import React from "react";
import {
  formatDistance,
  getRouteMessage,
  getRoutePlannerPresentation,
} from "@cycleways/core/ui/routePlannerPresentation.js";

function RoutePanel({
  error,
  onRemoveRoutePoint,
  onSelectRoutePoint,
  routeState,
  selectedRoutePointIndex,
}) {
  const presentation = getRoutePlannerPresentation(
    routeState,
    selectedRoutePointIndex,
  );

  return (
    <section
      className={`react-route-panel${presentation.canDownload ? "" : " react-route-panel--empty"}`}
      aria-live="polite"
    >
      <div>
        <h2>מסלול</h2>
        <p>{presentation.message}</p>
        {error && (
          <p className="react-route-panel__error">
            {error.message || "לא הצלחנו לעדכן את המסלול"}
          </p>
        )}
        {presentation.warnings.length > 0 && (
          <ul className="react-route-panel__warnings">
            {presentation.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
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
        {presentation.selectedRoutePoint && (
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
        {presentation.stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export { formatDistance, getRouteMessage };

export default RoutePanel;
