import React from "react";
import { Link } from "react-router-dom";

const LINKS = [
  ["/privacy", "מדיניות פרטיות"],
  ["/terms", "תנאי שימוש"],
  ["/accessibility", "נגישות"],
  ["/support", "תמיכה"],
];

export default function SiteLegalLinks({ compact = false }) {
  return (
    <nav
      className={`site-legal-links${compact ? " site-legal-links--compact" : ""}`}
      aria-label="מידע משפטי ותמיכה"
    >
      {LINKS.map(([to, label], index) => (
        <React.Fragment key={to}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}
          <Link to={to}>{label}</Link>
        </React.Fragment>
      ))}
    </nav>
  );
}
