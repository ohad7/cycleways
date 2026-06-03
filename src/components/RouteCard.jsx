import React from "react";
import { Link } from "react-router-dom";

const DIFFICULTY_LEVEL = { easy: 1, moderate: 2, hard: 3 };
const DIFFICULTY_LABEL = { easy: "קל", moderate: "בינוני", hard: "מאתגר" };

function DifficultyMeter({ difficulty }) {
  const level = DIFFICULTY_LEVEL[difficulty] ?? 0;
  return (
    <span className="rc-difficulty" aria-label={`רמת קושי: ${DIFFICULTY_LABEL[difficulty] || difficulty}`}>
      <span className="rc-difficulty__dots">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={`rc-difficulty__dot${i <= level ? " filled" : ""}`}
          />
        ))}
      </span>
      <span>{DIFFICULTY_LABEL[difficulty] || difficulty}</span>
    </span>
  );
}

export default function RouteCard({ entry, places, onSelect }) {
  const placeNames = (entry.passesNear || [])
    .map((id) => places.find((p) => p.id === id)?.name)
    .filter(Boolean)
    .slice(0, 4);
  return (
    <article className="rc-result-card">
      <div className="rc-result-card__thumb" aria-hidden="true" />
      <div className="rc-result-card__body">
        <header className="rc-result-card__header">
          <h3>{entry.name}</h3>
          {entry.featured && <span className="rc-result-card__badge">מומלץ במיוחד</span>}
        </header>
        <p className="rc-result-card__summary">{entry.summary}</p>
        <div className="rc-result-card__stats">
          <span className="rc-result-card__stat-distance">{entry.distanceKm} ק״מ</span>
          <DifficultyMeter difficulty={entry.difficulty} />
        </div>
        {placeNames.length > 0 && (
          <p className="rc-result-card__places">עובר ב: {placeNames.join(" · ")}</p>
        )}
        <div className="rc-result-card__actions">
          <button type="button" onClick={() => onSelect(entry)}>
            ראו את המסלול במפה
          </button>
          {entry.featured && (
            <Link to={`/featured/${entry.slug}`}>פרטים מלאים →</Link>
          )}
        </div>
      </div>
    </article>
  );
}
