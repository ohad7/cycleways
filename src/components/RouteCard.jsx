import React from "react";
import { Link } from "react-router-dom";

export default function RouteCard({ entry, places, onSelect }) {
  const placeNames = (entry.passesNear || [])
    .map((id) => places.find((p) => p.id === id)?.name)
    .filter(Boolean)
    .slice(0, 4);
  return (
    <article className="rc-result-card">
      <header className="rc-result-card__header">
        <h3>{entry.name}</h3>
        {entry.featured && <span className="rc-result-card__badge">מומלץ במיוחד</span>}
      </header>
      <p>{entry.summary}</p>
      <p className="rc-result-card__stats">
        {entry.distanceKm} ק״מ · {entry.difficulty} · {entry.style}
      </p>
      {placeNames.length > 0 && (
        <p className="rc-result-card__places">עובר ב: {placeNames.join(", ")}</p>
      )}
      <div className="rc-result-card__actions">
        <button type="button" onClick={() => onSelect(entry)}>
          ראו את המסלול במפה
        </button>
        {entry.featured && (
          <Link to={`/featured/${entry.slug}`}>פרטים מלאים →</Link>
        )}
      </div>
    </article>
  );
}
