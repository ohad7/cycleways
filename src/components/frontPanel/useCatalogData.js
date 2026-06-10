import { useEffect, useState } from "react";
import { loadCatalog } from "@cycleways/core/data/catalog.js";

export function useCatalogData() {
  const [catalog, setCatalog] = useState(null);
  const [places, setPlaces] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await loadCatalog();
      if (cancelled) return;
      setCatalog(c);
      try {
        const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
        const pRes = await fetch(`${base}data/places.json`);
        if (pRes.ok && !cancelled) setPlaces((await pRes.json())?.places || []);
      } catch (err) {
        console.warn("places load failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { catalog, places };
}
