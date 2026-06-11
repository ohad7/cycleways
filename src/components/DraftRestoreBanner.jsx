import React from "react";

// Offers to restore the autosaved in-progress route. Shown only when the
// planner opened without a shared route and the map is empty.
export default function DraftRestoreBanner({ draft, onRestore, onDismiss }) {
  if (!draft) return null;
  return (
    <div className="draft-restore-banner" role="status">
      <span className="draft-restore-banner__text">
        להמשיך את המסלול הקודם
        {Number.isFinite(draft.distanceKm) ? ` (${draft.distanceKm} ק"מ)` : ""}?
      </span>
      <button type="button" className="draft-restore-banner__restore" onClick={onRestore}>
        שחזור
      </button>
      <button
        type="button"
        className="draft-restore-banner__dismiss"
        aria-label="סגירה"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
