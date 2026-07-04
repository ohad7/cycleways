import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { loadFeaturedRouteSnapshot } from "@cycleways/core/data/featuredRouteSnapshots.js";
import { executeDownloadGPX } from "@cycleways/core/platform/download.js";
import { resetNativeLocationHref } from "@cycleways/core/platform/location.native.js";
import { generateGPX } from "@cycleways/core/utils/gpx-generator.js";
import RouteDetailWeb from "./RouteDetailWeb.jsx";
import BackButton from "./BackButton.jsx";
import { palette } from "../planner/theme.js";

// Route detail = the real mobile-web page in a WebView (exactly the web's rich
// synced-video experience). When it can't load, RouteDetailWeb retries the
// bundled local server and then shows an explicit error state.
export default function RouteDetailScreen({ navigation, route }) {
  const slug = route?.params?.slug ?? null;
  const openId = route?.params?.openId ?? "initial";
  const [webGestureLocked, setWebGestureLocked] = useState(false);

  useEffect(() => {
    setWebGestureLocked(false);
  }, [slug, openId]);

  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !webGestureLocked });
    return () => {
      navigation.setOptions({ gestureEnabled: true });
    };
  }, [navigation, webGestureLocked]);

  const openInBuild = (token, { openRideSetup = false } = {}) => {
    if (!token) return;
    resetNativeLocationHref();
    navigation.navigate("Build", {
      routeToken: token,
      slug,
      name: null,
      openRideSetup,
    });
  };

  const openEditor = (token) => openInBuild(token);
  const startNavigation = (token) =>
    openInBuild(token, { openRideSetup: true });
  const handleWebError = useCallback((error) => {
    console.warn("Featured route web load failed:", error);
  }, []);
  const downloadGpx = async () => {
    if (!slug) return;
    try {
      const snapshot = await loadFeaturedRouteSnapshot(slug);
      const geometry = snapshot?.route?.geometry;
      if (!Array.isArray(geometry) || geometry.length < 2) {
        throw new Error("featured route has no downloadable geometry");
      }
      const shared = await executeDownloadGPX(generateGPX(geometry), `${slug}.gpx`);
      if (shared === false) {
        Alert.alert("הקובץ לא נשמר", "לא הצלחנו לפתוח את אפשרויות השיתוף של קובץ ה-GPX.");
      }
    } catch (error) {
      console.warn("Featured route GPX share failed:", error);
      Alert.alert("הקובץ לא נשמר", "לא הצלחנו להכין את קובץ ה-GPX. אפשר לנסות שוב.");
    }
  };

  if (!slug) {
    return <MissingRouteDetail onBack={() => navigation.goBack()} />;
  }

  return (
    <RouteDetailWeb
      slug={slug}
      openId={openId}
      onBack={() => navigation.goBack()}
      onDownload={downloadGpx}
      onOpenEditor={openEditor}
      onNavigate={startNavigation}
      onError={handleWebError}
      onGestureLockChange={setWebGestureLocked}
    />
  );
}

function MissingRouteDetail({ onBack }) {
  return (
    <View style={[styles.fill, styles.center]}>
      <BackButton onPress={onBack} />
      <Text style={styles.errorText}>לא נמצא מסלול לפתיחה.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.paper },
  center: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  errorText: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
    writingDirection: "rtl",
  },
});
