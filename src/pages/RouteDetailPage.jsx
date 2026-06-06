import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import PageShell from "../components/PageShell.jsx";
import { loadCatalog, findCatalogEntryBySlug } from "@cycleways/core/data/catalog.js";
import { getRouteStoryModuleLoader, getRouteStoryNav } from "../featured/index.js";
import FeaturedMapRoute from "../components/featured/FeaturedMapRoute.jsx";
import FeaturedVideoRoute from "../components/featured/FeaturedVideoRoute.jsx";
import { hasRouteVideo } from "../components/featured/routeVideoIndex.js";
import {
  createGenericRouteStoryProps,
  genericRouteNavLinks,
} from "../featured/genericRouteStory.js";
import "../components/routes/routes.css";
import "../components/featured/featured.css";

export default function RouteDetailPage() {
  const { slug } = useParams();
  const loader = getRouteStoryModuleLoader(slug);
  const navLinks = getRouteStoryNav(slug);
  const [routeName, setRouteName] = useState(slug);
  const LazyStory = useMemo(() => (loader ? lazy(loader) : null), [loader]);

  useEffect(() => {
    let cancelled = false;
    setRouteName(slug);
    loadCatalog()
      .then((catalog) => {
        if (cancelled) return;
        const entry = findCatalogEntryBySlug(catalog, slug);
        setRouteName(entry?.name || slug);
      })
      .catch(() => {
        if (!cancelled) setRouteName(slug);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (LazyStory) {
    return (
      <PageShell
        breadcrumbs={routeBreadcrumbs(routeName)}
        navLinks={navLinks}
      >
        <Suspense
          fallback={
            <div className="route-detail">
              <div className="route-detail__inner">טוען מסלול…</div>
            </div>
          }
        >
          <LazyStory />
        </Suspense>
      </PageShell>
    );
  }

  return <GenericRouteDetail slug={slug} />;
}

function GenericRouteDetail({ slug }) {
  const [entry, setEntry] = useState(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    setEntry(null);
    setHasVideo(false);
    setStatus("loading");
    (async () => {
      try {
        const [catalog, routeHasVideo] = await Promise.all([
          loadCatalog(),
          hasRouteVideo(slug),
        ]);
        if (cancelled) return;
        const found = findCatalogEntryBySlug(catalog, slug);
        setEntry(found);
        setHasVideo(Boolean(found && routeHasVideo));
        setStatus(found ? "ready" : "missing");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <PageShell
      breadcrumbs={routeBreadcrumbs(
        status === "missing" ? "לא נמצא" : entry?.name || "טוען מסלול…",
      )}
      navLinks={genericRouteNavLinks(entry)}
    >
      {status === "loading" && (
        <main className="route-detail">
          <div className="route-detail__inner">טוען מסלול…</div>
        </main>
      )}
      {status === "error" && (
        <main className="route-detail">
          <div className="route-detail__inner">שגיאה בטעינת המסלול.</div>
        </main>
      )}
      {status === "missing" && (
        <main className="route-detail">
          <div className="route-detail__inner">
            <div className="featured-route-404">לא נמצא מסלול בשם "{slug}".</div>
          </div>
        </main>
      )}
      {status === "ready" && entry && (
        hasVideo ? (
          <FeaturedVideoRoute {...createGenericRouteStoryProps(entry)} />
        ) : (
          <FeaturedMapRoute {...createGenericRouteStoryProps(entry)} />
        )
      )}
    </PageShell>
  );
}

function routeBreadcrumbs(label) {
  return [
    { label: "מפה", to: "/" },
    { label: "מסלולים", to: "/routes/" },
    { label },
  ];
}
