// App-embed contract — the single control surface for "this page is running
// inside the native app's WebView". The app opens the page with ?app=1 and
// injects a config object (window.__CW_EMBED__) before load. Web components use
// these helpers to hide site chrome, toggle features, and render app-specific
// actions (e.g. a Navigate button) that message the native app.

export function isAppEmbedded() {
  if (typeof window === "undefined") return false;
  if (window.__CW_EMBED__) return true;
  try {
    return new URLSearchParams(window.location.search).get("app") === "1";
  } catch {
    return false;
  }
}

// Feature flags / data the app injected. Defaults are app-friendly so the page
// is usable even if the app injected nothing (just ?app=1).
export function appEmbedConfig() {
  const injected =
    typeof window !== "undefined" && window.__CW_EMBED__
      ? window.__CW_EMBED__
      : {};
  return {
    showNavigate: true,
    showEdit: true,
    ...injected,
  };
}

// Send a message to the native host. Returns true if the bridge was available.
export function postToApp(message) {
  try {
    if (typeof window !== "undefined" && window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
      return true;
    }
  } catch {
    // bridge not present (plain web) — caller falls back to normal web behavior
  }
  return false;
}
