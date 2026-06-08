import React from "react";
import Icon from "../Icon.jsx";
import { formatLegacyDistance } from "../ElevationProfile.jsx";
import PanelPoiCard from "./PanelPoiCard.jsx";

export default function BuildPanel({
  routeState,
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
  warningPresentation,
  onWarningFocus,
  pois = [],
  onPoiClick,
  elevation,
  error,
}) {
  const hasRoute = routeState.geometry.length >= 2;
  const warningGroups = warningPresentation?.groups || [];

  return (
    <div className="build-panel">
      {error && (
        <div className="build-panel__error">{error.message || "לא הצלחנו לעדכן את המסלול"}</div>
      )}
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

      {hasRoute && elevation}

      {hasRoute && (
        <div className="build-panel__actions">
          <button type="button" className="btn-primary" disabled={!canDownload} onClick={onDownloadGpx}>
            <Icon name="download-outline" /> GPX
          </button>
          <button type="button" className="btn-ghost" disabled={!canShare} onClick={onShare}>
            {shareCopied ? "✓ הועתק" : "שיתוף"}
          </button>
        </div>
      )}

      {hasRoute && warningGroups.length > 0 && (
        <div className="build-panel__warnings">
          <div className="dlabel">מידע חשוב</div>
          {warningGroups.map((g) => (
            <button
              key={g.segmentName}
              type="button"
              className="build-warning"
              style={{ backgroundColor: g.backgroundColor }}
              onClick={() => onWarningFocus?.(g.warnings?.[0])}
            >
              <span>{g.label}</span>
              <span aria-hidden="true">{g.icons.join(" ")}</span>
            </button>
          ))}
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
