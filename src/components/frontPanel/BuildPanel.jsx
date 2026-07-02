import React from "react";
import Icon from "../Icon.jsx";
import PanelPoiCard from "./PanelPoiCard.jsx";
import { getPlannerBuildModel } from "@cycleways/core/ui/routePlannerPresentation.js";

export default function BuildPanel({
  routeState,
  catalogEntry,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  canDownload,
  onDownloadGpx,
  canShare,
  onShare,
  shareCopied,
  onSendToPhone,
  pois = [],
  onPoiClick,
  elevation,
  playback,
  error,
}) {
  const buildModel = getPlannerBuildModel(routeState);
  const hasRoute = buildModel.hasRoute;

  return (
    <div className="build-panel">
      {error && (
        <div className="build-panel__error">{error.message || "לא הצלחנו לעדכן את המסלול"}</div>
      )}
      <div className="build-panel__head">
        <div>
          <div className="eyebrow">
            {catalogEntry ? "מסלול מומלץ" : "המסלול שלי · טיוטה"}
          </div>
          <div className="build-panel__title">
            {catalogEntry?.name || "מסלול חדש"}
          </div>
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
          {buildModel.stats.map(([k, v]) => (
            <Stat key={k} k={k} v={v} />
          ))}
        </div>
      ) : (
        <p className="build-panel__empty">סמנו נקודות על המפה כדי לבנות מסלול.</p>
      )}

      {hasRoute && elevation}
      {hasRoute && playback}

      {hasRoute && (
        <div className="build-panel__actions">
          <button type="button" className="btn-primary" disabled={!canDownload} onClick={onDownloadGpx}>
            <Icon name="download-outline" /> GPX
          </button>
          <button type="button" className="btn-ghost" disabled={!canShare} onClick={onShare}>
            {shareCopied ? "✓ הועתק" : "שיתוף"}
          </button>
          <button type="button" className="btn-ghost" disabled={!canShare} onClick={onSendToPhone}>
            שלחו לטלפון
          </button>
        </div>
      )}

      {hasRoute && pois.length > 0 && (
        <div className="build-panel__pois">
          <div className="dlabel">נקודות עניין בדרך <span className="tag">{pois.length} נקודות זוהו</span></div>
          {pois.map(({ poi, distanceLabel }, i) => (
            <PanelPoiCard key={poi.id || i} poi={poi} distanceLabel={distanceLabel} onSelect={onPoiClick} />
          ))}
        </div>
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
