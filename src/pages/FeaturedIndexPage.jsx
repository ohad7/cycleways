import React, { useEffect, useState } from "react";
import { loadMapAssets } from "../data/mapAssets.js";
import { createRouteManager, restoreRouteFromParam } from "../routing/routeActions.js";
import { featuredRoutes } from "../featured/index.js";
import FeaturedGalleryCard from "../components/featured/GalleryCard.jsx";
import PageShell from "../components/PageShell.jsx";
import "../components/featured/featured.css";

export default function FeaturedIndexPage() {
  const [distances, setDistances] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const assets = await loadMapAssets();
        const manager = await createRouteManager(
          window.RouteManager,
          assets.geoJsonData,
          assets.segmentsData,
        );
        // restoreRouteFromParam is synchronous; the per-entry loop runs once
        // off the main thread and is already optimal.
        const next = {};
        for (const entry of featuredRoutes) {
          const snapshot = restoreRouteFromParam(
            manager,
            entry.meta.route,
            assets.segmentsData,
          );
          if (snapshot) next[entry.meta.slug] = snapshot.distance / 1000;
        }
        if (!cancelled) setDistances(next);
      } catch (err) {
        if (!cancelled) {
          console.warn("Featured index: failed to compute distances", err);
        }
      }
    })();
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
            {featuredRoutes.map(({ meta }) => (
              <FeaturedGalleryCard
                key={meta.slug}
                meta={meta}
                distanceKm={distances[meta.slug]}
              />
            ))}
          </div>
        </section>
      </div>
    </PageShell>
  );
}
