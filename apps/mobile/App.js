import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Linking, LogBox, SafeAreaView, StyleSheet } from "react-native";
import { setNativeLocationHref } from "@cycleways/core/platform/location.native.js";
import MapScreen from "./src/MapScreen.jsx";

LogBox.ignoreLogs([
  "SafeAreaView has been deprecated",
  "Invalid size is used for setting the map view",
]);

// Phase 2.4: render the native iPhone map from the shared app controller.
export default function App() {
  const [locationReady, setLocationReady] = useState(false);
  const [screenKey, setScreenKey] = useState(0);

  useEffect(() => {
    let mounted = true;

    Linking.getInitialURL()
      .then((url) => {
        setNativeLocationHref(url);
      })
      .catch((error) => {
        setNativeLocationHref(null);
        console.warn("Native initial route link failed:", error);
      })
      .finally(() => {
        if (mounted) {
          setLocationReady(true);
        }
      });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      setNativeLocationHref(url);
      setScreenKey((key) => key + 1);
      setLocationReady(true);
    });

    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  return (
    <SafeAreaView style={styles.fill}>
      {locationReady ? <MapScreen key={screenKey} /> : null}
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
