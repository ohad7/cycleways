import { useEffect, useState } from "react";
import { loadCatalog, loadPlaces } from "@cycleways/core/data/catalog.js";

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
        const placesData = await loadPlaces();
        if (!cancelled) setPlaces(placesData);
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
