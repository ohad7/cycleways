import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import PageShell from "../components/PageShell.jsx";
import { loadCatalog, findCatalogEntryBySlug } from "@cycleways/core/data/catalog.js";
import { getRouteStoryModuleLoader, getRouteStoryNav } from "../featured/index.js";
import FeaturedMapRoute from "../components/featured/FeaturedMapRoute.jsx";
import "../components/routes/routes.css";
import "../components/featured/featured.css";

export default function RouteDetailPage() {
  const { slug } = useParams();
  const loader = getRouteStoryModuleLoader(slug);
  const navLinks = getRouteStoryNav(slug);
  const LazyStory = useMemo(() => (loader ? lazy(loader) : null), [loader]);

  if (LazyStory) {
    return (
      <PageShell navLinks={navLinks}>
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
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const catalog = await loadCatalog();
        if (cancelled) return;
        const found = findCatalogEntryBySlug(catalog, slug);
        setEntry(found);
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
    <PageShell navLinks={genericRouteNavLinks(entry)}>
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
        <FeaturedMapRoute
          slug={entry.slug}
          kicker={routeKicker(entry)}
          intro={{
            kicker: "מסלול מומלץ",
            heading: "מה מחכה בדרך",
            body: [entry.summary].filter(Boolean),
          }}
          about={{
            eyebrow: "על המסלול",
            heading: entry.name,
            paragraphs: splitParagraphs(entry.description || entry.summary),
          }}
        />
      )}
    </PageShell>
  );
}

function splitParagraphs(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function routeKicker(entry) {
  return [entry.regionName || "גליל עליון וגולן", "מסלול מומלץ"].filter(Boolean).join(" · ");
}

function genericRouteNavLinks(entry) {
  if (!entry) return null;
  return [
    { label: "על המסלול", href: "#fv-about" },
    { label: "נקודות במסלול", href: "#fv-poi-stories" },
    { label: "כל המסלולים", to: "/featured/" },
  ];
}
