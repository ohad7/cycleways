import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { getJsonAsset } from "@cycleways/core/platform/assets.js";
import { sortByDistanceFromUser } from "@cycleways/core/data/nearMe.js";
import {
  DISCOVER_INTENT_FILTERS,
  FILTER_GROUPS,
  emptyFilters,
  filterRoutesByDiscoveryIntent,
  selectDiscoveryHero,
  selectDiscoverRoutes,
  routesWithoutDiscoveryHero,
} from "@cycleways/core/data/discoverFilters.js";
import { filterCatalogBySearch } from "@cycleways/core/data/catalogSearch.js";
import RouteCard from "./RouteCard.jsx";
import { palette, radius, space } from "./theme.js";

// Native Discover list with feature parity to the mobile-web Discover panel:
// difficulty / surface / distance chip filters + a "near me" toggle + a result
// count, then the catalog as branded route cards. Filtering + ordering reuse the
// shared @cycleways/core helpers; only the chip rendering is native.
export default function DiscoverPanel({
  entries,
  onSelect,
  fix,
  query,
  onQueryChange,
  onRequestLocation,
  locationError = "",
  onRevealFilters,
}) {
  const [places, setPlaces] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [nearMeSort, setNearMeSort] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterRevealY, setFilterRevealY] = useState(0);
  const [heroSeed] = useState(() => Math.random());
  const [intentFilters, setIntentFilters] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    getJsonAsset("public-data/places.json")
      .then((data) => {
        if (cancelled) return;
        setPlaces(Array.isArray(data?.places) ? data.places : []);
      })
      .catch((error) => console.warn("places load failed", error));
    return () => {
      cancelled = true;
    };
  }, []);

  const placeById = useMemo(() => {
    const map = new Map();
    for (const p of places) map.set(p.id, p);
    return map;
  }, [places]);

  // Single-select per chip group (mirrors the web toggleAxis behavior).
  const toggleAxis = (axis, value) =>
    setFilters((prev) => {
      const next = new Set(prev[axis]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [axis]: next.size > 1 ? new Set([value]) : next };
    });
  const toggleIntent = (value) =>
    setIntentFilters((prev) => {
      if (prev.has(value)) return new Set();
      return new Set([value]);
    });
  const toggleNearMe = () => {
    if (!fix) onRequestLocation?.();
    setNearMeSort((v) => !v);
  };
  const toggleFiltersOpen = () => {
    setFiltersOpen((open) => {
      const next = !open;
      if (next) {
        setTimeout(() => onRevealFilters?.(filterRevealY), 0);
      }
      return next;
    });
  };

  const activeFilterCount = useMemo(
    () =>
      FILTER_GROUPS.reduce((sum, g) => sum + filters[g.axis].size, 0),
    [filters],
  );

  const searched = useMemo(
    () => filterCatalogBySearch(entries, query, placeById),
    [entries, query, placeById],
  );
  const filtered = useMemo(
    () => selectDiscoverRoutes(searched, filters).routes,
    [searched, filters],
  );
  const intentFiltered = useMemo(
    () => filterRoutesByDiscoveryIntent(filtered, intentFilters, { placeById }),
    [filtered, intentFilters, placeById],
  );
  const ordered = useMemo(
    () =>
      nearMeSort && fix
        ? sortByDistanceFromUser(intentFiltered, placeById, fix)
        : intentFiltered,
    [intentFiltered, nearMeSort, fix, placeById],
  );
  const heroRoute = useMemo(
    () =>
      selectDiscoveryHero(ordered, {
        seed: nearMeSort && fix ? 0 : heroSeed,
        preferEditorial: !(nearMeSort && fix),
      }),
    [ordered, heroSeed, nearMeSort, fix],
  );
  const secondaryRoutes = useMemo(
    () => routesWithoutDiscoveryHero(ordered, heroRoute),
    [ordered, heroRoute],
  );

  if (!entries || entries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>טוען מסלולים...</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.intro}>
        <Text style={styles.kicker}>גליל עליון על אופניים</Text>
        <Text style={styles.heading}>לאן רוכבים היום?</Text>
      </View>

      <TextInput
        style={styles.search}
        placeholder="חפשו מסלול או מקום"
        placeholderTextColor={palette.muted}
        value={query}
        onChangeText={onQueryChange}
        textAlign="right"
        accessibilityLabel="חיפוש מסלול"
      />

      {heroRoute ? (
        <RouteCard
          entry={heroRoute}
          index={0}
          placeById={placeById}
          fix={fix}
          onSelect={onSelect}
          variant="hero"
        />
      ) : null}

      <View
        onLayout={(event) => setFilterRevealY(event.nativeEvent.layout.y)}
        style={styles.intent}
      >
        <Text style={styles.intentTitle}>מה מתאים לכם?</Text>
        <View style={styles.intentChips}>
          {DISCOVER_INTENT_FILTERS.map((intent) => (
            <Chip
              key={intent.value}
              label={intent.label}
              active={intentFilters.has(intent.value)}
              onPress={() => toggleIntent(intent.value)}
              variant="intent"
            />
          ))}
          <Chip
            label="קרוב אליי"
            active={nearMeSort}
            onPress={toggleNearMe}
            variant="intent"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="סינון"
            accessibilityState={{ expanded: filtersOpen }}
            onPress={toggleFiltersOpen}
            style={({ pressed }) => [
              styles.filterToggle,
              filtersOpen || activeFilterCount > 0 ? styles.filterToggleActive : null,
              pressed ? styles.chipPressed : null,
            ]}
          >
            <Text style={styles.filterToggleText}>
              {`סינון${activeFilterCount ? ` ${activeFilterCount}` : ""}`}
            </Text>
            <Text style={styles.filterChevron}>{filtersOpen ? "▴" : "▾"}</Text>
          </Pressable>
        </View>
      </View>

      {locationError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {locationError}
        </Text>
      ) : null}

      {filtersOpen ? (
        <View style={styles.filters}>
          {FILTER_GROUPS.map((group) => (
            <View key={group.axis} style={styles.group}>
              <Text style={styles.groupLabel}>{group.label}</Text>
              <View style={styles.chipRow}>
                {group.options.map((opt) => (
                  <Chip
                    key={opt.value}
                    label={opt.label}
                    active={filters[group.axis].has(opt.value)}
                    onPress={() => toggleAxis(group.axis, opt.value)}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>עוד מסלולים מומלצים</Text>
        <Text style={styles.sectionCount}>{`${ordered.length} מסלולים`}</Text>
      </View>

      <View style={styles.list}>
        {secondaryRoutes.map((entry, index) => (
          <RouteCard
            key={entry.slug || entry.name}
            entry={entry}
            index={heroRoute ? index + 1 : index}
            placeById={placeById}
            fix={fix}
            onSelect={onSelect}
            variant="compact"
          />
        ))}
      </View>
    </View>
  );
}

function Chip({ label, active, onPress, icon = false, variant = "default" }) {
  const intent = variant === "intent";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        intent ? styles.intentChip : styles.chip,
        active ? styles.chipActive : null,
        pressed ? styles.chipPressed : null,
      ]}
    >
      {icon ? <Text style={styles.chipIcon}>📍</Text> : null}
      <Text style={[intent ? styles.intentChipText : styles.chipText, active ? styles.chipTextActive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  intro: { paddingHorizontal: 12, gap: 4 },
  kicker: {
    color: "#9f5d25",
    fontSize: 12,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  heading: {
    color: palette.ink,
    fontSize: 30,
    fontWeight: "900",
    lineHeight: 36,
    textAlign: "right",
    writingDirection: "rtl",
  },
  search: {
    marginHorizontal: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: palette.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.line,
    color: palette.ink,
    fontSize: 15,
    writingDirection: "rtl",
  },
  intent: { paddingHorizontal: 12, gap: 8 },
  intentTitle: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  intentChips: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 8,
  },
  intentChip: {
    flexDirection: "row-reverse",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.line,
  },
  intentChipText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  filterToggle: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.line,
  },
  filterToggleActive: {
    backgroundColor: "#f3f7f1",
    borderColor: palette.forest,
  },
  filterToggleText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  filterChevron: { color: palette.muted, fontSize: 12 },
  error: {
    marginHorizontal: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "#fdecec",
    color: "#b42318",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
    textAlign: "right",
    writingDirection: "rtl",
  },
  filters: { paddingHorizontal: 12, gap: space.sm },
  group: { gap: 5 },
  groupLabel: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  chipRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: palette.cream,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.line,
  },
  chipActive: {
    backgroundColor: palette.forest,
    borderColor: palette.forest,
  },
  chipPressed: { opacity: 0.8 },
  chipIcon: { fontSize: 12 },
  chipText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "700",
    writingDirection: "rtl",
  },
  chipTextActive: { color: palette.white },
  sectionHead: {
    paddingHorizontal: 12,
    flexDirection: "row-reverse",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  sectionCount: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  count: {
    paddingHorizontal: 12,
    color: palette.muted,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  list: { gap: 8, paddingHorizontal: 12 },
  empty: { paddingHorizontal: 12, paddingVertical: 18, alignItems: "center" },
  emptyText: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "700",
    writingDirection: "rtl",
  },
});
