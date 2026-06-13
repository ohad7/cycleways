import React, { useState } from "react";
import Breadcrumbs from "./Breadcrumbs.jsx";
import TopBar from "./TopBar.jsx";

export default function PageShell({
  breadcrumbs,
  children,
  navLinks,
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
