import React, { Suspense, lazy, useMemo } from "react";
import { useParams } from "react-router-dom";
import { findFeaturedRoute } from "../featured/index.js";
import PageShell from "../components/PageShell.jsx";
import "../components/featured/featured.css";

export default function FeaturedRoutePage() {
  const { slug } = useParams();
  const entry = findFeaturedRoute(slug);

  const LazyRoute = useMemo(() => {
    if (!entry) return null;
    return lazy(() => entry.load());
  }, [entry]);

  return (
    <PageShell>
      <div className="page-card">
        {!entry ? (
          <div className="featured-route-404">לא נמצא מסלול בשם "{slug}".</div>
        ) : (
          <Suspense fallback={<div className="featured-route-loading">טוען מסלול…</div>}>
            <LazyRoute />
          </Suspense>
        )}
      </div>
    </PageShell>
  );
}
