import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./welcome-wizard.css";
import { loadCatalog } from "../data/catalog.js";
import WelcomeDiscover from "./WelcomeDiscover.jsx";

const SKIP_FLAG_KEY = "cycleways:skipWelcome";

export default function WelcomeWizard({ visible, onDismiss }) {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState(null);
  const [places, setPlaces] = useState([]);
  const [zones, setZones] = useState([]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const c = await loadCatalog();
      if (cancelled) return;
      setCatalog(c);
      try {
        const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
        const [pRes, zRes] = await Promise.all([
          fetch(`${base}data/places.json`),
          fetch(`${base}data/region-zones.json`),
        ]);
        if (pRes.ok && !cancelled) setPlaces((await pRes.json())?.places || []);
        if (zRes.ok && !cancelled) setZones((await zRes.json())?.zones || []);
      } catch (err) {
        console.warn("places/zones load failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  if (!visible) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(SKIP_FLAG_KEY, "1");
    } catch {}
    onDismiss?.();
  };

  const selectRoute = (entry) => {
    try {
      localStorage.setItem(SKIP_FLAG_KEY, "1");
    } catch {}
    onDismiss?.();
    navigate(`/?route=${encodeURIComponent(entry.route)}`);
  };

  return (
    <div className="ww-overlay" role="dialog" aria-modal="true" onClick={(e) => {
      if (e.target === e.currentTarget) dismiss();
    }}>
      <div className="ww-overlay__panel" onClick={(e) => e.stopPropagation()}>
        <header className="ww-overlay__header">
          <h1>מצא מסלול</h1>
          <button
            type="button"
            className="ww-overlay__dismiss"
            onClick={dismiss}
            aria-label="סגור וחזור למפה"
          >
            דלג למפה ✕
          </button>
        </header>
        <WelcomeDiscover
          catalog={catalog}
          places={places}
          zones={zones}
          onSelectRoute={selectRoute}
        />
      </div>
    </div>
  );
}

export const WELCOME_WIZARD_SKIP_FLAG = SKIP_FLAG_KEY;
