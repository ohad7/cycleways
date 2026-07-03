import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { loadFeaturedRouteSnapshot } from "@cycleways/core/data/featuredRouteSnapshots.js";
import { executeDownloadGPX } from "@cycleways/core/platform/download.js";
import { resetNativeLocationHref } from "@cycleways/core/platform/location.native.js";
import { generateGPX } from "@cycleways/core/utils/gpx-generator.js";
import RouteDetailWeb from "./RouteDetailWeb.jsx";
import RouteDetailNative from "./RouteDetailNative.jsx";

// Route detail = the real mobile-web page in a WebView (exactly the web's rich
// synced-video experience). Falls back to the native shell (bundled snapshot:
// map, POIs, elevation) when the web page can't load — e.g. offline.
export default function RouteDetailScreen({ navigation, route }) {
  const slug = route?.params?.slug ?? null;
  const openId = route?.params?.openId ?? "initial";
  const [webFailed, setWebFailed] = useState(false);
  const [webGestureLocked, setWebGestureLocked] = useState(false);

  useEffect(() => {
    setWebFailed(false);
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

  if (!slug || webFailed) {
    return <RouteDetailNative navigation={navigation} route={route} />;
  }

  return (
    <RouteDetailWeb
      slug={slug}
      openId={openId}
      onBack={() => navigation.goBack()}
      onDownload={downloadGpx}
      onOpenEditor={openEditor}
      onNavigate={startNavigation}
      onError={() => setWebFailed(true)}
      onGestureLockChange={setWebGestureLocked}
    />
  );
}
