import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { loadRouteCatalogEntries } from "@cycleways/core/data/catalog.js";
import { resetNativeLocationHref } from "@cycleways/core/platform/location.native.js";
import DiscoverPanel from "../planner/DiscoverPanel.jsx";
import { palette } from "../planner/theme.js";
import { text } from "../theme/typography.js";

export default function DiscoverScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState("");
  const [fix, setFix] = useState(null);
  const [locationError, setLocationError] = useState("");
  const scrollRef = useRef(null);
  const scrollYRef = useRef(0);
  const scrollAnimationRef = useRef(null);

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

  useEffect(
    () => () => {
      if (scrollAnimationRef.current) {
        cancelAnimationFrame(scrollAnimationRef.current);
      }
    },
    [],
  );

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
    navigation.navigate("RouteDetail", { slug: entry.slug, openId: Date.now() });
  };

  const planFromScratch = () => {
    resetNativeLocationHref();
    navigation.navigate("Build", {});
  };
  const revealFilters = (y = 0) => {
    const startY = scrollYRef.current;
    const targetY = Math.max(0, y - 12);
    const distance = targetY - startY;
    if (Math.abs(distance) < 4) return;
    if (scrollAnimationRef.current) {
      cancelAnimationFrame(scrollAnimationRef.current);
    }
    const duration = 700;
    const startTime = Date.now();
    const ease = (t) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const step = () => {
      const progress = Math.min(1, (Date.now() - startTime) / duration);
      const nextY = startY + distance * ease(progress);
      scrollYRef.current = nextY;
      scrollRef.current?.scrollTo({ y: nextY, animated: false });
      if (progress < 1) {
        scrollAnimationRef.current = requestAnimationFrame(step);
      } else {
        scrollAnimationRef.current = null;
        scrollYRef.current = targetY;
      }
    };
    scrollAnimationRef.current = requestAnimationFrame(step);
  };
  const requestLocation = async () => {
    try {
      setLocationError("");
      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (permission.status !== "granted") {
        setLocationError("לא הצלחנו לאתר את המיקום שלך. אפשר להמשיך לבחור מסלול מהרשימה.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (pos?.coords) {
        setFix({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      }
    } catch {
      setLocationError("לא הצלחנו לאתר את המיקום שלך. אפשר להמשיך לבחור מסלול מהרשימה.");
    }
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        onScroll={(event) => {
          scrollYRef.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        <DiscoverPanel
          entries={entries}
          onSelect={openRoute}
          fix={fix}
          query={query}
          onQueryChange={setQuery}
          onRequestLocation={requestLocation}
          locationError={locationError}
          onRevealFilters={revealFilters}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="אודות, פרטיות ותנאי שימוש"
          onPress={() => navigation.navigate("About")}
          style={({ pressed }) => [
            styles.aboutLink,
            pressed ? { opacity: 0.7 } : null,
          ]}
        >
          <Text style={styles.aboutLinkText}>אודות CycleWays · פרטיות ותנאים</Text>
        </Pressable>
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
  scroll: { paddingTop: 18, paddingBottom: 120 },
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
  fabText: { ...text.bodyStrong, color: palette.white, writingDirection: "rtl" },
  aboutLink: {
    alignSelf: "center",
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  aboutLinkText: {
    ...text.caption,
    color: palette.muted,
    textDecorationLine: "underline",
    writingDirection: "rtl",
  },
});
