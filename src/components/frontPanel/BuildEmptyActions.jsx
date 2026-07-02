import React from "react";
import { ROUTE_SEARCH_PLACEHOLDER } from "@cycleways/core/ui/routePlannerPresentation.js";
import Icon from "../Icon.jsx";

// Persistent Build empty state: brief how-to steps plus starting actions.
// Search, locate, and draft restore all use the app controller's existing
// state/handlers, so this block stays consistent with the map overlays.
export default function BuildEmptyActions({
  searchQuery,
  searchStatus,
  searchError,
  onSearchQueryChange,
  onSearchSubmit,
  locateStatus,
  onLocateMe,
  draft,
  onRestoreDraft,
}) {
  return (
    <div className="build-empty-actions" data-testid="build-empty-actions">
      <ol className="build-empty-actions__steps">
        <li>לחצו על המפה ליד שביל כדי להתחיל</li>
        <li>הוסיפו נקודה נוספת — המסלול יחושב לאורך השבילים</li>
        <li>גררו את הקו כדי לדייק, ואז הורידו GPX או שתפו</li>
      </ol>

      <div className="build-empty-actions__where">
        <div className="dlabel">איפה מתחילים?</div>
        <form className="build-empty-actions__search" onSubmit={onSearchSubmit}>
          <input
            type="text"
            placeholder={ROUTE_SEARCH_PLACEHOLDER}
            aria-label="חיפוש מיקום"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
          />
          <button
            type="submit"
            disabled={searchStatus === "searching"}
            aria-label="חיפוש"
            title="חיפוש מיקום"
          >
            <Icon name="search-outline" />
          </button>
        </form>
        <button
          type="button"
          className="build-empty-actions__locate"
          disabled={locateStatus === "locating"}
          onClick={onLocateMe}
        >
          <Icon name="locate-outline" /> המיקום שלי
        </button>
        {searchError ? (
          <p className="build-empty-actions__error">{searchError}</p>
        ) : null}
      </div>

      {draft && onRestoreDraft ? (
        <div className="build-empty-actions__draft">
          <span>
            להמשיך את המסלול הקודם
            {Number.isFinite(draft.distanceKm) ? ` (${draft.distanceKm} ק"מ)` : ""}?
          </span>
          <button type="button" onClick={onRestoreDraft}>
            שחזור
          </button>
        </div>
      ) : null}
    </div>
  );
}
