import React, { useMemo, useState } from "react";
import RouteCard from "./RouteCard.jsx";
import { catalogFilter } from "./catalogFilter.js";

const COMMON_CHIPS = [
  { axis: "difficulty", value: "easy",       label: "קל" },
  { axis: "difficulty", value: "moderate",   label: "בינוני" },
  { axis: "difficulty", value: "hard",       label: "מאתגר" },
  { axis: "style",      value: "family",     label: "משפחתי" },
  { axis: "style",      value: "scenic",     label: "נוף" },
];

const ALL_FILTERS = {
  distance: [
    { value: "short",  label: 'קצר (< 10 ק"מ)' },
    { value: "medium", label: 'בינוני (10–25 ק"מ)' },
    { value: "long",   label: 'ארוך (> 25 ק"מ)' },
  ],
  difficulty: [
    { value: "easy",     label: "קל" },
    { value: "moderate", label: "בינוני" },
    { value: "hard",     label: "מאתגר" },
  ],
  style: [
    { value: "family",      label: "משפחתי" },
    { value: "scenic",      label: "נוף" },
    { value: "sporty",      label: "ספורטיבי" },
    { value: "adventurous", label: "הרפתקני" },
  ],
};

function emptyFilters() {
  return {
    place: null,
    difficulty: new Set(),
    style: new Set(),
    distance: new Set(),
  };
}

function FilterChip({ active, onClick, children, removable }) {
  return (
    <button
      type="button"
      className={`wd-chip${active ? " wd-chip--active" : ""}`}
      onClick={onClick}
    >
      {active && removable && <span className="wd-chip__check">✓</span>}
      {children}
      {active && removable && <span className="wd-chip__remove" aria-hidden>✕</span>}
    </button>
  );
}

function PlaceSearch({ places, value, onChange }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const selectedPlace = value
    ? places.find((p) => p.id === value)
    : null;
  const q = query.trim();
  const matches = q.length > 0
    ? places.filter((p) => p.name.includes(q) || p.id.includes(q.toLowerCase())).slice(0, 8)
    : [];

  if (selectedPlace) {
    return (
      <div className="wd-search wd-search--selected">
        <span className="wd-search__icon">🔍</span>
        <span className="wd-search__chip">
          <span>{selectedPlace.name}</span>
          <button
            type="button"
            className="wd-search__clear"
            aria-label="הסר מקום"
            onClick={() => onChange(null)}
          >
            ✕
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="wd-search">
      <span className="wd-search__icon">🔍</span>
      <input
        type="search"
        className="wd-search__input"
        placeholder="מאיפה תרצו להתחיל? בית הלל, דפנה…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {focused && matches.length > 0 && (
        <ul className="wd-search__dropdown">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(p.id);
                  setQuery("");
                }}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function WelcomeDiscover({ catalog, places, zones, onSelectRoute }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [showMore, setShowMore] = useState(false);

  const toggleAxis = (axis, value) => {
    setFilters((prev) => {
      const next = new Set(prev[axis]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [axis]: next };
    });
  };

  const setPlace = (placeId) => {
    setFilters((prev) => ({ ...prev, place: placeId }));
  };

  const clearAll = () => setFilters(emptyFilters());

  const results = useMemo(
    () => catalogFilter(catalog?.entries || [], filters),
    [catalog, filters],
  );

  const activeCount =
    (filters.place ? 1 : 0) +
    filters.difficulty.size +
    filters.style.size +
    filters.distance.size;

  return (
    <div className="wd">
      <div className="wd__controls">
        <PlaceSearch places={places} value={filters.place} onChange={setPlace} />

        <div className="wd__chips">
          {COMMON_CHIPS.map((chip) => (
            <FilterChip
              key={`${chip.axis}:${chip.value}`}
              active={filters[chip.axis].has(chip.value)}
              onClick={() => toggleAxis(chip.axis, chip.value)}
              removable
            >
              {chip.label}
            </FilterChip>
          ))}
          <button
            type="button"
            className="wd-chip wd-chip--ghost"
            onClick={() => setShowMore((v) => !v)}
          >
            סינון מורחב {showMore ? "▴" : "▾"}
          </button>
          {activeCount > 0 && (
            <button
              type="button"
              className="wd-chip wd-chip--ghost"
              onClick={clearAll}
            >
              נקה הכל
            </button>
          )}
        </div>

        {showMore && (
          <div className="wd__more">
            <FilterGroup
              label="מרחק"
              options={ALL_FILTERS.distance}
              active={filters.distance}
              onToggle={(v) => toggleAxis("distance", v)}
            />
            <FilterGroup
              label="סגנון"
              options={ALL_FILTERS.style}
              active={filters.style}
              onToggle={(v) => toggleAxis("style", v)}
            />
          </div>
        )}
      </div>

      <div className="wd__results">
        <header className="wd__results-header">
          {results.length === 0 ? (
            <span>לא נמצאו מסלולים מתאימים. נסו לשנות סינון.</span>
          ) : (
            <span>{results.length} מסלולים</span>
          )}
        </header>
        {results.map((entry) => (
          <RouteCard
            key={entry.slug}
            entry={entry}
            places={places}
            onSelect={onSelectRoute}
          />
        ))}
      </div>
    </div>
  );
}

function FilterGroup({ label, options, active, onToggle }) {
  if (!options || options.length === 0) return null;
  return (
    <div className="wd-filter-group">
      <span className="wd-filter-group__label">{label}</span>
      <div className="wd__chips">
        {options.map((opt) => (
          <FilterChip
            key={opt.value}
            active={active.has(opt.value)}
            onClick={() => onToggle(opt.value)}
            removable
          >
            {opt.label}
          </FilterChip>
        ))}
      </div>
    </div>
  );
}
