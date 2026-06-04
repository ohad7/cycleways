import React, { useEffect, useMemo, useState } from "react";
import PageShell from "../components/PageShell.jsx";
import RouteCatalogCard from "../components/routes/RouteCatalogCard.jsx";
import { catalogFilter } from "../components/catalogFilter.js";
import { hasRouteStory, loadRecommendedRouteList } from "../featured/index.js";
import "../components/routes/routes.css";

const FILTER_CHIPS = [
  { axis: "difficulty", value: "easy", label: "קל" },
  { axis: "difficulty", value: "moderate", label: "בינוני" },
  { axis: "difficulty", value: "hard", label: "מאתגר" },
  { axis: "style", value: "family", label: "משפחתי" },
  { axis: "style", value: "scenic", label: "נוף" },
  { axis: "distance", value: "short", label: "עד 10 ק״מ" },
  { axis: "distance", value: "medium", label: "10-25 ק״מ" },
  { axis: "distance", value: "long", label: "25 ק״מ ומעלה" },
];

function emptyFilters() {
  return {
    difficulty: new Set(),
    style: new Set(),
    distance: new Set(),
  };
}

function sortRoutes(entries) {
  return entries.slice().sort((a, b) => {
    const ao = Number(a.sortOrder);
    const bo = Number(b.sortOrder);
    const aHasOrder = Number.isFinite(ao);
    const bHasOrder = Number.isFinite(bo);
    if (aHasOrder || bHasOrder) {
      if (!aHasOrder) return 1;
      if (!bHasOrder) return -1;
      if (ao !== bo) return ao - bo;
    }
    const aStory = hasRouteStory(a.slug) ? 1 : 0;
    const bStory = hasRouteStory(b.slug) ? 1 : 0;
    if (aStory !== bStory) return bStory - aStory;
    const aq = Number(a.qualityScore) || 0;
    const bq = Number(b.qualityScore) || 0;
    if (aq !== bq) return bq - aq;
    return (Number(a.distanceKm) || 0) - (Number(b.distanceKm) || 0);
  });
}

export default function RoutesIndexPage() {
  const [entries, setEntries] = useState([]);
  const [places, setPlaces] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [routeEntries, placesData] = await Promise.all([
        loadRecommendedRouteList(),
        loadPlaces(),
      ]);
      if (cancelled) return;
      setEntries(routeEntries);
      setPlaces(placesData);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () => sortRoutes(catalogFilter(entries, filters)),
    [entries, filters],
  );

  const toggleFilter = (axis, value) => {
    setFilters((current) => {
      const next = new Set(current[axis]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...current, [axis]: next };
    });
  };

  return (
    <PageShell>
      <main className="routes-page">
        <div className="routes-page__inner">
          <header className="routes-page__header">
            <h1>מסלולים מומלצים</h1>
            <p>
              מאגר המסלולים המומלצים שלנו בגליל העליון והגולן. כל מסלול נפתח
              במפה לתכנון, שיתוף והורדת GPX.
            </p>
            <span className="routes-page__count">
              {filtered.length} מתוך {entries.length} מסלולים
            </span>
          </header>

          <div className="routes-page__filters" aria-label="סינון מסלולים">
            {FILTER_CHIPS.map((chip) => {
              const active = filters[chip.axis].has(chip.value);
              return (
                <button
                  key={`${chip.axis}:${chip.value}`}
                  className={`routes-page__filter${active ? " active" : ""}`}
                  type="button"
                  onClick={() => toggleFilter(chip.axis, chip.value)}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          <div className="routes-page__grid">
            {filtered.map((entry) => (
              <RouteCatalogCard
                key={entry.slug}
                entry={entry}
                places={places}
                hasStory={hasRouteStory(entry.slug)}
              />
            ))}
          </div>
        </div>
      </main>
    </PageShell>
  );
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
