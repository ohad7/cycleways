import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  findRouteCatalogEntryBySlug,
  loadRouteCatalogEntries,
} from "@cycleways/core/data/catalog.js";
import {
  loadFeaturedRouteSnapshot,
  snapshotToRouteState,
} from "@cycleways/core/data/featuredRouteSnapshots.js";
import { resetNativeLocationHref } from "@cycleways/core/platform/location.native.js";
import {
  loadRouteVideoIndex,
  loadRouteVideoKeyframes,
} from "@cycleways/core/featured/routeVideoIndex.js";
import { createVideoSync } from "@cycleways/core/featured/videoSync.js";
import { routeDetailModel } from "./routeDetailModel.js";
import RouteMapPreview from "./RouteMapPreview.jsx";
import SyncedRouteStage from "./SyncedRouteStage.jsx";
import RoutePoiList from "../planner/RoutePoiList.jsx";
import ElevationProfileChart from "../ElevationProfileChart.jsx";
import { palette } from "../planner/theme.js";

export default function RouteDetailScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const slug = route?.params?.slug ?? null;
  const [entry, setEntry] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState("loading");
  const [videoData, setVideoData] = useState(null);
  const [cursorFraction, setCursorFraction] = useState(null);

  useEffect(() => {
    if (!slug) {
      setStatus("error");
      return undefined;
    }
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const [entries, snap] = await Promise.all([
          loadRouteCatalogEntries(),
          loadFeaturedRouteSnapshot(slug),
        ]);
        if (cancelled) return;
        setEntry(findRouteCatalogEntryBySlug({ entries }, slug));
        setSnapshot(snap);
        setStatus("ready");
      } catch (error) {
        if (!cancelled) {
          console.warn("Route detail load failed:", error);
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Load the route's synced-video data (keyframes + youtubeId) when it has one.
  // Routes without a video simply leave videoData null and show the map alone.
  useEffect(() => {
    setVideoData(null);
    setCursorFraction(null);
    if (!slug) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const index = await loadRouteVideoIndex();
        const file = index?.routes?.[slug];
        if (!file) return;
        const data = await loadRouteVideoKeyframes(file);
        if (!cancelled) setVideoData(data);
      } catch (error) {
        if (!cancelled) console.warn("Route video load failed:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const routeState = useMemo(
    () => (snapshot ? snapshotToRouteState(snapshot) : null),
    [snapshot],
  );
  const model = useMemo(
    () => (entry ? routeDetailModel(entry, snapshot) : null),
    [entry, snapshot],
  );

  // Build the time↔route sync from the video keyframes + the route geometry.
  // createVideoSync throws on invalid input (e.g. < 2 keyframes); fall back to
  // no sync (map-only) in that case.
  const videoSync = useMemo(() => {
    if (!videoData || !routeState || routeState.geometry.length < 2) return null;
    try {
      return createVideoSync({
        keyframes: videoData.keyframes,
        videoDuration: videoData.videoDuration,
        routeGeometry: routeState.geometry,
      });
    } catch (error) {
      console.warn("createVideoSync failed:", error);
      return null;
    }
  }, [videoData, routeState]);

  const openEditor = () => {
    if (!entry?.route) return;
    resetNativeLocationHref();
    navigation.navigate("Build", {
      routeToken: entry.route,
      slug: entry.slug ?? null,
      name: entry.name ?? null,
    });
  };

  if (status === "loading") {
    return <Centered insets={insets} text="טוען מסלול…" />;
  }
  if (status === "error" || !model || !routeState) {
    return <Centered insets={insets} text="לא הצלחנו לטעון את המסלול." />;
  }

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 96 }]}
      >
        <View style={styles.header}>
          {model.kicker ? <Text style={styles.kicker}>{model.kicker}</Text> : null}
          <Text style={styles.title}>{model.title}</Text>
          {model.stats.length ? (
            <View style={styles.statsRow}>
              {model.stats.map((s) => (
                <View key={s.label} style={styles.stat}>
                  <Text style={styles.statValue}>{s.value}</Text>
                  <Text style={styles.statLabel}>{s.label}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          {videoData && videoSync ? (
            <SyncedRouteStage
              youtubeId={videoData.youtubeId}
              sync={videoSync}
              geometry={routeState.geometry}
              activeDataPoints={routeState.activeDataPoints}
              onCursorChange={(c) => setCursorFraction(c.fraction)}
            />
          ) : (
            <RouteMapPreview
              geometry={routeState.geometry}
              activeDataPoints={routeState.activeDataPoints}
            />
          )}
        </View>

        {model.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>על המסלול</Text>
            <Text style={styles.body}>{model.description}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <RoutePoiList activeDataPoints={routeState.activeDataPoints} />
        </View>

        {routeState.geometry.length >= 2 ? (
          <View style={styles.section}>
            <ElevationProfileChart
              geometry={routeState.geometry}
              cursorFraction={cursorFraction}
            />
          </View>
        ) : null}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="פתח לעריכה"
        onPress={openEditor}
        style={({ pressed }) => [
          styles.cta,
          { bottom: insets.bottom + 16 },
          pressed ? styles.ctaPressed : null,
        ]}
      >
        <Text style={styles.ctaText}>פתח לעריכה</Text>
      </Pressable>
    </View>
  );
}

function Centered({ insets, text }) {
  return (
    <View style={[styles.fill, styles.center, { paddingTop: insets.top }]}>
      <Text style={styles.body}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.paper },
  center: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: 16, gap: 16 },
  header: { gap: 6 },
  kicker: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  title: {
    color: palette.ink,
    fontSize: 24,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  statsRow: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 16,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.line,
    marginTop: 4,
  },
  stat: { alignItems: "center" },
  statValue: { color: palette.ink, fontSize: 15, fontWeight: "800" },
  statLabel: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: "700",
    writingDirection: "rtl",
  },
  section: { gap: 8 },
  sectionHeading: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  body: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "right",
    writingDirection: "rtl",
  },
  cta: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: palette.forest,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 28,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  ctaPressed: { opacity: 0.85 },
  ctaText: {
    color: palette.white,
    fontSize: 16,
    fontWeight: "800",
    writingDirection: "rtl",
  },
});
