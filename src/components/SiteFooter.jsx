import React from "react";
import SiteLegalLinks from "./SiteLegalLinks.jsx";

export default function SiteFooter() {
  return (
    <footer>
      <div className="footer-content">
        <p>&copy; 2025–2026 CycleWays.app - מפת שבילי אופניים.</p>
        <p>מיזם פרטי המופעל בידי אדם יחיד למען קהילת רוכבי האופניים בישראל</p>
        <SiteLegalLinks />
      </div>
    </footer>
  );
}
