import React from "react";

// Compact "המסלולים שלי" strip at the top of Discover: the last few routes
// the user loaded or downloaded, clickable to reload them into the planner.
export default function RecentRoutesStrip({ recents, onSelect }) {
  if (!Array.isArray(recents) || recents.length === 0) return null;
  return (
    <div className="recent-routes">
      <div className="recent-routes__title">המסלולים שלי</div>
      <div className="recent-routes__list">
        {recents.map((entry) => (
          <button
            key={entry.param}
            type="button"
            className="recent-routes__item"
            onClick={() => onSelect(entry)}
          >
            <span className="recent-routes__name">{entry.name || "מסלול"}</span>
            {Number.isFinite(entry.distanceKm) && (
              <span className="recent-routes__meta">{entry.distanceKm} ק״מ</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
