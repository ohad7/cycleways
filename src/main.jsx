import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import FeaturedIndexPage from "./pages/FeaturedIndexPage.jsx";
import FeaturedRoutePage from "./pages/FeaturedRoutePage.jsx";

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
