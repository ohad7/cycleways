import React, { useCallback } from "react";
import { generateGPX } from "@cycleways/core/utils/gpx-generator.js";
import { executeDownloadGPX } from "@cycleways/core/platform/download.js";
import Icon from "../Icon.jsx";
import FeaturedRoute from "./FeaturedRoute.jsx";
import FeaturedRouteStats from "./FeaturedRouteStats.jsx";
import FeaturedElevation from "./FeaturedElevation.jsx";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

// Shared video-first featured-route template. The video player, maps, POI
// preview, progress readout, and POI story list are identical across routes;
// only the editorial copy differs and comes in via the `intro`/`about` props.
//
//   intro: { kicker?, heading?, body?: string[] }   - side "what's on the ride" panel
//   about: { eyebrow?, heading?, paragraphs?: string[] } - below-the-fold "about" section
//   difficultyLabel / surfaceLabel - optional stat text overrides for the rail
export default function FeaturedVideoRoute({
  slug,
  kicker = null,
  intro = {},
  about = {},
  difficultyLabel = null,
  surfaceLabel = null,
}) {
  return (
    <FeaturedRoute slug={slug} layout="video-first" desktopMap="manual" kicker={kicker}>
      <section className="fv-playback" aria-label="סרטון, תיאור ומפת המסלול">
        <div className="fv-video-stage">
          <div className="fv-video-shell">
            <FeaturedRoute.Video title="" className="fv-video" />
            <FeaturedRoute.POIVideoPreview />
            <FeaturedRoute.Map
              className="fv-mobile-map"
              autoResetAfterInteraction
              autoResetDelayMs={5000}
              routeFitPadding={12}
            />
          </div>
        </div>

        <aside className="fv-side-rail" aria-label="תיאור ומפת המסלול">
          <section className="fv-route-panel" aria-label="תקציר המסלול">
            {intro.kicker && <span className="fv-route-panel-kicker">{intro.kicker}</span>}
            {intro.heading && <h2>{intro.heading}</h2>}
            {(intro.body || []).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
            <FeaturedRouteActions />
          </section>

          <div className="fv-side-elevation-wrap">
            <FeaturedRouteStats
              difficultyLabel={difficultyLabel}
              surfaceLabel={surfaceLabel}
            />
            <FeaturedElevation />
          </div>
        </aside>
      </section>

      <section id="fv-about" className="fv-route-about" aria-label="על המסלול">
        <div className="fv-route-about-heading">
          {about.eyebrow && <span>{about.eyebrow}</span>}
          {about.heading && <h2>{about.heading}</h2>}
        </div>
        <div className="fv-route-about-body">
          {(about.paragraphs || []).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      </section>

      <FeaturedRoute.POIStories />
    </FeaturedRoute>
  );
}

function FeaturedRouteActions() {
  const { meta, routeState, playerPlayRef } = useFeaturedRoute();
  const hasRouteGeometry = routeState.geometry.length >= 2;
  const editHref = meta?.route ? `/?route=${encodeURIComponent(meta.route)}` : null;

  const handleDownload = useCallback(() => {
    if (!hasRouteGeometry) return;
    const filename = meta?.slug ? `${meta.slug}.gpx` : "featured_route.gpx";
    executeDownloadGPX(generateGPX(routeState.geometry), filename);
  }, [hasRouteGeometry, meta?.slug, routeState.geometry]);

  const handlePlayRoute = useCallback(() => {
    playerPlayRef.current?.();
    const isMobile = window.matchMedia?.("(max-width: 767px)").matches
      ?? window.innerWidth < 768;
    if (!isMobile) return;

    const target = document.querySelector(".fv-video-shell");
    if (!target) return;
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [playerPlayRef]);

  return (
    <div className="fv-route-actions" aria-label="פעולות מסלול">
      <button
        type="button"
        className="fv-route-action fv-route-action--primary"
        onClick={handlePlayRoute}
        aria-label="נגן מסלול"
      >
        <Icon name="play-circle-outline" />
        <span className="fv-route-action-label">נגן מסלול</span>
      </button>
      {editHref ? (
        <a
          className="fv-route-action"
          href={editHref}
          target="_blank"
          rel="noreferrer"
          aria-label="פתח לעריכה"
        >
          <Icon name="create-outline" />
          <span className="fv-route-action-label">פתח לעריכה</span>
        </a>
      ) : (
        <button
          type="button"
          className="fv-route-action"
          disabled
          aria-label="פתח לעריכה"
        >
          <Icon name="create-outline" />
          <span className="fv-route-action-label">פתח לעריכה</span>
        </button>
      )}
      <button
        type="button"
        className="fv-route-action"
        onClick={handleDownload}
        disabled={!hasRouteGeometry}
        aria-label="Download GPX - הורד קובץ ניווט"
      >
        <Icon name="download-outline" />
        <span className="fv-route-action-label">הורד קובץ ניווט</span>
      </button>
    </div>
  );
}
