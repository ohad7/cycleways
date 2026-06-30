import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { getJsonAsset } from "@cycleways/core/platform/assets.js";
import { sortByDistanceFromUser } from "@cycleways/core/data/nearMe.js";
import {
  FILTER_GROUPS,
  emptyFilters,
  selectDiscoverRoutes,
} from "@cycleways/core/data/discoverFilters.js";
import { filterCatalogBySearch } from "@cycleways/core/data/catalogSearch.js";
import RouteCard from "./RouteCard.jsx";
import { palette, radius, space } from "./theme.js";

// Native Discover list with feature parity to the mobile-web Discover panel:
// difficulty / surface / distance chip filters + a "near me" toggle + a result
// count, then the catalog as branded route cards. Filtering + ordering reuse the
// shared @cycleways/core helpers; only the chip rendering is native.
export default function DiscoverPanel({ entries, onSelect, fix, query, onQueryChange }) {
  const [places, setPlaces] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [nearMeSort, setNearMeSort] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

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

  const activeFilterCount = useMemo(
    () =>
      FILTER_GROUPS.reduce((sum, g) => sum + filters[g.axis].size, 0) +
      (nearMeSort ? 1 : 0),
    [filters, nearMeSort],
  );

  const searched = useMemo(
    () => filterCatalogBySearch(entries, query, placeById),
    [entries, query, placeById],
  );
  const filtered = useMemo(
    () => selectDiscoverRoutes(searched, filters).routes,
    [searched, filters],
  );
  const ordered = useMemo(
    () =>
      nearMeSort && fix
        ? sortByDistanceFromUser(filtered, placeById, fix)
        : filtered,
    [filtered, nearMeSort, fix, placeById],
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
      <TextInput
        style={styles.search}
        placeholder="חפש מסלול..."
        placeholderTextColor={palette.muted}
        value={query}
        onChangeText={onQueryChange}
        textAlign="right"
        accessibilityLabel="חיפוש מסלול"
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="סינון"
        onPress={() => setFiltersOpen((v) => !v)}
        style={styles.filterToggle}
      >
        <Text style={styles.filterToggleText}>
          {`סינון${activeFilterCount ? ` (${activeFilterCount})` : ""}`}
        </Text>
        <Text style={styles.filterChevron}>{filtersOpen ? "▴" : "▾"}</Text>
      </Pressable>

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
          {fix ? (
            <Chip
              label="קרוב אליי"
              icon
              active={nearMeSort}
              onPress={() => setNearMeSort((v) => !v)}
            />
          ) : null}
        </View>
      ) : null}

      <Text style={styles.count}>{`${ordered.length} מסלולים`}</Text>

      <View style={styles.list}>
        {ordered.map((entry, index) => (
          <RouteCard
            key={entry.slug || entry.name}
            entry={entry}
            index={index}
            placeById={placeById}
            fix={fix}
            onSelect={onSelect}
          />
        ))}
      </View>
    </View>
  );
}

function Chip({ label, active, onPress, icon = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active ? styles.chipActive : null,
        pressed ? styles.chipPressed : null,
      ]}
    >
      {icon ? <Text style={styles.chipIcon}>📍</Text> : null}
      <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  search: {
    marginHorizontal: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.md,
    backgroundColor: palette.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.line,
    color: palette.ink,
    fontSize: 14,
    writingDirection: "rtl",
  },
  filterToggle: {
    marginHorizontal: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: palette.cream,
  },
  filterToggleText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  filterChevron: { color: palette.muted, fontSize: 12 },
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
