import StaticServer, {
  resolveAssetsPath,
  STATES,
} from "@dr.pogodin/react-native-static-server";

// Starts (once) a local HTTP server serving the bundled web build (the `webroot`
// folder shipped by scripts/sync-web-bundle.mjs), so the route-detail WebView
// loads the real site — HTML/JS/CSS/data/images — fully offline. Only map tiles
// and the YouTube video need the network. Returns the origin
// (e.g. "http://localhost:PORT"); cached so repeated calls reuse the server.
let server = null;
let serverPromise = null;

function createServer() {
  const nextServer = new StaticServer({
    fileDir: resolveAssetsPath("webroot"),
    // Keep serving while the app is foregrounded across detail visits.
    stopInBackground: false,
  });
  nextServer.addStateListener((state) => {
    if (state === STATES.CRASHED && server === nextServer) {
      serverPromise = null;
    }
  });
  return nextServer;
}

export function startWebServer() {
  if (server?.state === STATES.CRASHED) {
    serverPromise = null;
  }
  if (!server) {
    server = createServer();
  }
  if (!serverPromise) {
    serverPromise = server.start().catch((error) => {
      // Allow a retry on the next call.
      server = null;
      serverPromise = null;
      throw error;
    });
  }
  return serverPromise;
}

export async function restartWebServer() {
  const currentServer = server;
  server = null;
  serverPromise = null;

  if (currentServer) {
    try {
      await currentServer.stop("Restarting featured route web server");
    } catch {
      // A crashed native server can fail to stop; starting a fresh JS wrapper
      // still gives the route WebView its best recovery path.
    }
  }

  return startWebServer();
}
