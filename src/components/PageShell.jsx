import React, { useState } from "react";
import Breadcrumbs from "./Breadcrumbs.jsx";
import TopBar from "./TopBar.jsx";
import { isAppEmbedded } from "../appEmbed.js";

// When embedded in the native app's WebView, drop the site chrome (top nav +
// breadcrumbs) so only the page content shows — the app provides its own back
// button and navigation. See appEmbed.js for the embed contract.
export default function PageShell({
  breadcrumbs,
  children,
  navLinks,
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (isAppEmbedded()) {
    return (
      <div className="main-container react-main-container app-embed">
        {children}
      </div>
    );
  }

  return (
    <>
      <TopBar
        mobileMenuOpen={mobileMenuOpen}
        onMobileMenuToggle={() => setMobileMenuOpen((v) => !v)}
        navLinks={navLinks}
      />
      <div className="main-container react-main-container">
        <Breadcrumbs items={breadcrumbs} />
        {children}
      </div>
    </>
  );
}
