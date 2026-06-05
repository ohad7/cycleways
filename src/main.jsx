import React, { Component, Suspense, lazy, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import "./route-boundary.css";

// Each page is a lazy chunk so a route only downloads the code it needs. In
// particular this keeps the planner (App) and its routing engine (RouteManager,
// base-routing decode) out of the entry bundle, so public featured-route pages
// no longer download or parse planner-only code.
const App = lazyRoute("App", () => import("./App.jsx"));
const FeaturedRoutePage = lazyRoute("FeaturedRoutePage", () => import("./pages/FeaturedRoutePage.jsx"));
const RoutesIndexPage = lazyRoute("RoutesIndexPage", () => import("./pages/RoutesIndexPage.jsx"));
const RouteDetailPage = lazyRoute("RouteDetailPage", () => import("./pages/RouteDetailPage.jsx"));

// Splash milestone: the main bundle has parsed and is executing.
window.__splash?.set(0.75);

// Dismiss the splash only once the matched route's chunk has loaded and
// mounted, handing off to that page's own loading state. The splash lives
// outside #root and the Suspense fallback below is `null`, so the splash stays
// visible (no blank flash) while the route chunk is fetched.
function RouteReady({ children }) {
  useEffect(() => {
    window.__splash?.done();
  }, []);
  return children;
}

function lazyRoute(name, importer) {
  return lazy(() =>
    importer()
      .then((module) => {
        clearRouteChunkReloadGuard(name);
        return module;
      })
      .catch((error) => {
        if (isRecoverableRouteImportError(error) && reloadRouteChunkOnce(name)) {
          return new Promise(() => {});
        }
        throw error;
      }),
  );
}

function isRecoverableRouteImportError(error) {
  const message = String(error?.message || error || "");
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("Loading chunk") ||
    message.includes("ChunkLoadError")
  );
}

function reloadRouteChunkOnce(name) {
  const key = routeChunkReloadKey(name);
  try {
    if (window.sessionStorage.getItem(key) === "1") return false;
    window.sessionStorage.setItem(key, "1");
  } catch {
    // Session storage is only a guard; reloading once is still safer than a blank route.
  }
  window.location.reload();
  return true;
}

function clearRouteChunkReloadGuard(name) {
  try {
    window.sessionStorage.removeItem(routeChunkReloadKey(name));
  } catch {
    // Optional recovery guard.
  }
}

function routeChunkReloadKey(name) {
  return `isravelo:route-import-reload:${name}`;
}

function RouteLoadingFallback() {
  return (
    <div className="route-boundary route-boundary--loading" role="status" aria-live="polite">
      <span className="route-boundary__spinner" aria-hidden="true" />
      <span>טוען עמוד…</span>
    </div>
  );
}

class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Route render failed", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="route-boundary route-boundary--error" role="alert">
          <h1>העמוד לא נטען</h1>
          <p>אירעה שגיאה בטעינת העמוד. רענון בדרך כלל פותר מעבר שנכשל.</p>
          <div className="route-boundary__actions">
            <button type="button" onClick={() => window.location.reload()}>
              רענון
            </button>
            <a href="/">חזרה למפה</a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function RouteBoundary({ children }) {
  const location = useLocation();
  const boundaryKey = location.key || `${location.pathname}${location.search}`;
  return <RouteErrorBoundary key={boundaryKey}>{children}</RouteErrorBoundary>;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <RouteBoundary>
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route
              path="/routes"
              element={
                <RouteReady>
                  <RoutesIndexPage />
                </RouteReady>
              }
            />
            <Route
              path="/routes/:slug"
              element={
                <RouteReady>
                  <RouteDetailPage />
                </RouteReady>
              }
            />
            <Route
              path="/featured"
              element={
                <RouteReady>
                  <RoutesIndexPage />
                </RouteReady>
              }
            />
            <Route
              path="/featured/:slug"
              element={
                <RouteReady>
                  <FeaturedRoutePage />
                </RouteReady>
              }
            />
            <Route
              path="*"
              element={
                <RouteReady>
                  <App />
                </RouteReady>
              }
            />
          </Routes>
        </Suspense>
      </RouteBoundary>
    </BrowserRouter>
  </React.StrictMode>,
);
