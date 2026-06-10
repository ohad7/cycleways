import React, { useCallback } from "react";
import { generateGPX } from "@cycleways/core/utils/gpx-generator.js";
import { executeDownloadGPX } from "@cycleways/core/platform/download.js";
import Icon from "../Icon.jsx";
import RichText from "../RichText.jsx";
import FeaturedRoute from "./FeaturedRoute.jsx";
import FeaturedRouteStats from "./FeaturedRouteStats.jsx";
import FeaturedElevation from "./FeaturedElevation.jsx";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import {
  VIDEO_CURSOR_DEFAULT_VARIANT,
} from "@cycleways/core/map/mapStyles.js";

// Shared route-story template. Video-backed routes render a video player with a
// map overlay; catalog-only routes render the map in the same primary stage.
// The header, side rail, stats, elevation profile, and POI stories stay shared.
//
//   intro: { kicker?, heading?, body?: string[], bodyText?: string } - side panel ("bodyText" = rich text, preferred)
//   about: { eyebrow?, heading?, paragraphs?: string[], bodyText?: string } - below-the-fold "about" ("bodyText" = rich text, preferred)
//   difficultyLabel / surfaceLabel - optional stat text overrides for the rail
//   videoCursorVariant - 1-6 or a named cursor style for the video map marker
// Obstruction overlays the route fit should clear: the bottom control bar, the
// corner video PiP poster, and the transient POI preview. computeOverlayFitPadding
// only counts the ones actually overlapping the map, so this works in both the
// PiP (video-primary) and full (map-primary) layouts.
const FEATURED_VIDEO_FIT_OVERLAYS = [
  { selector: ".fv-video-controls", side: "bottom" },
  { selector: ".fv-video-poster" },
  { selector: ".fv-video-poi-preview" },
];

export default function FeaturedVideoRoute({
  slug,
  kicker = null,
  intro = {},
  about = {},
  difficultyLabel = null,
  surfaceLabel = null,
  media = "video",
  videoCursorVariant = VIDEO_CURSOR_DEFAULT_VARIANT,
}) {
  const isMapStage = media === "map";
  const aboutParagraphs = Array.isArray(about.paragraphs) ? about.paragraphs : [];
  const hasAbout = Boolean(about.eyebrow || about.heading || about.bodyText || aboutParagraphs.length > 0);

  return (
    <FeaturedRoute slug={slug} layout="video-first" desktopMap="manual" kicker={kicker}>
      <section
        className={[
          "fv-playback",
          isMapStage ? "fv-playback--map-stage" : "",
        ].filter(Boolean).join(" ")}
        aria-label={isMapStage ? "מפה, תיאור ונתוני המסלול" : "סרטון, תיאור ומפת המסלול"}
      >
        <div className="fv-video-stage">
          <div
            className={[
              "fv-video-shell",
              isMapStage ? "fv-video-shell--map" : "",
            ].filter(Boolean).join(" ")}
            data-route-stage
          >
            {isMapStage ? (
              <FeaturedRoute.MapPlayback
                autoResetAfterInteraction
                autoResetDelayMs={5000}
                videoCursorVariant={videoCursorVariant}
              />
            ) : (
              <>
                <FeaturedRoute.Video title="" className="fv-video" />
                <FeaturedRoute.POIVideoPreview />
                <FeaturedRoute.Map
                  className="fv-mobile-map"
                  autoResetAfterInteraction
                  autoResetDelayMs={5000}
                  routeFitPadding={12}
                  videoCursorVariant={videoCursorVariant}
                  fitOverlayRegistry={FEATURED_VIDEO_FIT_OVERLAYS}
                />
              </>
            )}
          </div>
        </div>

        <aside className="fv-side-rail" aria-label="תיאור ומפת המסלול">
          <section className="fv-route-panel" aria-label="תקציר המסלול">
            {intro.kicker && <span className="fv-route-panel-kicker">{intro.kicker}</span>}
            {intro.heading && <h2>{intro.heading}</h2>}
            {intro.bodyText ? (
              <RichText className="fv-route-narrative" text={intro.bodyText} />
            ) : (
              (intro.body || []).map((para, i) => (
                <p key={i}>{para}</p>
              ))
            )}
            <FeaturedRouteActions media={media} />
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

      {hasAbout && (
        <section id="fv-about" className="fv-route-about" aria-label="על המסלול">
          <div className="fv-route-about-heading">
            {about.eyebrow && <span>{about.eyebrow}</span>}
            {about.heading && <h2>{about.heading}</h2>}
          </div>
          <div className="fv-route-about-body">
            {about.bodyText ? (
              <RichText className="fv-route-narrative" text={about.bodyText} />
            ) : (
              aboutParagraphs.map((para, i) => (
                <p key={i}>{para}</p>
              ))
            )}
          </div>
        </section>
      )}

      <FeaturedRoute.POIStories />

      <FeaturedRoute.Warnings />
    </FeaturedRoute>
  );
}

function FeaturedRouteActions({ media = "video" }) {
  const { meta, routeState, playerPlayRef, requestRouteFit } = useFeaturedRoute();
  const hasRouteGeometry = routeState.geometry.length >= 2;
  const editHref = meta?.route ? `/?route=${encodeURIComponent(meta.route)}` : null;
  const isMapStage = media === "map";
  const primaryLabel = "נגן מסלול";

  const handleDownload = useCallback(() => {
    if (!hasRouteGeometry) return;
    const filename = meta?.slug ? `${meta.slug}.gpx` : "featured_route.gpx";
    executeDownloadGPX(generateGPX(routeState.geometry), filename);
  }, [hasRouteGeometry, meta?.slug, routeState.geometry]);

  const scrollStageIntoView = useCallback(() => {
    const isMobile = window.matchMedia?.("(max-width: 767px)").matches
      ?? window.innerWidth < 768;
    if (!isMobile) return;

    const target = document.querySelector("[data-route-stage]");
    if (!target) return;
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }, []);

  const handlePrimaryAction = useCallback(() => {
    if (isMapStage) {
      if (playerPlayRef.current) {
        playerPlayRef.current();
      } else {
        requestRouteFit?.("featured-map-primary-fit");
      }
      scrollStageIntoView();
      return;
    }

    playerPlayRef.current?.();
    scrollStageIntoView();
  }, [isMapStage, playerPlayRef, requestRouteFit, scrollStageIntoView]);

  return (
    <div className="fv-route-actions" aria-label="פעולות מסלול">
      <button
        type="button"
        className="fv-route-action fv-route-action--primary"
        onClick={handlePrimaryAction}
        aria-label={primaryLabel}
      >
        <Icon name="play-circle-outline" />
        <span className="fv-route-action-label">{primaryLabel}</span>
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
