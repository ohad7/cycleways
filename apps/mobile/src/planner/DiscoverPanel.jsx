import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { getJsonAsset } from "@cycleways/core/platform/assets.js";
import { sortByDistanceFromUser } from "@cycleways/core/data/nearMe.js";
import RouteCard from "./RouteCard.jsx";
import { palette } from "./theme.js";

// Native Discover list: the bundled catalog as branded route cards. Loads
// places.json for the "via place" line + near-me ordering when a fix exists.
export default function DiscoverPanel({ entries, onSelect, fix }) {
  const [places, setPlaces] = useState([]);

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

  const ordered = useMemo(
    () => (fix ? sortByDistanceFromUser(entries, placeById, fix) : entries || []),
    [entries, placeById, fix],
  );

  if (!entries || entries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>טוען מסלולים...</Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {ordered.map((entry) => (
        <RouteCard
          key={entry.slug || entry.name}
          entry={entry}
          placeById={placeById}
          fix={fix}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8, paddingHorizontal: 12 },
  empty: { paddingHorizontal: 12, paddingVertical: 18, alignItems: "center" },
  emptyText: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "700",
    writingDirection: "rtl",
  },
});
