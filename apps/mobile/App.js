import { useCallback, useEffect, useRef, useState } from "react";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import {
  Linking,
  LogBox,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { createNavigationContainerRef } from "@react-navigation/native";
import {
  createNativeRouteHref,
  getNativeRoutePath,
  resetNativeLocationHref,
  setNativeLocationHref,
} from "@cycleways/core/platform/location.native.js";
import {
  findRouteCatalogEntryBySlug,
  loadRouteCatalogEntries,
} from "@cycleways/core/data/catalog.js";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import RootNavigator from "./src/navigation/RootNavigator.jsx";
import { launchTargetFromHref } from "./src/navigation/launchTarget.js";
import { startWebServer } from "./src/webServer.js";
import { loadPendingRideIntent } from "./src/navigation/pendingRidePlanStore.js";
import AnimatedLaunchSplash from "./src/splash/AnimatedLaunchSplash.jsx";
import {
  SERVER_PRELOAD_BUDGET_MS,
  settleWithin,
  waitForLaunchSplashMinimum,
} from "./src/splash/bootstrapTiming.js";

const APP_BOOTSTRAP_STARTED_AT = Date.now();
void SplashScreen.preventAutoHideAsync().catch(() => {});

LogBox.ignoreLogs([
  "SafeAreaView has been deprecated",
  "Invalid size is used for setting the map view",
]);

const navigationRef = createNavigationContainerRef();

export default function App() {
  const [ready, setReady] = useState(false);
  const [showLaunchSplash, setShowLaunchSplash] = useState(true);
  const [splashMilestone, setSplashMilestone] = useState({
    progress: 0.12,
    status: "מכינים את האפליקציה…",
  });
  const [launchError, setLaunchError] = useState(null);
  const initialTargetRef = useRef({ screen: "Discover", params: undefined });
  const nativeSplashHiddenRef = useRef(false);

  const advanceSplash = useCallback((progress, status) => {
    setSplashMilestone((current) =>
      progress > current.progress ? { progress, status } : current,
    );
  }, []);

  const handleSplashLayout = useCallback(() => {
    if (nativeSplashHiddenRef.current) return;
    nativeSplashHiddenRef.current = true;
    void SplashScreen.hideAsync().catch(() => {});
  }, []);
  const finishLaunchSplash = useCallback(() => {
    setShowLaunchSplash(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    let launchRequestId = 0;

    async function applyLaunchUrl(url, { warm = false } = {}) {
      const requestId = ++launchRequestId;
      if (!url && !warm) {
        const pendingRide = await loadPendingRideIntent();
        if (!mounted || requestId !== launchRequestId) return;
        if (pendingRide) {
          initialTargetRef.current = {
            screen: "Build",
            params: {
              routeToken: pendingRide.routeToken,
              slug: pendingRide.slug,
              name: pendingRide.name,
              openRideSetup: true,
              rideSetupSelection: {
                direction: pendingRide.direction,
                startMode: pendingRide.startMode,
                selectedPoint: pendingRide.selectedPoint,
              },
            },
          };
          return { error: null, resolved: pendingRide };
        }
      }
      const result = await resolveNativeLaunchUrl(url);
      if (!mounted || requestId !== launchRequestId) return;
      setLaunchError(result.error);
      if (!result.error) {
        if (warm) {
          // Warm catalog-route link: open the detail screen by slug. RouteDetail
          // loads from the bundled snapshot, so the seeded href is not used here
          // (the editor is reached later via the detail CTA, which passes the
          // route token explicitly and resets the href first).
          if (navigationRef.isReady() && result.resolved) {
            navigationRef.navigate("RouteDetail", {
              slug: result.resolved.slug,
              openId: Date.now(),
            });
          }
        } else {
          // Cold start: launchTargetFromHref maps a catalog-route link to the
          // RouteDetail screen with its slug.
          initialTargetRef.current = launchTargetFromHref(url);
        }
      }
      return result;
    }

    const catalogPreload = loadRouteCatalogEntries()
      .then((entries) => {
        if (mounted) advanceSplash(0.42, "טוענים את המסלולים…");
        return entries;
      })
      .catch((error) => {
        console.warn("Route catalog preload failed:", error);
        return [];
      });

    const serverPreload = settleWithin(
      startWebServer(),
      SERVER_PRELOAD_BUDGET_MS,
    ).then((result) => {
      if (result.status === "rejected") {
        console.warn("Featured route server warm-up failed:", result.reason);
      }
      if (mounted) advanceSplash(0.68, "מכינים את סיפורי המסלול…");
      return result;
    });

    const initialLaunch = Linking.getInitialURL()
      .then(async (url) => {
        const result = await applyLaunchUrl(url);
        if (mounted) advanceSplash(0.88, "מסדרים את נקודת הפתיחה…");
        return result;
      })
      .catch((error) => {
        setNativeLocationHref(null);
        console.warn("Native initial route link failed:", error);
        return { error: null, resolved: null };
      });

    Promise.all([
      catalogPreload,
      serverPreload,
      initialLaunch,
      waitForLaunchSplashMinimum(APP_BOOTSTRAP_STARTED_AT),
    ]).then(() => {
      if (!mounted) return;
      advanceSplash(1, "יוצאים לדרך");
      setReady(true);
    });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      void applyLaunchUrl(url, { warm: true });
    });

    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, [advanceSplash]);

  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider>
        <BottomSheetModalProvider>
          <View style={styles.fill}>
            {ready ? (
              <RootNavigator
                initialRouteName={initialTargetRef.current.screen}
                initialParams={initialTargetRef.current.params}
                navigationRef={navigationRef}
              />
            ) : null}
            {launchError ? (
              <LaunchErrorOverlay
                message={launchError.message}
                onDismiss={() => setLaunchError(null)}
              />
            ) : null}
            {showLaunchSplash ? (
              <AnimatedLaunchSplash
                progress={splashMilestone.progress}
                ready={ready}
                status={splashMilestone.status}
                onFirstLayout={handleSplashLayout}
                onFinished={finishLaunchSplash}
              />
            ) : null}
            <StatusBar style="auto" hidden={showLaunchSplash} />
          </View>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Validates a launch URL: a catalog route link is looked up and its encoded
// route token seeded into the native href so the controller cold-loads it; a
// non-route link is passed through. Returns a launch error when the slug is
// unknown.
async function resolveNativeLaunchUrl(url) {
  const routePath = getNativeRoutePath(url);
  if (!routePath) {
    setNativeLocationHref(url);
    return { error: null, resolved: null };
  }
  try {
    const entries = await loadRouteCatalogEntries();
    const entry = findRouteCatalogEntryBySlug({ entries }, routePath.slug);
    if (!entry?.route) {
      return { error: { message: `לא נמצא מסלול בשם ${routePath.slug}` }, resolved: null };
    }
    setNativeLocationHref(
      createNativeRouteHref(entry.route, {
        source: "catalog",
        collection: routePath.collection,
        slug: entry.slug,
        name: entry.name,
      }),
    );
    return { error: null, resolved: { routeToken: entry.route, slug: entry.slug, name: entry.name } };
  } catch (error) {
    console.warn("Native route catalog link failed:", error);
    return { error: { message: "לא הצלחנו לפתוח את המסלול מהקטלוג" }, resolved: null };
  }
}

function LaunchErrorOverlay({ message, onDismiss }) {
  return (
    <View pointerEvents="box-none" style={styles.errorOverlay}>
      <View style={styles.errorPanel}>
        <Text style={styles.errorTitle}>קישור למסלול לא נפתח</Text>
        <Text style={styles.errorText}>{message}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="סגור"
          onPress={onDismiss}
          style={({ pressed }) => [
            styles.errorButton,
            pressed ? styles.errorButtonPressed : null,
          ]}
        >
          <Text style={styles.errorButtonText}>סגור</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  errorPanel: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    padding: 18,
    shadowColor: "#000000",
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  errorTitle: {
    color: "#1c332b",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "right",
    writingDirection: "rtl",
  },
  errorText: {
    color: "#3f514b",
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 14,
    textAlign: "right",
    writingDirection: "rtl",
  },
  errorButton: {
    alignSelf: "flex-start",
    borderRadius: 8,
    backgroundColor: "#1e668c",
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  errorButtonPressed: { opacity: 0.75 },
  errorButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
});
