import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  findFeaturedMeta,
  getFeaturedModuleLoader,
  getFeaturedNav,
} from "../featured/index.js";
import PageShell from "../components/PageShell.jsx";
import FeaturedMapRoute from "../components/featured/FeaturedMapRoute.jsx";
import FeaturedVideoRoute from "../components/featured/FeaturedVideoRoute.jsx";
import { hasRouteVideo } from "../components/featured/routeVideoIndex.js";
import {
  createGenericRouteStoryProps,
  genericRouteNavLinks,
} from "../featured/genericRouteStory.js";
import "../components/featured/featured.css";

export default function FeaturedRoutePage() {
  const { slug } = useParams();
  const loader = getFeaturedModuleLoader(slug);
  const [fallbackState, setFallbackState] = useState({
    status: "loading",
    meta: null,
    hasVideo: false,
  });
  const navLinks = loader
    ? getFeaturedNav(slug)
    : genericRouteNavLinks(fallbackState.meta);

  const LazyRoute = useMemo(() => {
    if (!loader) return null;
    return lazy(loader);
  }, [loader]);

  useEffect(() => {
    let cancelled = false;
    setFallbackState({ status: "loading", meta: null, hasVideo: false });
    (async () => {
      try {
        const [meta, routeHasVideo] = await Promise.all([
          findFeaturedMeta(slug),
          hasRouteVideo(slug),
        ]);
        if (cancelled) return;
        setFallbackState({
          status: meta ? "ready" : "missing",
          meta,
          hasVideo: Boolean(meta && routeHasVideo),
        });
      } catch {
        if (!cancelled) {
          setFallbackState({ status: "error", meta: null, hasVideo: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <PageShell
      breadcrumbs={routeBreadcrumbs(
        fallbackState.status === "missing"
          ? "לא נמצא"
          : fallbackState.meta?.name || "טוען מסלול…",
      )}
      navLinks={navLinks}
    >
      {loader ? (
        <Suspense
          fallback={
            <div className="page-card">
              <div className="featured-route-loading">טוען מסלול…</div>
            </div>
          }
        >
          <LazyRoute />
        </Suspense>
      ) : (
        <GenericFeaturedRouteFallback slug={slug} fallbackState={fallbackState} />
      )}
    </PageShell>
  );
}

function GenericFeaturedRouteFallback({ slug, fallbackState }) {
  const { status, meta, hasVideo } = fallbackState;

  if (status === "loading") {
    return (
      <div className="page-card">
        <div className="featured-route-loading">טוען מסלול…</div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="page-card">
        <div className="featured-route-error">שגיאה בטעינת המסלול.</div>
      </div>
    );
  }

  if (status === "missing" || !meta) {
    return (
      <div className="page-card">
        <div className="featured-route-404">לא נמצא מסלול בשם "{slug}".</div>
      </div>
    );
  }

  return hasVideo ? (
    <FeaturedVideoRoute {...createGenericRouteStoryProps(meta)} />
  ) : (
    <FeaturedMapRoute {...createGenericRouteStoryProps(meta)} />
  );
}

function routeBreadcrumbs(label) {
  return [
    { label: "מפה", to: "/" },
    { label: "מסלולים", to: "/routes/" },
    { label },
  ];
}
