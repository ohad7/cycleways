import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { fontSizes, text } from "../theme/typography.js";
// Explicit .native import: this app-level file lives outside packages/core/src,
// so Metro's core-only platform remap (metro.config.js) does not swap assets.js
// → assets.native.js here. The web version fetches over the network instead of
// reading the bundled asset, so places.json silently fails to load offline.
import { getJsonAsset } from "@cycleways/core/platform/assets.native.js";
import { sortByDistanceFromUser } from "@cycleways/core/data/nearMe.js";
import {
  routePassesThroughPlaceIds,
  routeStartPlaceIds,
} from "@cycleways/core/data/catalog.js";
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
// start-point / passes-through place filters + difficulty / surface / distance
// chip filters + a "near me" toggle + a result count, then the catalog as
// branded route cards. Filtering + ordering reuse the shared @cycleways/core
// helpers; only the chip + autocomplete rendering is native.
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

  const startOptions = useMemo(
    () => placeOptions(entries, placeById, routeStartPlaceIds),
    [entries, placeById],
  );
  const throughOptions = useMemo(
    () => placeOptions(entries, placeById, routePassesThroughPlaceIds),
    [entries, placeById],
  );

  // Single-select per chip group (mirrors the web toggleAxis behavior).
  const toggleAxis = (axis, value) =>
    setFilters((prev) => {
      const next = new Set(prev[axis]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [axis]: next.size > 1 ? new Set([value]) : next };
    });
  // Place filters are multi-select (mirrors the web add/removeFilterValue).
  const addFilterValue = (axis, value) =>
    setFilters((prev) =>
      prev[axis].has(value)
        ? prev
        : { ...prev, [axis]: new Set(prev[axis]).add(value) },
    );
  const removeFilterValue = (axis, value) =>
    setFilters((prev) => {
      if (!prev[axis].has(value)) return prev;
      const next = new Set(prev[axis]);
      next.delete(value);
      return { ...prev, [axis]: next };
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
      Object.values(filters).reduce(
        (sum, value) => sum + (value instanceof Set ? value.size : 0),
        0,
      ),
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
          {/* First child renders rightmost in this row-reverse row, so "סינון"
              sits at the right edge — the natural start of the row in Hebrew. */}
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
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.1}
              style={styles.filterToggleText}
            >
              סינון
            </Text>
            {activeFilterCount > 0 ? (
              <View style={styles.filterCountBadge}>
                <Text style={styles.filterCountBadgeText}>{activeFilterCount}</Text>
              </View>
            ) : null}
            <Text style={styles.filterChevron}>{filtersOpen ? "▴" : "▾"}</Text>
          </Pressable>
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
        </View>
      </View>

      {locationError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {locationError}
        </Text>
      ) : null}

      {filtersOpen ? (
        <View style={styles.filters}>
          <PlaceAutocompleteFilter
            label="נקודת התחלה"
            placeholder="בחרו ישוב התחלה"
            icon="📍"
            options={startOptions}
            selected={filters.startLocation}
            onSelect={(value) => addFilterValue("startLocation", value)}
            onRemove={(value) => removeFilterValue("startLocation", value)}
          />
          <PlaceAutocompleteFilter
            label="עובר דרך"
            placeholder="בחרו מקום לאורך המסלול"
            icon="🛤️"
            options={throughOptions}
            selected={filters.throughLocation}
            onSelect={(value) => addFilterValue("throughLocation", value)}
            onRemove={(value) => removeFilterValue("throughLocation", value)}
          />
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
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.1}
        style={[intent ? styles.intentChipText : styles.chipText, active ? styles.chipTextActive : null]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// Native multi-select place autocomplete: mirrors the web PlaceAutocompleteFilter
// (selected pills + a filtered suggestion list). The suggestion list renders
// inline below the input so it can't be clipped inside the Discover ScrollView.
function PlaceAutocompleteFilter({
  label,
  placeholder,
  icon,
  options,
  selected,
  onSelect,
  onRemove,
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const selectedValues = Array.from(selected || []);
  const optionByValue = useMemo(
    () => new Map((options || []).map((option) => [option.value, option])),
    [options],
  );
  const normalizedQuery = normalizePlaceQuery(query);
  const matches = useMemo(
    () =>
      (options || [])
        .filter((option) => !selected?.has(option.value))
        .filter((option) => {
          if (!normalizedQuery) return true;
          return normalizePlaceQuery(`${option.label} ${option.value}`).includes(
            normalizedQuery,
          );
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
    <View style={styles.combo}>
      <Text style={styles.comboLabel}>{label}</Text>
      <View style={styles.comboBox}>
        {icon ? <Text style={styles.comboIcon}>{icon}</Text> : null}
        {selectedValues.map((value) => {
          const option = optionByValue.get(value);
          return (
            <View style={styles.comboSelected} key={value}>
              <Text style={styles.comboSelectedText}>{option?.label || value}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`הסר ${option?.label || value}`}
                onPress={() => onRemove(value)}
                hitSlop={8}
              >
                <Text style={styles.comboSelectedRemove}>×</Text>
              </Pressable>
            </View>
          );
        })}
        <TextInput
          style={styles.comboInput}
          value={query}
          placeholder={selectedValues.length > 0 ? "הוספה..." : placeholder}
          placeholderTextColor={palette.muted}
          onChangeText={setQuery}
          onFocus={() => setFocused(true)}
          // Delay so a suggestion press registers before the list hides.
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          textAlign="right"
          accessibilityLabel={label}
        />
      </View>
      {showDropdown ? (
        <View style={styles.comboMenu}>
          {matches.map((option, index) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              onPress={() => selectOption(option.value)}
              style={({ pressed }) => [
                styles.comboMenuItem,
                index > 0 ? styles.comboMenuItemDivider : null,
                pressed ? styles.comboMenuItemPressed : null,
              ]}
            >
              <Text style={styles.comboMenuLabel}>{option.label}</Text>
              {option.count > 0 ? (
                <Text style={styles.comboMenuCount}>{option.count}</Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function placeOptions(entries, placeById, placeIdsForEntry) {
  const counts = new Map();
  for (const entry of entries || []) {
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

function normalizePlaceQuery(value) {
  return String(value || "").trim().toLowerCase();
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  intro: { paddingHorizontal: 12, gap: 4 },
  kicker: {
    ...text.label,
    color: "#9f5d25",
    textAlign: "right",
    writingDirection: "rtl",
  },
  heading: {
    ...text.heading,
    color: palette.ink,
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
    ...text.body,
    color: palette.ink,
    writingDirection: "rtl",
  },
  intent: { paddingHorizontal: 12, gap: 8 },
  intentTitle: {
    ...text.captionStrong,
    color: palette.ink,
    textAlign: "right",
    writingDirection: "rtl",
  },
  intentChips: {
    flexDirection: "row-reverse",
    flexWrap: "nowrap",
    gap: 4,
  },
  intentChip: {
    flexDirection: "row-reverse",
    alignItems: "center",
    flexShrink: 1,
    paddingHorizontal: 7,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.line,
  },
  intentChipText: {
    ...text.label,
    color: palette.ink,
    writingDirection: "rtl",
  },
  filterToggle: {
    flexDirection: "row-reverse",
    alignItems: "center",
    flexShrink: 0,
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 6,
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
    ...text.label,
    color: palette.ink,
    writingDirection: "rtl",
  },
  filterChevron: { color: palette.muted, fontSize: fontSizes.xs },
  filterCountBadge: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.forest,
    alignItems: "center",
    justifyContent: "center",
  },
  filterCountBadgeText: {
    ...text.label,
    color: palette.white,
  },
  error: {
    ...text.caption,
    marginHorizontal: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "#fdecec",
    color: "#b42318",
    textAlign: "right",
    writingDirection: "rtl",
  },
  filters: { paddingHorizontal: 12, gap: space.md },
  combo: { gap: 5 },
  comboLabel: {
    ...text.label,
    color: palette.muted,
    textAlign: "right",
    writingDirection: "rtl",
  },
  comboBox: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: palette.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.line,
  },
  comboIcon: { fontSize: fontSizes.sm },
  comboInput: {
    ...text.body,
    flexGrow: 1,
    minWidth: 120,
    color: palette.ink,
    paddingVertical: 2,
    writingDirection: "rtl",
  },
  comboSelected: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.cream,
  },
  comboSelectedText: {
    ...text.captionStrong,
    color: palette.ink,
    writingDirection: "rtl",
  },
  comboSelectedRemove: {
    // × glyph: size-only, tight line height to center it in the pill.
    color: palette.muted,
    fontSize: fontSizes.md,
    lineHeight: 16,
  },
  comboMenu: {
    marginTop: 4,
    borderRadius: 12,
    backgroundColor: palette.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.line,
    overflow: "hidden",
  },
  comboMenuItem: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  comboMenuItemDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.line,
  },
  comboMenuItemPressed: { backgroundColor: palette.paper },
  comboMenuLabel: {
    ...text.body,
    color: palette.ink,
    writingDirection: "rtl",
  },
  comboMenuCount: { ...text.caption, color: palette.muted },
  group: { gap: 5 },
  groupLabel: {
    ...text.label,
    color: palette.muted,
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
  chipIcon: { fontSize: fontSizes.sm },
  chipText: {
    ...text.captionStrong,
    color: palette.ink,
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
    ...text.subheading,
    color: palette.ink,
    textAlign: "right",
    writingDirection: "rtl",
  },
  sectionCount: {
    ...text.caption,
    color: palette.muted,
    writingDirection: "rtl",
  },
  count: {
    ...text.caption,
    paddingHorizontal: 12,
    color: palette.muted,
    textAlign: "right",
    writingDirection: "rtl",
  },
  list: { gap: 8, paddingHorizontal: 12 },
  empty: { paddingHorizontal: 12, paddingVertical: 18, alignItems: "center" },
  emptyText: {
    ...text.caption,
    color: palette.muted,
    writingDirection: "rtl",
  },
});
