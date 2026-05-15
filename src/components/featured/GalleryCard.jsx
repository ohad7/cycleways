import React from "react";
import { Link } from "react-router-dom";

export default function FeaturedGalleryCard({ meta, distanceKm, headingLevel = "h2" }) {
  const Heading = headingLevel === "h3" ? "h3" : "h2";
  return (
    <Link to={`/featured/${meta.slug}`} className="featured-gallery-card">
      {meta.hero && <img src={meta.hero} alt={meta.name} loading="lazy" />}
      <div className="featured-gallery-card-body">
        <Heading>{meta.name}</Heading>
        {meta.summary && <p>{meta.summary}</p>}
        {distanceKm != null && (
          <div className="featured-gallery-card-stats">
            <span aria-hidden="true">📏</span> {distanceKm.toFixed(1)} ק"מ
          </div>
        )}
      </div>
    </Link>
  );
}
