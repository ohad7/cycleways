import React from "react";

// Compact "המסלולים שלי" strip at the top of Discover: the last few catalog
// routes, clickable to open their dedicated route page.
export default function RecentRoutesStrip({ recents }) {
  if (!Array.isArray(recents) || recents.length === 0) return null;
  const routeRecents = recents.filter((entry) => entry?.slug);
  if (routeRecents.length === 0) return null;
  return (
    <div className="recent-routes">
      <div className="recent-routes__title">המסלולים שלי</div>
      <div className="recent-routes__list">
        {routeRecents.map((entry) => (
          <a
            key={entry.slug}
            className="recent-routes__item"
            href={`/routes/${entry.slug}`}
          >
            <span className="recent-routes__name">{entry.name || "מסלול"}</span>
            {Number.isFinite(entry.distanceKm) && (
              <span className="recent-routes__meta">{entry.distanceKm} ק״מ</span>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
