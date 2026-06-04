import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import PageShell from "../components/PageShell.jsx";
import { loadCatalog, findCatalogEntryBySlug, routeDisplayImage } from "@cycleways/core/data/catalog.js";
import { getRouteStoryModuleLoader, getRouteStoryNav } from "../featured/index.js";
import { routeImageSrc } from "../components/routes/routeImageSrc.js";
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
  const [places, setPlaces] = useState([]);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [catalog, placesData] = await Promise.all([loadCatalog(), loadPlaces()]);
        if (cancelled) return;
        const found = findCatalogEntryBySlug(catalog, slug);
        setEntry(found);
        setPlaces(placesData);
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
    <PageShell>
      <main className="route-detail">
        <div className="route-detail__inner">
          {status === "loading" && <div>טוען מסלול…</div>}
          {status === "error" && <div>שגיאה בטעינת המסלול.</div>}
          {status === "missing" && (
            <div className="featured-route-404">לא נמצא מסלול בשם "{slug}".</div>
          )}
          {status === "ready" && entry && (
            <GenericRouteContent entry={entry} places={places} />
          )}
        </div>
      </main>
    </PageShell>
  );
}

function GenericRouteContent({ entry, places }) {
  const image = routeDisplayImage(entry);
  const plannerHref = entry.route ? `/?route=${encodeURIComponent(entry.route)}` : "/";
  const placeNames = (entry.passesNear || [])
    .map((id) => places.find((p) => p.id === id)?.name)
    .filter(Boolean);
  const stats = [
    Number.isFinite(Number(entry.distanceKm)) ? `${Number(entry.distanceKm).toFixed(1)} ק״מ` : null,
    Number.isFinite(Number(entry.elevationGainM)) ? `${Math.round(Number(entry.elevationGainM))} מ׳ טיפוס` : null,
    entry.difficulty ? `רמת קושי: ${difficultyLabel(entry.difficulty)}` : null,
    entry.style ? `סגנון: ${styleLabel(entry.style)}` : null,
  ].filter(Boolean);

  return (
    <>
      <section className="route-detail__header">
        <div className="route-detail__copy">
          <h1>{entry.name}</h1>
          {entry.summary && <p className="route-detail__summary">{entry.summary}</p>}
          {entry.description && (
            <p className="route-detail__description">{entry.description}</p>
          )}
          <div className="route-detail__actions">
            <a className="route-card__primary" href={plannerHref}>
              פתח במפה
            </a>
            <a className="route-card__secondary" href="/routes">
              כל המסלולים
            </a>
          </div>
        </div>
        <div className="route-detail__media">
          {image ? (
            <img
              alt={image.alt || entry.name || ""}
              src={routeImageSrc(image.photo || image.thumbnail)}
            />
          ) : (
            <div className="route-card__placeholder" aria-hidden="true" />
          )}
        </div>
      </section>

      <section className="route-detail__section">
        <h2>נתוני מסלול</h2>
        <div className="route-detail__stats">
          {stats.map((stat) => (
            <span key={stat}>{stat}</span>
          ))}
          {placeNames.length > 0 && <span>עובר ליד: {placeNames.join(" · ")}</span>}
        </div>
      </section>

      {(entry.start || entry.end) && (
        <section className="route-detail__section">
          <h2>נקודות התחלה וסיום</h2>
          <div className="route-detail__points">
            {entry.start && <RoutePoint title="נקודת התחלה" point={entry.start} />}
            {entry.end && <RoutePoint title="נקודת סיום" point={entry.end} />}
          </div>
        </section>
      )}

    </>
  );
}

function RoutePoint({ title, point }) {
  return (
    <article className="route-detail__point">
      <h3>{title}: {point.name || ""}</h3>
      {point.description && <p>{point.description}</p>}
    </article>
  );
}

function difficultyLabel(value) {
  return { easy: "קל", moderate: "בינוני", hard: "מאתגר" }[value] || value;
}

function styleLabel(value) {
  return {
    family: "משפחתי",
    scenic: "נוף",
    sporty: "ספורטיבי",
    adventurous: "הרפתקני",
  }[value] || value;
}

async function loadPlaces() {
  try {
    const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
    const res = await fetch(`${base}data/places.json`);
    if (!res.ok) return [];
    return (await res.json())?.places || [];
  } catch {
    return [];
  }
}
