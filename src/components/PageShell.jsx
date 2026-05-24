import React, { useState } from "react";
import TopBar from "./TopBar.jsx";

export default function PageShell({ children, onOpenTutorial, onOpenWizard }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  return (
    <>
      <TopBar
        mobileMenuOpen={mobileMenuOpen}
        onMobileMenuToggle={() => setMobileMenuOpen((v) => !v)}
        onOpenTutorial={onOpenTutorial}
        onOpenWizard={onOpenWizard}
      />
      <div className="main-container react-main-container">
        {children}
      </div>
    </>
  );
}
