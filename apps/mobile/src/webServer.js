import StaticServer, {
  resolveAssetsPath,
} from "@dr.pogodin/react-native-static-server";

// Starts (once) a local HTTP server serving the bundled web build (the `webroot`
// folder shipped by scripts/sync-web-bundle.mjs), so the route-detail WebView
// loads the real site — HTML/JS/CSS/data/images — fully offline. Only map tiles
// and the YouTube video need the network. Returns the origin
// (e.g. "http://localhost:PORT"); cached so repeated calls reuse the server.
let serverPromise = null;

export function startWebServer() {
  if (!serverPromise) {
    serverPromise = (async () => {
      const server = new StaticServer({
        fileDir: resolveAssetsPath("webroot"),
        // Keep serving while the app is foregrounded across detail visits.
        stopInBackground: false,
      });
      return server.start(); // resolves to the origin URL
    })().catch((error) => {
      // Allow a retry on the next call (and let the caller fall back to the
      // production site).
      serverPromise = null;
      throw error;
    });
  }
  return serverPromise;
}
