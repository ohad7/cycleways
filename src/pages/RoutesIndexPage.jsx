import React, { useEffect, useId, useMemo, useState } from "react";
import PageShell from "../components/PageShell.jsx";
import RouteCatalogCard from "../components/routes/RouteCatalogCard.jsx";
import { catalogFilter } from "../components/catalogFilter.js";
import { hasRouteStory, loadRecommendedRouteList } from "../featured/index.js";
import {
  routePassesThroughPlaceIds,
  routeStartPlaceIds,
} from "@cycleways/core/data/catalog.js";
import "../components/routes/routes.css";

const STATIC_FILTER_GROUPS = [
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
    axis: "surface",
    label: "משטח",
    options: [
      { value: "paved", label: "סלול" },
      { value: "mixed", label: "שטח/סלול" },
      { value: "dirt", label: "שטח" },
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
    surface: new Set(),
    distance: new Set(),
    startLocation: new Set(),
    throughLocation: new Set(),
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
    const previousTitle = document.title;
    document.title = "מסלולים מומלצים | מפת שבילי אופניים - גליל עליון וגולן";
    return () => {
      document.title = previousTitle;
    };
  }, []);

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
  const placeById = useMemo(
    () => new Map(places.map((place) => [place.id, place])),
    [places],
  );
  const startOptions = useMemo(
    () => placeOptionsForEntries(entries, placeById, routeStartPlaceIds),
    [entries, placeById],
  );
  const throughOptions = useMemo(
    () => placeOptionsForEntries(entries, placeById, routePassesThroughPlaceIds),
    [entries, placeById],
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
  const addFilterValue = (axis, value) => {
    setFilters((current) => {
      if (current[axis].has(value)) return current;
      const next = new Set(current[axis]);
      next.add(value);
      return { ...current, [axis]: next };
    });
  };
  const removeFilterValue = (axis, value) => {
    setFilters((current) => {
      if (!current[axis].has(value)) return current;
      const next = new Set(current[axis]);
      next.delete(value);
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

            <section className="routes-page__search-panel" aria-label="חיפוש וסינון מסלולים">
              <div className="routes-page__place-searches">
                <PlaceAutocompleteFilter
                  label="התחלה"
                  placeholder="בחרו ישוב התחלה"
                  options={startOptions}
                  selected={filters.startLocation}
                  onSelect={(value) => addFilterValue("startLocation", value)}
                  onRemove={(value) => removeFilterValue("startLocation", value)}
                />
                <PlaceAutocompleteFilter
                  label="עובר דרך"
                  placeholder="בחרו מקום לאורך המסלול"
                  options={throughOptions}
                  selected={filters.throughLocation}
                  onSelect={(value) => addFilterValue("throughLocation", value)}
                  onRemove={(value) => removeFilterValue("throughLocation", value)}
                />
              </div>

              <div className="routes-page__quick-filter-groups">
                {STATIC_FILTER_GROUPS.map((group) => (
                  <div
                    className="routes-page__quick-filter-group"
                    key={group.axis}
                    role="group"
                    aria-label={group.label}
                  >
                    <span className="routes-page__quick-filter-label">{group.label}</span>
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
                  </div>
                ))}
              </div>

              {activeFilterCount > 0 && (
                <div className="routes-page__filter-actions">
                  <span>{activeFilterCount} מסננים פעילים</span>
                  <button
                    className="routes-page__filters-reset"
                    type="button"
                    onClick={clearFilters}
                  >
                    נקה סינון
                  </button>
                </div>
              )}
            </section>
          </header>

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

function PlaceAutocompleteFilter({
  label,
  onRemove,
  onSelect,
  options,
  placeholder,
  selected,
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const selectedValues = Array.from(selected || []);
  const optionByValue = useMemo(
    () => new Map((options || []).map((option) => [option.value, option])),
    [options],
  );
  const normalizedQuery = normalizeSearchText(query);
  const matches = useMemo(
    () =>
      (options || [])
        .filter((option) => !selected?.has(option.value))
        .filter((option) => {
          if (!normalizedQuery) return true;
          return normalizeSearchText(`${option.label} ${option.value}`).includes(normalizedQuery);
        })
        .slice(0, 8),
    [normalizedQuery, options, selected],
  );
  const showDropdown = focused && matches.length > 0;

  const selectOption = (value) => {
    onSelect(value);
    setQuery("");
  };

  return (
    <div className="routes-page__combo">
      <label className="routes-page__combo-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="routes-page__combo-box">
        {selectedValues.map((value) => {
          const option = optionByValue.get(value);
          return (
            <span className="routes-page__selected-place" key={value}>
              <span>{option?.label || value}</span>
              <button
                type="button"
                aria-label={`הסר ${option?.label || value}`}
                onClick={() => onRemove(value)}
              >
                x
              </button>
            </span>
          );
        })}
        <input
          id={inputId}
          type="search"
          value={query}
          placeholder={selectedValues.length > 0 ? "הוספה..." : placeholder}
          autoComplete="off"
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0]) {
              event.preventDefault();
              selectOption(matches[0].value);
            }
            if (
              event.key === "Backspace" &&
              query.length === 0 &&
              selectedValues.length > 0
            ) {
              onRemove(selectedValues[selectedValues.length - 1]);
            }
          }}
        />
      </div>
      {showDropdown && (
        <ul className="routes-page__combo-menu">
          {matches.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option.value)}
              >
                <span>{option.label}</span>
                {option.count > 0 && <small>{option.count}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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

function placeOptionsForEntries(entries, placeById, placeIdsForEntry) {
  const counts = new Map();
  for (const entry of entries) {
    for (const id of placeIdsForEntry(entry)) {
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return Array.from(counts.keys())
    .map((id) => ({
      value: id,
      label: placeById.get(id)?.name || id,
      count: counts.get(id) || 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "he"));
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLocaleLowerCase("he");
}
