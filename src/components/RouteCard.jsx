import React from "react";
import { Link } from "react-router-dom";
import {
  routeDifficultyLabel,
  routeDisplayImage,
  routeMapImage,
} from "@cycleways/core/data/catalog.js";
import { routeImageSrc } from "./routes/routeImageSrc.js";

const DIFFICULTY_LEVEL = { easy: 1, moderate: 2, hard: 3 };

function DifficultyMeter({ difficulty }) {
  const level = DIFFICULTY_LEVEL[difficulty] ?? 0;
  const label = routeDifficultyLabel(difficulty);
  return (
    <span className="rc-difficulty" aria-label={`רמת קושי: ${label}`}>
      <span className="rc-difficulty__dots">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={`rc-difficulty__dot${i <= level ? " filled" : ""}`}
          />
        ))}
      </span>
      <span>{label}</span>
    </span>
  );
}

function isInteractiveTarget(target) {
  return Boolean(
    target?.closest?.("a, button, input, select, textarea, [role='button']"),
  );
}

export default function RouteCard({ entry, places, onSelect }) {
  const routePhoto = routeDisplayImage(entry);
  const mapImage = routeMapImage(entry);
  const placeNames = (entry.passesNear || [])
    .map((id) => places.find((p) => p.id === id)?.name)
    .filter(Boolean)
    .slice(0, 4);
  const openRoute = () => onSelect(entry);
  const handleCardClick = (event) => {
    if (isInteractiveTarget(event.target)) return;
    openRoute();
  };
  const handleCardKeyDown = (event) => {
    if (isInteractiveTarget(event.target)) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openRoute();
  };
  return (
    <article
      className="rc-result-card"
      tabIndex={0}
      aria-label={`פתח את ${entry.name} במפה`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
    >
      <div
        className={
          routePhoto
            ? "rc-result-card__thumb rc-result-card__thumb--photo rc-result-card__thumb--image"
            : "rc-result-card__thumb rc-result-card__thumb--photo"
        }
        aria-hidden={routePhoto ? undefined : "true"}
      >
        {routePhoto ? (
          <img
            alt={routePhoto.alt || entry.name || ""}
            loading="lazy"
            src={routeImageSrc(routePhoto.thumbnail || routePhoto.photo)}
          />
        ) : null}
      </div>
      <div className="rc-result-card__body">
        <header className="rc-result-card__header">
          <h3>{entry.name}</h3>
          {entry.featured && (
            <span className="rc-result-card__badge">מומלץ במיוחד</span>
          )}
        </header>
        <p className="rc-result-card__summary">{entry.summary}</p>
        <div className="rc-result-card__stats">
          <span className="rc-result-card__stat-distance">
            {entry.distanceKm} ק״מ
          </span>
          <DifficultyMeter difficulty={entry.difficulty} />
        </div>
        {placeNames.length > 0 && (
          <p className="rc-result-card__places">
            עובר ב: {placeNames.join(" · ")}
          </p>
        )}
        <div className="rc-result-card__actions">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openRoute();
            }}
          >
            ראו את המסלול במפה
          </button>
          <Link
            to={`/routes/${entry.slug}`}
            onClick={(event) => event.stopPropagation()}
          >
            פרטים מלאים →
          </Link>
        </div>
      </div>
      <div
        className={
          mapImage
            ? "rc-result-card__thumb rc-result-card__thumb--map rc-result-card__thumb--image"
            : "rc-result-card__thumb rc-result-card__thumb--map"
        }
        aria-hidden={mapImage ? undefined : "true"}
      >
        {mapImage ? (
          <img
            alt={mapImage.alt || `מפת המסלול ${entry.name || ""}`}
            loading="lazy"
            src={routeImageSrc(mapImage.thumbnail || mapImage.photo)}
          />
        ) : null}
      </div>
    </article>
  );
}
