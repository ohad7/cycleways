import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import BackButton from "./BackButton.jsx";
import { palette } from "../planner/theme.js";

// Renders the real mobile-web route page (`/routes/<slug>?app=1`, chrome hidden)
// inside a WebView so the rich synced-video experience is exactly the web's.
// The native app overlays its own back button and bridges the page's "open to
// edit" link (/?route=<token>) back into the native Build screen.
const SITE = "https://www.cycleways.app";

function editTokenFromUrl(url) {
  try {
    const u = new URL(url, SITE);
    const token = u.searchParams.get("route");
    // The web "פתח לעריכה" CTA links to /?route=<token>.
    if (token && (u.pathname === "/" || u.pathname === "")) return token;
  } catch {
    // not a parseable url — let the WebView handle it
  }
  return null;
}

export default function RouteDetailWeb({ slug, onBack, onOpenEditor, onError }) {
  const [loading, setLoading] = useState(true);
  const uri = `${SITE}/routes/${encodeURIComponent(slug)}?app=1`;

  return (
    <View style={styles.fill}>
      <WebView
        source={{ uri }}
        onLoadEnd={() => setLoading(false)}
        onError={() => onError?.()}
        onHttpError={(e) => {
          // Only treat hard failures (the page itself 4xx/5xx) as fatal; ignore
          // sub-resource errors.
          const ev = e?.nativeEvent;
          if (ev?.url === uri && ev?.statusCode >= 400) onError?.();
        }}
        onShouldStartLoadWithRequest={(req) => {
          const token = editTokenFromUrl(req.url);
          if (token) {
            onOpenEditor?.(token);
            return false;
          }
          return true;
        }}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        startInLoadingState
      />
      {loading ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator size="large" color={palette.forest} />
        </View>
      ) : null}
      <BackButton onPress={onBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.paper },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});
