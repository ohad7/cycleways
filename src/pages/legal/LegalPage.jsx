import React, { useEffect } from "react";
import PageShell from "../../components/PageShell.jsx";
import "./legal.css";

// Shared shell for the public legal/support pages (/privacy, /terms,
// /support): site chrome via PageShell, RTL article layout, document title.
export default function LegalPage({ title, updated, children }) {
  useEffect(() => {
    document.title = `${title} — CycleWays`;
  }, [title]);

  return (
    <PageShell breadcrumbs={[{ label: "ראשי", to: "/" }, { label: title }] }>
      <article className="legal-page">
        <h1>{title}</h1>
        {updated ? <p className="legal-page__updated">עדכון אחרון: {updated}</p> : null}
        {children}
      </article>
    </PageShell>
  );
}
