import React from "react";
import { POI_LABELS, POI_COLORS } from "@cycleways/core/data/poiTypes.js";

// Bottom-sheet detail card shown when a data marker (hazard or POI) is tapped.
// Mirrors the iPhone DataMarkerCard: emoji + label + segment + information, with
// an "add to route" action and a close button. See plans/data-marker-detail-card/.
function DataMarkerCard({ marker, onAddToRoute, onClose }) {
  if (!marker) return null;

  const label = POI_LABELS[marker.type] || marker.type || "מידע";
  const accent = POI_COLORS[marker.type] || "#4682B4";
  const hasCoords =
    Number.isFinite(Number(marker.lng)) && Number.isFinite(Number(marker.lat));

  return (
    <div
      className="data-marker-card"
      style={{ borderColor: accent }}
      role="dialog"
      aria-label={label}
    >
      <div className="data-marker-card__header">
        <span className="data-marker-card__title" style={{ color: accent }}>
          <span aria-hidden="true">{marker.emoji || "📍"}</span> {label}
        </span>
        <button
          type="button"
          className="data-marker-card__close"
          aria-label="סגירה"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {marker.segmentName && (
        <p className="data-marker-card__segment">{marker.segmentName}</p>
      )}
      {marker.information && (
        <p className="data-marker-card__info">{marker.information}</p>
      )}
      {hasCoords && !marker.onRoute && (
        <div className="data-marker-card__actions">
          <button
            type="button"
            className="data-marker-card__add"
            onClick={() => onAddToRoute(marker)}
          >
            הוסף למסלול
          </button>
        </div>
      )}
    </div>
  );
}

export default DataMarkerCard;
