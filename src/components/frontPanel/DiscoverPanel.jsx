import React, { useEffect, useMemo, useRef, useState } from "react";
import PanelRouteCard, { PanelRouteHeroCard } from "./PanelRouteCard.jsx";
import RecentRoutesStrip from "./RecentRoutesStrip.jsx";
import "../welcome-wizard.css";
import {
  FILTER_GROUPS,
  FilterChip,
  PlaceAutocompleteFilter,
} from "../WelcomeDiscover.jsx";
import {
  routePassesThroughPlaceIds,
  routeStartPlaceIds,
} from "@cycleways/core/data/catalog.js";
import { filterCatalogBySearch } from "@cycleways/core/data/catalogSearch.js";
import {
  DISCOVER_INTENT_FILTERS,
  filterRoutesByDiscoveryIntent,
  selectDiscoveryHero,
  selectDiscoverRoutes,
  routesWithoutDiscoveryHero,
} from "./discoverRouteList.js";
import { useCardViewport } from "./useCardViewport.js";
import {
  distanceToRouteStartMeters,
  formatDistanceFromUser,
  sortByDistanceFromUser,
} from "@cycleways/core/data/nearMe.js";

const SHOW_RECENT_ROUTES_STRIP = false;

export default function DiscoverPanel({
  catalog,
  places,
  onBuild,
  onSlugsChange,
  onRouteViewport,
  onHoverRoute,
  locationFix,
  locationError = "",
  filters,
  onFiltersChange,
  nearMeSort,
  onNearMeSortChange,
  onRequestLocation,
  recentRoutes,
  viewportKey = "",
}) {
  const [heroSeed] = useState(() => Math.random());
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [intentFilters, setIntentFilters] = useState(() => new Set());
  const intentRef = useRef(null);
  const revealFiltersOnOpenRef = useRef(false);
  const entries = useMemo(
    () => (Array.isArray(catalog?.entries) ? catalog.entries : []),
    [catalog],
  );

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
    onFiltersChange((prev) => {
      const next = new Set(prev[axis]);
      next.has(value) ? next.delete(value) : next.add(value);
      // single-select per pill group
      return { ...prev, [axis]: next.size > 1 ? new Set([value]) : next };
    });
  const addFilterValue = (axis, value) =>
    onFiltersChange((prev) => ({ ...prev, [axis]: new Set(prev[axis]).add(value) }));
  const removeFilterValue = (axis, value) =>
    onFiltersChange((prev) => {
      const next = new Set(prev[axis]);
      next.delete(value);
      return { ...prev, [axis]: next };
    });
  const toggleIntent = (value) => {
    setIntentFilters((prev) => {
      if (prev.has(value)) return new Set();
      return new Set([value]);
    });
  };
  const handleNearMeClick = () => {
    if (!locationFix) onRequestLocation?.();
    onNearMeSortChange((v) => !v);
  };
  const handleAdvancedToggle = () => {
    setFiltersOpen((open) => {
      if (!open) revealFiltersOnOpenRef.current = true;
      return !open;
    });
  };

  const searchedRoutes = useMemo(
    () => filterCatalogBySearch(entries, query, placeById),
    [entries, query, placeById],
  );
  const advancedFilterCount = useMemo(
    () =>
      Object.values(filters || {}).reduce(
        (sum, value) => sum + (value instanceof Set ? value.size : 0),
        0,
      ),
    [filters],
  );
  const { routes: advancedFilteredRoutes } = useMemo(
    () => selectDiscoverRoutes(searchedRoutes, filters),
    [searchedRoutes, filters],
  );
  const intentFilteredRoutes = useMemo(
    () => filterRoutesByDiscoveryIntent(advancedFilteredRoutes, intentFilters, { placeById }),
    [advancedFilteredRoutes, intentFilters, placeById],
  );
  const routes = useMemo(
    () =>
      nearMeSort && locationFix
        ? sortByDistanceFromUser(intentFilteredRoutes, placeById, locationFix)
        : intentFilteredRoutes,
    [intentFilteredRoutes, nearMeSort, locationFix, placeById],
  );
  const heroRoute = useMemo(
    () =>
      selectDiscoveryHero(routes, {
        seed: nearMeSort && locationFix ? 0 : heroSeed,
        preferEditorial: !(nearMeSort && locationFix),
      }),
    [routes, heroSeed, nearMeSort, locationFix],
  );
  const secondaryRoutes = useMemo(
    () => routesWithoutDiscoveryHero(routes, heroRoute),
    [routes, heroRoute],
  );
  const displayRoutes = useMemo(
    () => (heroRoute ? [heroRoute, ...secondaryRoutes] : secondaryRoutes),
    [heroRoute, secondaryRoutes],
  );

  const orderedSlugs = useMemo(() => displayRoutes.map((r) => r.slug), [displayRoutes]);
  const { containerRef, registerCard, sets } = useCardViewport(orderedSlugs, viewportKey);
  const distanceFromUserLabelFor = (entry) =>
    locationFix
      ? formatDistanceFromUser(
          distanceToRouteStartMeters(entry, placeById, locationFix),
        )
      : "";

  // Full ordered list drives stable per-route colors; the derived sets drive the
  // map's bright/ghost tiers and lazy geometry loading.
  useEffect(() => {
    onSlugsChange?.(orderedSlugs);
  }, [orderedSlugs, onSlugsChange]);
  useEffect(() => {
    onRouteViewport?.(sets);
  }, [sets, onRouteViewport]);
  useEffect(() => {
    if (!filtersOpen || !revealFiltersOnOpenRef.current) return undefined;
    revealFiltersOnOpenRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      revealElement(intentRef.current, 12);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [filtersOpen]);

  return (
    <div className="discover-panel" ref={containerRef}>
      {SHOW_RECENT_ROUTES_STRIP && (
        <RecentRoutesStrip recents={recentRoutes} />
      )}
      <div className="discover-panel__intro">
        <div className="eyebrow">גליל עליון על אופניים</div>
        <h2>לאן רוכבים היום?</h2>
        <div className="discover-panel__search">
          <input
            type="search"
            value={query}
            placeholder="חפשו מסלול או מקום"
            aria-label="חיפוש מסלול"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {heroRoute ? (
        <div className="discover-panel__hero">
          <PanelRouteHeroCard
            index={0}
            entry={heroRoute}
            places={places}
            onHover={onHoverRoute}
            cardRef={registerCard(heroRoute.slug)}
            distanceFromUserLabel={distanceFromUserLabelFor(heroRoute)}
          />
        </div>
      ) : null}

      <div className="discover-panel__intent" ref={intentRef}>
        <div className="discover-panel__intent-head">מה מתאים לכם?</div>
        <div className="discover-panel__intent-chips" aria-label="סינון מהיר">
          {DISCOVER_INTENT_FILTERS.map((intent) => (
            <FilterChip
              key={intent.value}
              active={intentFilters.has(intent.value)}
              onClick={() => toggleIntent(intent.value)}
            >
              {intent.label}
            </FilterChip>
          ))}
          <FilterChip active={nearMeSort} onClick={handleNearMeClick}>
            קרוב אליי
          </FilterChip>
          <button
            type="button"
            className={`discover-panel__advanced-toggle${
              filtersOpen || advancedFilterCount > 0
                ? " discover-panel__advanced-toggle--active"
                : ""
            }`}
            aria-label="סינון"
            aria-expanded={filtersOpen}
            onClick={handleAdvancedToggle}
          >
            <span>
              סינון
              {advancedFilterCount > 0 ? (
                <span className="discover-panel__advanced-count">
                  {advancedFilterCount}
                </span>
              ) : null}
            </span>
            <span aria-hidden="true">{filtersOpen ? "▴" : "▾"}</span>
          </button>
        </div>
      </div>

      {locationError ? (
        <div className="discover-panel__error" role="alert">
          {locationError}
        </div>
      ) : null}

      <div className="discover-panel__advanced">
        {filtersOpen ? (
          <div className="discover-panel__advanced-body">
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
          </div>
        ) : null}
      </div>

      <div className="discover-panel__routes">
        <div className="discover-panel__section-head">
          <h3>עוד מסלולים מומלצים</h3>
          <span>{`${routes.length} מסלולים`}</span>
        </div>
        {secondaryRoutes.length > 0 ? (
          <div className="discover-panel__list">
            {secondaryRoutes.map((entry, index) => (
              <PanelRouteCard
                key={entry.slug}
                index={heroRoute ? index + 1 : index}
                entry={entry}
                places={places}
                onHover={onHoverRoute}
                cardRef={registerCard(entry.slug)}
                distanceFromUserLabel={distanceFromUserLabelFor(entry)}
              />
            ))}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className="discover-panel__build-fab"
        onClick={onBuild}
      >
        + תכנן מסלול
      </button>
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

function revealElement(element, offset = 0) {
  if (!element || typeof window === "undefined") return;
  const scroller = element.closest(".front-panel__body") || window;
  const usesWindow = scroller === window;
  const scrollTop = usesWindow ? window.scrollY : scroller.scrollTop;
  const scrollerTop = usesWindow ? 0 : scroller.getBoundingClientRect().top;
  const targetY = Math.max(
    0,
    scrollTop + element.getBoundingClientRect().top - scrollerTop - offset,
  );
  const startY = scrollTop;
  const distance = targetY - startY;
  if (Math.abs(distance) < 4) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduceMotion) {
    scrollToY(scroller, targetY);
    return;
  }
  const duration = 700;
  const startTime = window.performance?.now?.() ?? Date.now();
  const ease = (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  const step = (now) => {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    scrollToY(scroller, startY + distance * ease(progress));
    if (progress < 1) window.requestAnimationFrame(step);
  };

  window.requestAnimationFrame(step);
}

function scrollToY(scroller, y) {
  if (scroller === window) {
    window.scrollTo(0, y);
    return;
  }
  scroller.scrollTop = y;
}
