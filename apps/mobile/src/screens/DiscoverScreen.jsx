import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { loadRouteCatalogEntries } from "@cycleways/core/data/catalog.js";
import { resetNativeLocationHref } from "@cycleways/core/platform/location.native.js";
import DiscoverPanel from "../planner/DiscoverPanel.jsx";
import { palette } from "../planner/theme.js";

export default function DiscoverScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState("");
  const [fix, setFix] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadRouteCatalogEntries()
      .then((list) => {
        if (!cancelled) setEntries(Array.isArray(list) ? list : []);
      })
      .catch((error) => console.warn("Discover catalog load failed:", error));
    return () => {
      cancelled = true;
    };
  }, []);

  // Best-effort last-known location for the "near me" sort; no prompt here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getLastKnownPositionAsync();
        if (!cancelled && pos?.coords) {
          setFix({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {
        // ignore — near-me is optional
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openRoute = (entry) => {
    if (!entry?.slug) return;
    navigation.navigate("RouteDetail", { slug: entry.slug });
  };

  const planFromScratch = () => {
    resetNativeLocationHref();
    navigation.navigate("Build", {});
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>גלה מסלול</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <DiscoverPanel
          entries={entries}
          onSelect={openRoute}
          fix={fix}
          query={query}
          onQueryChange={setQuery}
        />
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="תכנן מסלול"
        onPress={planFromScratch}
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + 20 },
          pressed ? styles.fabPressed : null,
        ]}
      >
        <Text style={styles.fabText}>＋ תכנן מסלול</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.paper },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  title: {
    color: palette.ink,
    fontSize: 22,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  scroll: { paddingTop: 8, paddingBottom: 120 },
  fab: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row-reverse",
    alignItems: "center",
    backgroundColor: palette.forest,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 28,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPressed: { opacity: 0.85 },
  fabText: { color: palette.white, fontSize: 16, fontWeight: "800", writingDirection: "rtl" },
});
