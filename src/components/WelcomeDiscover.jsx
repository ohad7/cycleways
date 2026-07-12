import React, { useEffect, useId, useMemo, useState } from "react";
import RouteCard from "./RouteCard.jsx";
import { catalogFilter } from "./catalogFilter.js";
import {
  FILTER_GROUPS,
  emptyFilters,
} from "@cycleways/core/data/discoverFilters.js";
import {
  routePassesThroughPlaceIds,
  routeStartPlaceIds,
} from "@cycleways/core/data/catalog.js";

// Shared with the React Native app; re-exported for existing web imports.
export { FILTER_GROUPS, emptyFilters };

export function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`wd-chip${active ? " wd-chip--active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="wd-chip__mark" aria-hidden="true" />
      {children}
    </button>
  );
}

export function PlaceAutocompleteFilter({
  label,
  onRemove,
  onSelect,
  options,
  placeholder,
  selected,
  icon,
}) {
  const inputId = useId();
  const listboxId = inputId + "-listbox";
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
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

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(matches.length - 1, 0)));
  }, [matches.length]);

  const selectOption = (value) => {
    onSelect(value);
    setQuery("");
    setActiveIndex(0);
  };

  return (
    <div className="wd-combo">
      <label className="wd-combo__label" htmlFor={inputId}>{label}</label>
      <div className="wd-combo__box">
        {icon && <span className="wd-combo__icon" aria-hidden="true">{icon}</span>}
        {selectedValues.map((value) => {
          const option = optionByValue.get(value);
          return (
            <span className="wd-combo__selected" key={value}>
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
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-activedescendant={
            showDropdown ? listboxId + "-option-" + activeIndex : undefined
          }
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && matches.length > 0) {
              event.preventDefault();
              setFocused(true);
              setActiveIndex((index) => (index + 1) % matches.length);
            } else if (event.key === "ArrowUp" && matches.length > 0) {
              event.preventDefault();
              setFocused(true);
              setActiveIndex((index) => (index - 1 + matches.length) % matches.length);
            } else if (event.key === "Enter" && matches[activeIndex]) {
              event.preventDefault();
              selectOption(matches[activeIndex].value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setFocused(false);
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
        <ul className="wd-combo__menu" id={listboxId} role="listbox">
          {matches.map((option, index) => (
            <li
              key={option.value}
              id={listboxId + "-option-" + index}
              role="option"
              aria-selected={index === activeIndex}
            >
              <button
                type="button"
                tabIndex={-1}
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
      {focused && query && matches.length === 0 ? (
        <span className="visually-hidden" role="status">לא נמצאו אפשרויות</span>
      ) : null}
    </div>
  );
}

export default function WelcomeDiscover({ catalog, places, onSelectRoute }) {
  const [filters, setFilters] = useState(emptyFilters);
  const entries = catalog?.entries || [];
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

  const toggleAxis = (axis, value) => {
    setFilters((prev) => {
      const next = new Set(prev[axis]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [axis]: next };
    });
  };

  const addFilterValue = (axis, value) => {
    setFilters((prev) => {
      if (prev[axis].has(value)) return prev;
      const next = new Set(prev[axis]);
      next.add(value);
      return { ...prev, [axis]: next };
    });
  };

  const removeFilterValue = (axis, value) => {
    setFilters((prev) => {
      if (!prev[axis].has(value)) return prev;
      const next = new Set(prev[axis]);
      next.delete(value);
      return { ...prev, [axis]: next };
    });
  };

  const clearAll = () => setFilters(emptyFilters());

  const results = useMemo(
    () => sortFeaturedFirst(catalogFilter(entries, filters)),
    [entries, filters],
  );

  const activeCount = Object.values(filters).reduce((sum, set) => sum + set.size, 0);

  return (
    <div className="wd">
      <div className="wd__controls">
        <div className="wd__place-searches">
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

        <div className="wd__filter-groups">
          {FILTER_GROUPS.map((group) => (
            <div
              className="wd-filter-group"
              key={group.axis}
              role="group"
              aria-label={group.label}
            >
              <span className="wd-filter-group__label">{group.label}</span>
              <div className="wd__chips">
                {group.options.map((opt) => (
                  <FilterChip
                    key={opt.value}
                    active={filters[group.axis].has(opt.value)}
                    onClick={() => toggleAxis(group.axis, opt.value)}
                  >
                    {opt.label}
                  </FilterChip>
                ))}
              </div>
            </div>
          ))}
        </div>

        {activeCount > 0 && (
          <div className="wd__filter-actions">
            <span>{activeCount} מסננים פעילים</span>
            <button
              type="button"
              className="wd-chip wd-chip--ghost"
              onClick={clearAll}
            >
              נקה הכל
            </button>
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

function sortFeaturedFirst(entries) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        Number(Boolean(b.entry?.featured)) -
          Number(Boolean(a.entry?.featured)) || a.index - b.index,
    )
    .map(({ entry }) => entry);
}
