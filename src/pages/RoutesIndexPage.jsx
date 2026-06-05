import React, { useEffect, useMemo, useState } from "react";
import PageShell from "../components/PageShell.jsx";
import RouteCatalogCard from "../components/routes/RouteCatalogCard.jsx";
import { catalogFilter } from "../components/catalogFilter.js";
import { hasRouteStory, loadRecommendedRouteList } from "../featured/index.js";
import "../components/routes/routes.css";

const FILTER_GROUPS = [
  {
    axis: "difficulty",
    label: "רמת קושי",
    options: [
      { value: "easy", label: "קל" },
      { value: "moderate", label: "בינוני" },
      { value: "hard", label: "קשה" },
    ],
  },
  {
    axis: "style",
    label: "אופי המסלול",
    options: [
      { value: "family", label: "משפחתי" },
      { value: "scenic", label: "נוף" },
    ],
  },
  {
    axis: "distance",
    label: "אורך",
    options: [
      { value: "short", label: "עד 10 ק״מ" },
      { value: "medium", label: "10-25 ק״מ" },
      { value: "long", label: "25 ק״מ ומעלה" },
    ],
  },
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
  const activeFilterCount = useMemo(
    () => Object.values(filters).reduce((sum, set) => sum + set.size, 0),
    [filters],
  );

  const toggleFilter = (axis, value) => {
    setFilters((current) => {
      const next = new Set(current[axis]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...current, [axis]: next };
    });
  };
  const clearFilters = () => setFilters(emptyFilters());

  return (
    <PageShell>
      <main className="routes-page">
        <div className="routes-page__inner">
          <header className="routes-page__header">
            <div className="routes-page__header-copy">
              <span className="routes-page__eyebrow">מאגר המסלולים</span>
              <h1>מסלולים מומלצים</h1>
              <p>
                מאגר המסלולים המומלצים שלנו בגליל העליון והגולן. כל מסלול נפתח
                במפה לתכנון, שיתוף והורדת GPX.
              </p>
            </div>
            <div className="routes-page__summary" aria-label="סיכום תוצאות">
              <strong>{filtered.length}</strong>
              <span>מתוך {entries.length} מסלולים</span>
            </div>
          </header>

          <section className="routes-page__filters" aria-label="סינון מסלולים">
            <div className="routes-page__filters-header">
              <h2>סינון מסלולים</h2>
              {activeFilterCount > 0 && (
                <button
                  className="routes-page__filters-reset"
                  type="button"
                  onClick={clearFilters}
                >
                  נקה סינון
                </button>
              )}
            </div>
            <div className="routes-page__filter-groups">
              {FILTER_GROUPS.map((group) => (
                <fieldset className="routes-page__filter-group" key={group.axis}>
                  <legend>{group.label}</legend>
                  <div className="routes-page__filter-options">
                    {group.options.map((chip) => {
                      const active = filters[group.axis].has(chip.value);
                      return (
                        <button
                          key={`${group.axis}:${chip.value}`}
                          className={`routes-page__filter${active ? " active" : ""}`}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleFilter(group.axis, chip.value)}
                        >
                          <span className="routes-page__filter-mark" aria-hidden="true" />
                          <span>{chip.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          </section>

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
