import React from "react";
import Icon from "../Icon.jsx";
import { formatLegacyDistance } from "../ElevationProfile.jsx";

export default function BuildPanel({
  routeState,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
}) {
  const hasRoute = routeState.geometry.length >= 2;
  return (
    <div className="build-panel">
      <div className="build-panel__head">
        <div>
          <div className="eyebrow">המסלול שלי · טיוטה</div>
          <div className="build-panel__title">מסלול חדש</div>
        </div>
        <div className="build-panel__tools">
          <button type="button" disabled={!canUndo} onClick={onUndo} title="בטל" aria-label="בטל">
            <Icon name="arrow-undo-outline" />
          </button>
          <button type="button" disabled={!canRedo} onClick={onRedo} title="בצע שוב" aria-label="בצע שוב">
            <Icon name="arrow-redo-outline" />
          </button>
          <button type="button" disabled={routeState.points.length === 0} onClick={onClear} title="נקה" aria-label="נקה">
            <Icon name="trash-outline" />
          </button>
        </div>
      </div>

      {hasRoute ? (
        <div className="build-panel__stats">
          <Stat k="אורך" v={formatLegacyDistance(routeState.distance)} />
          <Stat k="טיפוס" v={`${Math.round(routeState.elevationGain || 0)} מ׳`} />
          <Stat k="ירידה" v={`${Math.round(routeState.elevationLoss || 0)} מ׳`} />
        </div>
      ) : (
        <p className="build-panel__empty">סמנו נקודות על המפה כדי לבנות מסלול.</p>
      )}
    </div>
  );
}

function Stat({ k, v }) {
  return (
    <div className="build-stat">
      <div className="build-stat__k">{k}</div>
      <div className="build-stat__v">{v}</div>
    </div>
  );
}
