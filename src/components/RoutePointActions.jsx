import React from "react";
import Icon from "./Icon.jsx";

// Floating actions for the selected route point: shown whenever a point is
// selected (tap on touch, click on desktop). Gives touch users a way to
// remove a single point — desktop right-click removal still works.
export default function RoutePointActions({
  selectedIndex,
  pointCount,
  onRemove,
  onDismiss,
}) {
  if (!Number.isInteger(selectedIndex)) return null;
  return (
    <div className="route-point-actions" role="toolbar" aria-label="פעולות נקודת מסלול">
      <span className="route-point-actions__label">
        נקודה {selectedIndex + 1} מתוך {pointCount}
      </span>
      <button
        type="button"
        className="route-point-actions__remove"
        onClick={onRemove}
      >
        <Icon name="trash-outline" /> הסר נקודה
      </button>
      <button
        type="button"
        className="route-point-actions__dismiss"
        aria-label="ביטול בחירה"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
