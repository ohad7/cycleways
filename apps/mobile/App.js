import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  Linking,
  LogBox,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  createNativeRouteHref,
  getNativeRoutePath,
  setNativeLocationHref,
} from "@cycleways/core/platform/location.native.js";
import {
  findRouteCatalogEntryBySlug,
  loadRouteCatalogEntries,
} from "@cycleways/core/data/catalog.js";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import MapScreen from "./src/MapScreen.jsx";

LogBox.ignoreLogs([
  "SafeAreaView has been deprecated",
  "Invalid size is used for setting the map view",
]);

// Phase 2.4: render the native iPhone map from the shared app controller.
export default function App() {
  const [locationReady, setLocationReady] = useState(false);
  const [launchError, setLaunchError] = useState(null);
  const [screenKey, setScreenKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    let launchRequestId = 0;

    async function applyLaunchUrl(url, { remount = false } = {}) {
      const requestId = ++launchRequestId;
      const result = await resolveNativeLaunchUrl(url);
      if (!mounted || requestId !== launchRequestId) return;
      setLaunchError(result.error);
      setLocationReady(true);
      if (remount && !result.error) {
        setScreenKey((key) => key + 1);
      }
    }

    Linking.getInitialURL()
      .then((url) => applyLaunchUrl(url))
      .catch((error) => {
        setNativeLocationHref(null);
        console.warn("Native initial route link failed:", error);
        if (mounted) {
          setLocationReady(true);
        }
      });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      void applyLaunchUrl(url, { remount: true });
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
          <SafeAreaView style={styles.fill}>
            {locationReady ? <MapScreen key={screenKey} /> : null}
            {launchError ? (
              <LaunchErrorOverlay
                message={launchError.message}
                onDismiss={() => setLaunchError(null)}
              />
            ) : null}
            <StatusBar style="auto" />
          </SafeAreaView>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

async function resolveNativeLaunchUrl(url) {
  const routePath = getNativeRoutePath(url);
  if (!routePath) {
    setNativeLocationHref(url);
    return { error: null };
  }

  try {
    const entries = await loadRouteCatalogEntries();
    const entry = findRouteCatalogEntryBySlug({ entries }, routePath.slug);
    if (!entry?.route) {
      return {
        error: {
          message: `לא נמצא מסלול בשם ${routePath.slug}`,
        },
      };
    }
    setNativeLocationHref(
      createNativeRouteHref(entry.route, {
        source: "catalog",
        collection: routePath.collection,
        slug: entry.slug,
        name: entry.name,
      }),
    );
    return { error: null };
  } catch (error) {
    console.warn("Native route catalog link failed:", error);
    return {
      error: {
        message: "לא הצלחנו לפתוח את המסלול מהקטלוג",
      },
    };
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
          accessibilityLabel="חזרה למפה"
          onPress={onDismiss}
          style={({ pressed }) => [
            styles.errorButton,
            pressed ? styles.errorButtonPressed : null,
          ]}
        >
          <Text style={styles.errorButtonText}>חזרה למפה</Text>
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
  errorButtonPressed: {
    opacity: 0.75,
  },
  errorButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
});
