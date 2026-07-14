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
  showSendToPhone = true,
  pois = [],
  onPoiClick,
  elevation,
  playback,
  routeProposal = null,
  onReturnToStart,
  onPlanOppositeDirection,
  onAcceptRouteProposal,
  onDismissRouteProposal,
  error,
  emptyState,
  legalLinks = null,
}) {
  const buildModel = getPlannerBuildModel(routeState);
  const hasRoute = buildModel.hasRoute;

  return (
    <div className="build-panel">
      {error && (
        <div className="build-panel__error" role="alert">{error.message || "לא הצלחנו לעדכן את המסלול"}</div>
      )}
      <div className="build-panel__head">
        <div>
          <div className="eyebrow">
            {catalogEntry ? "מסלול מומלץ" : "המסלול שלי · טיוטה"}
          </div>
          <div className="build-panel__title">
            {catalogEntry?.name || "מסלול חדש"}
          </div>
          {catalogEntry?.slug ? (
            <a
              className="build-panel__route-link"
              href={`/routes/${catalogEntry.slug}`}
              aria-label={`לעמוד המסלול ${catalogEntry.name}`}
            >
              לעמוד המסלול
            </a>
          ) : null}
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
      ) : routeState.points.length === 0 && emptyState ? (
        emptyState
      ) : (
        <p className="build-panel__empty">סמנו נקודות על המפה כדי לבנות מסלול.</p>
      )}

      {hasRoute && elevation}
      {hasRoute && playback}

      {hasRoute && (
        <div className="build-panel__direction-actions" aria-label="פעולות כיוון וחזרה">
          <button type="button" className="btn-ghost" onClick={onReturnToStart}>
            תכנון חזרה לנקודת ההתחלה
          </button>
          <button type="button" className="btn-ghost" onClick={onPlanOppositeDirection}>
            תכנון המסלול בכיוון ההפוך
          </button>
        </div>
      )}

      {routeProposal?.routeInfo ? (
        <div className="build-panel__route-proposal" role="status" aria-live="polite">
          <strong>
            {routeProposal.purpose === "return"
              ? "טיוטת מסלול חזרה"
              : "טיוטה בכיוון ההפוך"}
          </strong>
          <span>
            {formatProposalDistance(routeProposal.routeInfo.distance)} · שינוי של {formatProposalDelta(
              routeProposal.routeInfo.distance - routeState.distance,
            )}
          </span>
          <small>המסלול הקיים יישאר ללא שינוי עד לאישור.</small>
          <div>
            <button type="button" className="btn-primary" onClick={onAcceptRouteProposal}>
              שימוש במסלול הזה
            </button>
            <button type="button" className="btn-ghost" onClick={onDismissRouteProposal}>
              ביטול הטיוטה
            </button>
          </div>
        </div>
      ) : null}

      {hasRoute && (
        <div className="build-panel__actions">
          <button type="button" className="btn-primary" disabled={!canDownload} onClick={onDownloadGpx}>
            <Icon name="download-outline" /> GPX
          </button>
          <button type="button" className="btn-ghost" disabled={!canShare} onClick={onShare}>
            {shareCopied ? "✓ הועתק" : "שיתוף"}
          </button>
          <span className="visually-hidden" role="status" aria-live="polite">
            {shareCopied ? "קישור המסלול הועתק" : ""}
          </span>
          {showSendToPhone && (
            <button type="button" className="btn-ghost" disabled={!canShare} onClick={onSendToPhone}>
              שלחו לטלפון
            </button>
          )}
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
      {legalLinks}
    </div>
  );
}

function formatProposalDistance(meters) {
  return `${(Math.max(0, Number(meters) || 0) / 1000).toFixed(1)} ק״מ`;
}

function formatProposalDelta(meters) {
  const value = Number(meters) || 0;
  const prefix = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${prefix}${(Math.abs(value) / 1000).toFixed(1)} ק״מ`;
}

function Stat({ k, v }) {
  return (
    <div className="build-stat">
      <div className="build-stat__k">{k}</div>
      <div className="build-stat__v">{v}</div>
    </div>
  );
}
