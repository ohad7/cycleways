import React, { Suspense, lazy, useMemo } from "react";
import { useParams } from "react-router-dom";
import { getFeaturedModuleLoader, getFeaturedNav } from "../featured/index.js";
import PageShell from "../components/PageShell.jsx";
import "../components/featured/featured.css";

export default function FeaturedRoutePage() {
  const { slug } = useParams();
  const loader = getFeaturedModuleLoader(slug);
  const navLinks = getFeaturedNav(slug);

  const LazyRoute = useMemo(() => {
    if (!loader) return null;
    return lazy(loader);
  }, [loader]);

  return (
    <PageShell navLinks={navLinks}>
      {!loader ? (
        <div className="page-card">
          <div className="featured-route-404">לא נמצא מסלול בשם "{slug}".</div>
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="page-card">
              <div className="featured-route-loading">טוען מסלול…</div>
            </div>
          }
        >
          <LazyRoute />
        </Suspense>
      )}
    </PageShell>
  );
}
