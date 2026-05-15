import React from "react";
import { Link } from "react-router-dom";

export default function FeaturedGalleryCard({ meta, distanceKm }) {
  return (
    <Link to={`/featured/${meta.slug}`} className="featured-gallery-card">
      {meta.hero && <img src={meta.hero} alt={meta.name} loading="lazy" />}
      <div className="featured-gallery-card-body">
        <h3>{meta.name}</h3>
        {meta.summary && <p>{meta.summary}</p>}
        {distanceKm != null && <div className="featured-gallery-card-stats">📏 {distanceKm} ק"מ</div>}
      </div>
    </Link>
  );
}
