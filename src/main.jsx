import React, { Suspense, lazy, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

// Each page is a lazy chunk so a route only downloads the code it needs. In
// particular this keeps the planner (App) and its routing engine (RouteManager,
// base-routing decode) out of the entry bundle, so public featured-route pages
// no longer download or parse planner-only code.
const App = lazy(() => import("./App.jsx"));
const FeaturedIndexPage = lazy(() => import("./pages/FeaturedIndexPage.jsx"));
const FeaturedRoutePage = lazy(() => import("./pages/FeaturedRoutePage.jsx"));

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

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route
            path="/featured"
            element={
              <RouteReady>
                <FeaturedIndexPage />
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
    </BrowserRouter>
  </React.StrictMode>,
);
