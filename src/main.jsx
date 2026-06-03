import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import FeaturedIndexPage from "./pages/FeaturedIndexPage.jsx";
import FeaturedRoutePage from "./pages/FeaturedRoutePage.jsx";

// Splash milestone: the main bundle has parsed and is executing.
window.__splash?.set(0.75);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/featured" element={<FeaturedIndexPage />} />
        <Route path="/featured/:slug" element={<FeaturedRoutePage />} />
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);

// Splash milestone: React has mounted. Remove the splash on the next frame
// (after React has painted), handing off to the in-app loading spinner.
requestAnimationFrame(() => {
  requestAnimationFrame(() => window.__splash?.done());
});
