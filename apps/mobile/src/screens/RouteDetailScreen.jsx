import { useState } from "react";
import { resetNativeLocationHref } from "@cycleways/core/platform/location.native.js";
import RouteDetailWeb from "./RouteDetailWeb.jsx";
import RouteDetailNative from "./RouteDetailNative.jsx";

// Route detail = the real mobile-web page in a WebView (exactly the web's rich
// synced-video experience). Falls back to the native shell (bundled snapshot:
// map, POIs, elevation) when the web page can't load — e.g. offline.
export default function RouteDetailScreen({ navigation, route }) {
  const slug = route?.params?.slug ?? null;
  const [webFailed, setWebFailed] = useState(false);

  const openEditor = (token) => {
    if (!token) return;
    resetNativeLocationHref();
    navigation.navigate("Build", { routeToken: token, slug, name: null });
  };

  if (!slug || webFailed) {
    return <RouteDetailNative navigation={navigation} route={route} />;
  }

  return (
    <RouteDetailWeb
      slug={slug}
      onBack={() => navigation.goBack()}
      onOpenEditor={openEditor}
      onError={() => setWebFailed(true)}
    />
  );
}
