import React, { useEffect, useState } from "react";
import { loadFeaturedMetaList } from "../featured/index.js";
import FeaturedGalleryCard from "../components/featured/GalleryCard.jsx";
import PageShell from "../components/PageShell.jsx";
import "../components/featured/featured.css";

export default function FeaturedIndexPage() {
  const [featured, setFeatured] = useState([]);

  useEffect(() => {
    let cancelled = false;
    loadFeaturedMetaList().then((list) => {
      if (!cancelled) setFeatured(list);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <PageShell>
      <div className="page-card">
        <section className="featured-index">
          <header>
            <h1>מסלולים מומלצים</h1>
            <p>אוסף מסלולי רכיבה מומלצים בגליל העליון וגולן.</p>
          </header>
          <div className="featured-index-grid">
            {featured.map((meta) => (
              <FeaturedGalleryCard
                key={meta.slug}
                meta={meta}
                distanceKm={meta.distanceKm}
              />
            ))}
          </div>
        </section>
      </div>
    </PageShell>
  );
}
