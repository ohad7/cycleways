import React, { useMemo, useState } from "react";
import PanelRouteCard from "./PanelRouteCard.jsx";
import "../welcome-wizard.css";
import {
  FILTER_GROUPS,
  FilterChip,
  PlaceAutocompleteFilter,
  emptyFilters,
} from "../WelcomeDiscover.jsx";
import {
  routePassesThroughPlaceIds,
  routeStartPlaceIds,
} from "@cycleways/core/data/catalog.js";
import { selectDiscoverRoutes } from "./discoverRouteList.js";

export default function DiscoverPanel({ catalog, places, onSelectRoute, onBuild }) {
  const entries = useMemo(
    () => (Array.isArray(catalog?.entries) ? catalog.entries : []),
    [catalog],
  );
  const [filters, setFilters] = useState(emptyFilters);

  const placeById = useMemo(() => {
    const map = new Map();
    for (const p of places) map.set(p.id, p);
    return map;
  }, [places]);

  const startOptions = useMemo(
    () => placeOptions(entries, placeById, routeStartPlaceIds),
    [entries, placeById],
  );
  const throughOptions = useMemo(
    () => placeOptions(entries, placeById, routePassesThroughPlaceIds),
    [entries, placeById],
  );

  const toggleAxis = (axis, value) =>
    setFilters((prev) => {
      const next = new Set(prev[axis]);
      next.has(value) ? next.delete(value) : next.add(value);
      // single-select per pill group
      return { ...prev, [axis]: next.size > 1 ? new Set([value]) : next };
    });
  const addFilterValue = (axis, value) =>
    setFilters((prev) => ({ ...prev, [axis]: new Set(prev[axis]).add(value) }));
  const removeFilterValue = (axis, value) =>
    setFilters((prev) => {
      const next = new Set(prev[axis]);
      next.delete(value);
      return { ...prev, [axis]: next };
    });

  const { mode, routes } = useMemo(
    () => selectDiscoverRoutes(entries, filters),
    [entries, filters],
  );

  return (
    <div className="discover-panel">
      <div className="discover-panel__intro">
        <div className="eyebrow">מצא מסלול</div>
        <h2>מצאו את הרכיבה הבאה</h2>
        <button type="button" className="discover-panel__hint" onClick={onBuild}>
          ↳ או סמנו נקודות על המפה ובנו מסלול משלכם
        </button>
      </div>

      <div className="discover-panel__places discover-panel__places--row">
        <PlaceAutocompleteFilter
          label="נקודת התחלה"
          placeholder="בחרו ישוב התחלה"
          options={startOptions}
          selected={filters.startLocation}
          onSelect={(v) => addFilterValue("startLocation", v)}
          onRemove={(v) => removeFilterValue("startLocation", v)}
          icon="📍"
        />
        <PlaceAutocompleteFilter
          label="עובר דרך"
          placeholder="בחרו מקום לאורך המסלול"
          options={throughOptions}
          selected={filters.throughLocation}
          onSelect={(v) => addFilterValue("throughLocation", v)}
          onRemove={(v) => removeFilterValue("throughLocation", v)}
          icon="🛤️"
        />
      </div>

      <div className="discover-panel__filters">
        {FILTER_GROUPS.map((group) => (
          <div className="wd-filter-group" key={group.axis} role="group" aria-label={group.label}>
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

      <div className="discover-panel__list">
        <div className="dlabel">
          {mode === "recommended" ? "מומלצים" : `${routes.length} מסלולים`}
        </div>
        {routes.map((entry) => (
          <PanelRouteCard
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

function placeOptions(entries, placeById, placeIdsForEntry) {
  const counts = new Map();
  for (const entry of entries) {
    for (const id of placeIdsForEntry(entry)) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return Array.from(counts.keys())
    .map((id) => ({ value: id, label: placeById.get(id)?.name || id, count: counts.get(id) || 0 }))
    .sort((a, b) => a.label.localeCompare(b.label, "he"));
}
