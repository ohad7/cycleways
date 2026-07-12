import React, { useState } from "react";
import Breadcrumbs from "./Breadcrumbs.jsx";
import TopBar from "./TopBar.jsx";
import SiteFooter from "./SiteFooter.jsx";
import { isAppEmbedded } from "../appEmbed.js";

// When embedded in the native app's WebView, drop the site chrome (top nav +
// breadcrumbs) so only the page content shows — the app provides its own back
// button and navigation. See appEmbed.js for the embed contract.
export default function PageShell({
  breadcrumbs,
  children,
  navLinks,
  showFooter = true,
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (isAppEmbedded()) {
    return (
      <div id="main-content" className="main-container react-main-container app-embed" tabIndex={-1}>
        {children}
      </div>
    );
  }

  return (
    <>
      <a className="skip-link" href="#main-content">דלג לתוכן הראשי</a>
      <TopBar
        mobileMenuOpen={mobileMenuOpen}
        onMobileMenuToggle={() => setMobileMenuOpen((v) => !v)}
        navLinks={navLinks}
      />
      <div id="main-content" className="main-container react-main-container" tabIndex={-1}>
        <Breadcrumbs items={breadcrumbs} />
        {children}
      </div>
      {showFooter ? <SiteFooter /> : null}
    </>
  );
}
