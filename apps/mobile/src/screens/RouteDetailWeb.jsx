import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import BackButton from "./BackButton.jsx";
import { startWebServer } from "../webServer.js";
import { palette } from "../planner/theme.js";

// Renders the real mobile-web route page (`/routes/<slug>?app=1`, chrome hidden)
// inside a WebView so the rich synced-video experience is exactly the web's.
// Injects the app-embed config (window.__CW_EMBED__) and bridges the page's
// app actions (Navigate / open-to-edit, posted via window.ReactNativeWebView)
// back to native. `baseUrl` lets a caller point at a local static server later;
// it defaults to production.
const DEFAULT_SITE = "https://www.cycleways.app";
const READY_FALLBACK_MS = 2000;

// Runs before the page scripts: declares this is an app embed + which actions to
// show. The web reads this via appEmbed.js (appEmbedConfig).
const EMBED_BOOTSTRAP = `
  window.__CW_EMBED__ = { app: true, showNavigate: true, showEdit: true };
  true;
`;

function editTokenFromUrl(url, base) {
  try {
    const u = new URL(url, base);
    const token = u.searchParams.get("route");
    // The web "פתח לעריכה" CTA (non-embedded fallback) links to /?route=<token>.
    if (token && (u.pathname === "/" || u.pathname === "")) return token;
  } catch {
    // not a parseable url — let the WebView handle it
  }
  return null;
}

export default function RouteDetailWeb({
  slug,
  openId,
  baseUrl,
  onBack,
  onDownload,
  onOpenEditor,
  onNavigate,
  onError,
  onGestureLockChange,
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const readyFallbackRef = useRef(null);
  // Prefer the bundled local static server (fully offline); fall back to the
  // production site if it can't start. An explicit baseUrl prop overrides both.
  const [resolvedBase, setResolvedBase] = useState(baseUrl || null);

  const clearReadyFallback = useCallback(() => {
    if (readyFallbackRef.current) {
      clearTimeout(readyFallbackRef.current);
      readyFallbackRef.current = null;
    }
  }, []);

  const finishLoading = useCallback(() => {
    clearReadyFallback();
    setLoading(false);
  }, [clearReadyFallback]);

  useEffect(() => clearReadyFallback, [clearReadyFallback]);

  useEffect(
    () => () => {
      onGestureLockChange?.(false);
    },
    [onGestureLockChange],
  );

  useEffect(() => {
    clearReadyFallback();
    setLoading(true);
    onGestureLockChange?.(false);
  }, [clearReadyFallback, onGestureLockChange, openId, resolvedBase, slug]);

  useEffect(() => {
    if (baseUrl) return undefined;
    let mounted = true;
    startWebServer()
      .then((origin) => mounted && setResolvedBase(origin))
      .catch(() => mounted && setResolvedBase(DEFAULT_SITE));
    return () => {
      mounted = false;
    };
  }, [baseUrl]);

  if (!resolvedBase) {
    return (
      <View style={[styles.fill, styles.loading]}>
        <ActivityIndicator size="large" color={palette.forest} />
        <BackButton onPress={onBack} />
      </View>
    );
  }

  const uri = `${resolvedBase}/routes/${encodeURIComponent(slug)}?app=1`;
  const webViewKey = `${slug}:${resolvedBase}:${openId ?? "initial"}`;

  const handleMessage = (event) => {
    let msg = null;
    try {
      msg = JSON.parse(event?.nativeEvent?.data || "{}");
    } catch {
      return;
    }
    const token = msg?.route || null;
    if (msg?.type === "ready") finishLoading();
    else if (msg?.type === "gesture-lock") {
      onGestureLockChange?.(Boolean(msg?.locked));
    }
    else if (msg?.type === "navigate") onNavigate?.(token, msg?.slug);
    else if (msg?.type === "edit") onOpenEditor?.(token, msg?.slug);
    else if (msg?.type === "download") onDownload?.(msg?.slug);
    else if (msg?.type === "back") onBack?.();
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <WebView
        key={webViewKey}
        source={{ uri }}
        injectedJavaScriptBeforeContentLoaded={EMBED_BOOTSTRAP}
        onMessage={handleMessage}
        onLoadEnd={() => {
          // The explicit bridge event normally wins. This bounded fallback
          // prevents a web regression from trapping the user behind the loader.
          clearReadyFallback();
          readyFallbackRef.current = setTimeout(finishLoading, READY_FALLBACK_MS);
        }}
        onError={() => onError?.()}
        onHttpError={(e) => {
          // Only treat hard failures (the page itself 4xx/5xx) as fatal; ignore
          // sub-resource errors.
          const ev = e?.nativeEvent;
          if (ev?.url === uri && ev?.statusCode >= 400) onError?.();
        }}
        onShouldStartLoadWithRequest={(req) => {
          // Fallback for the non-embedded edit link; embedded uses postMessage.
          const token = editTokenFromUrl(req.url, resolvedBase);
          if (token) {
            onOpenEditor?.(token);
            return false;
          }
          return true;
        }}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
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
