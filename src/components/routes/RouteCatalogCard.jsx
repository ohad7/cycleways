import React from "react";
import { Link } from "react-router-dom";
import { routeDisplayImage } from "@cycleways/core/data/catalog.js";
import { routeImageSrc } from "./routeImageSrc.js";

const DIFFICULTY_LABEL = {
  easy: "קל",
  moderate: "בינוני",
  hard: "מאתגר",
};

const STYLE_LABEL = {
  family: "משפחתי",
  scenic: "נוף",
  sporty: "ספורטיבי",
  adventurous: "הרפתקני",
};

function formatDistance(km) {
  return Number.isFinite(Number(km)) ? `${Number(km).toFixed(1)} ק״מ` : "";
}

function formatElevation(meters) {
  return Number.isFinite(Number(meters)) ? `${Math.round(Number(meters))} מ׳ טיפוס` : "";
}

function surfaceLabel(roadMix) {
  if (!roadMix || typeof roadMix !== "object") return "";
  const entries = [
    ["paved", "סלול"],
    ["dirt", "עפר"],
    ["road", "כביש"],
  ]
    .map(([key, label]) => [Number(roadMix[key]) || 0, label])
    .filter(([value]) => value > 0);
  entries.sort((a, b) => b[0] - a[0]);
  return entries[0]?.[1] || "";
}

export default function RouteCatalogCard({
  entry,
  places = [],
  hasStory = false,
  headingLevel = "h2",
}) {
  const Heading = headingLevel === "h3" ? "h3" : "h2";
  const image = routeDisplayImage(entry);
  const placeNames = (entry.passesNear || [])
    .map((id) => places.find((p) => p.id === id)?.name)
    .filter(Boolean)
    .slice(0, 4);
  const plannerHref = entry.route ? `/?route=${encodeURIComponent(entry.route)}` : "/";
  const stats = [
    formatDistance(entry.distanceKm),
    formatElevation(entry.elevationGainM),
    DIFFICULTY_LABEL[entry.difficulty] || entry.difficulty,
    surfaceLabel(entry.roadMix),
    STYLE_LABEL[entry.style] || entry.style,
  ].filter(Boolean);

  return (
    <article className="route-card">
      <div className="route-card__media">
        {image ? (
          <img
            alt={image.alt || entry.name || ""}
            loading="lazy"
            src={routeImageSrc(image.thumbnail || image.photo)}
          />
        ) : (
          <div className="route-card__placeholder" aria-hidden="true" />
        )}
      </div>
      <div className="route-card__body">
        <header className="route-card__header">
          <Heading>{entry.name}</Heading>
          <div className="route-card__badges" aria-label="מאפייני מסלול">
            {hasStory && <span>כתבה</span>}
            {entry.end ? null : <span>מעגלי</span>}
          </div>
        </header>
        {entry.summary && <p className="route-card__summary">{entry.summary}</p>}
        {stats.length > 0 && (
          <div className="route-card__stats">
            {stats.map((stat) => (
              <span key={stat}>{stat}</span>
            ))}
          </div>
        )}
        {placeNames.length > 0 && (
          <p className="route-card__places">עובר ליד: {placeNames.join(" · ")}</p>
        )}
        <div className="route-card__actions">
          <Link className="route-card__primary" to={plannerHref} reloadDocument>
            פתח במפה
          </Link>
          <Link className="route-card__secondary" to={`/routes/${entry.slug}`}>
            פרטים
          </Link>
        </div>
      </div>
    </article>
  );
}
