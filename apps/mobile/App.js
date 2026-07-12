import { useCallback, useEffect, useRef, useState } from "react";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { text } from "./src/theme/typography.js";
import {
  Linking,
  Alert,
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
import { activeRideLaunchDecision } from "@cycleways/core/navigation/resumePolicy.js";
import {
  clearActiveNavigationSession,
  loadActiveNavigationSession,
} from "./src/navigation/activeNavigationStore.js";
import { stopNavigationBackgroundUpdates } from "./src/navigation/locationService.js";
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

function pendingRideParams(pendingRide) {
  return {
    routeToken: pendingRide.routeToken,
    slug: pendingRide.slug,
    name: pendingRide.name,
    openRideSetup: true,
    rideSetupSelection: {
      direction: pendingRide.direction,
      startMode: pendingRide.startMode,
      selectedPoint: pendingRide.selectedPoint,
      startProgressMeters: pendingRide.startProgressMeters,
    },
  };
}

function resumeParamsFromRecord(record) {
  const route = record.navigationRoute;
  return {
    routeToken: route.routeParam,
    resumeRide: {
      sessionId: record.sessionId,
      direction: route.direction,
      startMode: route.startMode,
      startProgressMeters: route.startProgressMeters,
      selectedPoint: route.selectedPoint ?? null,
    },
  };
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [showLaunchSplash, setShowLaunchSplash] = useState(true);
  // The splash shows a rotating set of flavor phrases (AnimatedLaunchSplash), so
  // it only needs monotonic progress for the bar — not per-milestone status text.
  const [splashProgress, setSplashProgress] = useState(0.12);
  const [launchError, setLaunchError] = useState(null);
  const [warmResume, setWarmResume] = useState(null);
  const initialTargetRef = useRef({ screen: "Discover", params: undefined });
  const nativeSplashHiddenRef = useRef(false);

  const advanceSplash = useCallback((progress) => {
    setSplashProgress((current) => (progress > current ? progress : current));
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
      if (!warm) {
        const resumeRecord = await loadActiveNavigationSession();
        if (!mounted || requestId !== launchRequestId) return;
        const resumeDecision = activeRideLaunchDecision(resumeRecord, {
          initialUrl: url,
        });
        if (resumeDecision.action === "resume") {
          initialTargetRef.current = {
            screen: "Build",
            params: resumeParamsFromRecord(resumeRecord),
          };
          return { error: null, resolved: null };
        }
        if (resumeDecision.action === "prompt") {
          setWarmResume({
            record: resumeRecord,
            deferredUrl: resumeDecision.deferredUrl,
          });
          return { error: null, resolved: null };
        }
        if (resumeRecord) await clearActiveNavigationSession();
        await stopNavigationBackgroundUpdates();
        if (!mounted || requestId !== launchRequestId) return;
      }
      if (!url && !warm) {
        const pendingRide = await loadPendingRideIntent();
        if (!mounted || requestId !== launchRequestId) return;
        if (pendingRide) {
          initialTargetRef.current = {
            screen: "Build",
            params: pendingRideParams(pendingRide),
          };
          return { error: null, resolved: pendingRide };
        }
      }
      const result = await resolveNativeLaunchUrl(url);
      if (!mounted || requestId !== launchRequestId) return;
      setLaunchError(result.error);
      if (!result.error) {
        if (warm) {
          // Route paths open their catalog detail; raw ?route= links open Build
          // with the token explicitly so the restore does not depend on Build
          // already being mounted and observing the synthetic native href.
          if (navigationRef.isReady()) {
            const target = launchTargetFromHref(url);
            navigationRef.navigate(target.screen, {
              ...target.params,
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
        if (mounted) advanceSplash(0.42);
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
      if (mounted) advanceSplash(0.68);
      return result;
    });

    const initialLaunch = Linking.getInitialURL()
      .then(async (url) => {
        const result = await applyLaunchUrl(url);
        if (mounted) advanceSplash(0.88);
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
      advanceSplash(1);
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

  useEffect(() => {
    if (!ready || !warmResume) return;
    const { record, deferredUrl } = warmResume;
    setWarmResume(null);
    Alert.alert("רכיבה פעילה נשמרה", "להמשיך את הרכיבה הקודמת?", [
      {
        text: "סיום הרכיבה",
        style: "destructive",
        onPress: () => {
          void (async () => {
            await clearActiveNavigationSession();
            await stopNavigationBackgroundUpdates();
            if (deferredUrl) {
              const result = await resolveNativeLaunchUrl(deferredUrl);
              if (result.error) {
                setLaunchError(result.error);
              } else if (result.resolved && navigationRef.isReady()) {
                navigationRef.navigate("RouteDetail", {
                  slug: result.resolved.slug,
                  openId: Date.now(),
                });
              } else if (navigationRef.isReady()) {
                const target = launchTargetFromHref(deferredUrl);
                navigationRef.navigate(target.screen, target.params);
              }
              return;
            }
            const pendingRide = await loadPendingRideIntent();
            if (pendingRide && navigationRef.isReady()) {
              navigationRef.navigate("Build", pendingRideParams(pendingRide));
            }
          })();
        },
      },
      {
        text: "המשך רכיבה",
        onPress: () => {
          if (navigationRef.isReady()) {
            navigationRef.navigate("Build", resumeParamsFromRecord(record));
          }
        },
      },
    ]);
  }, [ready, warmResume]);

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
                progress={splashProgress}
                ready={ready}
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
    ...text.subheading,
    color: "#1c332b",
    marginBottom: 8,
    textAlign: "right",
    writingDirection: "rtl",
  },
  errorText: {
    ...text.body,
    color: "#3f514b",
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
  errorButtonText: { ...text.bodyStrong, color: "#ffffff" },
});
