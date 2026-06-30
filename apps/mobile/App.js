import { useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Linking, LogBox, Pressable, StyleSheet, Text, View } from "react-native";
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

LogBox.ignoreLogs([
  "SafeAreaView has been deprecated",
  "Invalid size is used for setting the map view",
]);

const navigationRef = createNavigationContainerRef();

export default function App() {
  const [ready, setReady] = useState(false);
  const [launchError, setLaunchError] = useState(null);
  const initialTargetRef = useRef({ screen: "Discover", params: undefined });

  useEffect(() => {
    let mounted = true;
    let launchRequestId = 0;

    async function applyLaunchUrl(url, { warm = false } = {}) {
      const requestId = ++launchRequestId;
      const result = await resolveNativeLaunchUrl(url);
      if (!mounted || requestId !== launchRequestId) return;
      setLaunchError(result.error);
      if (!result.error) {
        if (warm) {
          // Warm catalog-route link: drive Build via params (not the href). Reset the
          // href that resolveNativeLaunchUrl just seeded so a freshly-mounted Build
          // controller does not ALSO load it (double-load), then navigate with the
          // routeToken so the params loader fires even when Build is already focused.
          if (navigationRef.isReady() && result.resolved) {
            resetNativeLocationHref();
            navigationRef.navigate("Build", {
              routeToken: result.resolved.routeToken,
              slug: result.resolved.slug,
              name: result.resolved.name,
            });
          }
        } else {
          // Cold start: Build loads via the seeded href (params carry slug only, NO
          // routeToken) so the controller init effect reads the href and the params
          // loader does not double-fire. Keep this asymmetry — do not add routeToken
          // here.
          initialTargetRef.current = launchTargetFromHref(url);
        }
      }
      setReady(true);
    }

    Linking.getInitialURL()
      .then((url) => applyLaunchUrl(url))
      .catch((error) => {
        setNativeLocationHref(null);
        console.warn("Native initial route link failed:", error);
        if (mounted) setReady(true);
      });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      void applyLaunchUrl(url, { warm: true });
    });

    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

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
            <StatusBar style="auto" />
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
