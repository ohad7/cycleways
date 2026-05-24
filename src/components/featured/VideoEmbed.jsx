import React, { useEffect, useState } from "react";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

let indexPromise = null;

function loadVideoIndex() {
  if (!indexPromise) {
    const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
    indexPromise = fetch(`${base}public-data/route-videos/index.json`)
      .then((r) => (r.ok ? r.json() : { routes: {} }))
      .catch(() => ({ routes: {} }));
  }
  return indexPromise;
}

async function loadKeyframes(filename) {
  const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
  const response = await fetch(`${base}public-data/route-videos/${filename}`);
  if (!response.ok) throw new Error(`keyframes ${filename}: HTTP ${response.status}`);
  return response.json();
}

export default function VideoEmbed() {
  const { meta } = useFeaturedRoute();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const index = await loadVideoIndex();
        const filename = index?.routes?.[meta.slug];
        if (!filename) {
          if (!cancelled) setStatus("absent");
          return;
        }
        const payload = await loadKeyframes(filename);
        if (cancelled) return;
        setData(payload);
        setStatus("ready");
      } catch (err) {
        console.warn("VideoEmbed failed to load", err);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meta.slug]);

  if (status !== "ready" || !data) return null;
  return (
    <section className="featured-video">
      <h2>סרטון</h2>
      <div className="featured-video-frame">
        <div data-testid="video-placeholder">{data.youtubeId}</div>
      </div>
    </section>
  );
}
