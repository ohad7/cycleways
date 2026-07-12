import { useCallback, useEffect, useRef, useState } from "react";
import { text } from "../theme/typography.js";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import BackButton from "./BackButton.jsx";
import { restartWebServer, startWebServer } from "../webServer.js";
import { palette } from "../planner/theme.js";

// Renders the real mobile-web route page (`/routes/<slug>?app=1`, chrome hidden)
// inside a WebView so the rich synced-video experience is exactly the web's.
// Injects the app-embed config (window.__CW_EMBED__) and bridges the page's
// app actions (Navigate / open-to-edit, posted via window.ReactNativeWebView)
// back to native. `baseUrl` lets tests/dev harnesses point at a custom local
// server, but production always uses the bundled static server.
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
  const [loadError, setLoadError] = useState(null);
  const [webViewRevision, setWebViewRevision] = useState(0);
  const readyFallbackRef = useRef(null);
  const retryingRef = useRef(false);
  const autoRetriedRef = useRef(false);
  // Prefer the bundled local static server (fully offline). An explicit baseUrl
  // prop overrides it for tests/dev harnesses only.
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
    setLoadError(null);
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
    setLoadError(null);
    autoRetriedRef.current = false;
    onGestureLockChange?.(false);
  }, [clearReadyFallback, onGestureLockChange, openId, slug]);

  useEffect(() => {
    if (baseUrl) {
      setResolvedBase(baseUrl);
      return undefined;
    }
    let mounted = true;
    startWebServer()
      .then((origin) => mounted && setResolvedBase(origin))
      .catch((error) => {
        if (!mounted) return;
        setLoadError(error);
        onError?.(error);
      });
    return () => {
      mounted = false;
    };
  }, [baseUrl, onError, openId, slug]);

  const retryLocalServer = useCallback(async () => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    clearReadyFallback();
    setLoading(true);
    setLoadError(null);
    onGestureLockChange?.(false);
    try {
      const origin = baseUrl ? baseUrl : await restartWebServer();
      setResolvedBase(origin);
      setWebViewRevision((revision) => revision + 1);
    } catch (error) {
      setLoadError(error);
      onError?.(error);
    } finally {
      retryingRef.current = false;
    }
  }, [baseUrl, clearReadyFallback, onError, onGestureLockChange]);

  const handlePageLoadFailure = useCallback(
    (error) => {
      if (!baseUrl && !autoRetriedRef.current) {
        autoRetriedRef.current = true;
        void retryLocalServer();
        return;
      }
      clearReadyFallback();
      setLoading(false);
      const nextError =
        error instanceof Error ? error : new Error("Route WebView failed to load");
      setLoadError(nextError);
      onError?.(nextError);
    },
    [baseUrl, clearReadyFallback, onError, retryLocalServer],
  );

  if (!resolvedBase && !loadError) {
    return (
      <View style={[styles.fill, styles.loading]}>
        <ActivityIndicator size="large" color={palette.forest} />
        <BackButton onPress={onBack} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.fill, styles.error, { paddingTop: insets.top }]}>
        <BackButton onPress={onBack} />
        <View style={styles.errorPanel}>
          <Text style={styles.errorTitle}>לא הצלחנו לטעון את סיפור המסלול.</Text>
          <Text style={styles.errorBody}>
            אפשר לנסות להפעיל מחדש את עמוד המסלול המקומי.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="נסה שוב"
            onPress={retryLocalServer}
            style={({ pressed }) => [
              styles.retryButton,
              pressed ? styles.retryButtonPressed : null,
            ]}
          >
            <Text style={styles.retryText}>נסה שוב</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const uri = `${resolvedBase}/routes/${encodeURIComponent(slug)}?app=1`;
  const webViewKey = `${slug}:${resolvedBase}:${openId ?? "initial"}:${webViewRevision}`;

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
        onError={(e) => handlePageLoadFailure(e?.nativeEvent)}
        onHttpError={(e) => {
          // Only treat hard failures (the page itself 4xx/5xx) as fatal; ignore
          // sub-resource errors.
          const ev = e?.nativeEvent;
          if (ev?.url === uri && ev?.statusCode >= 400) handlePageLoadFailure(ev);
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
  error: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  errorPanel: {
    alignItems: "center",
    gap: 12,
    maxWidth: 360,
  },
  errorTitle: {
    ...text.subheading,
    color: palette.ink,
    textAlign: "center",
    writingDirection: "rtl",
  },
  errorBody: {
    ...text.body,
    color: palette.muted,
    textAlign: "center",
    writingDirection: "rtl",
  },
  retryButton: {
    backgroundColor: palette.forest,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryButtonPressed: {
    opacity: 0.82,
  },
  retryText: {
    ...text.bodyStrong,
    color: "#fff",
    writingDirection: "rtl",
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});
