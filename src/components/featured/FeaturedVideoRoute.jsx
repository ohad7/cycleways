import React from "react";
import { useSearchParams } from "react-router-dom";
import FeaturedRoute from "./FeaturedRoute.jsx";
import { featuredLayoutFromParam, OVERLAY } from "./featuredLayout.js";
import FeaturedRouteStats from "./FeaturedRouteStats.jsx";
import FeaturedElevation from "./FeaturedElevation.jsx";

// Shared video-first featured-route template. The video player, maps, POI
// preview, progress readout, and POI story list are identical across routes;
// only the editorial copy differs and comes in via the `intro`/`about` props.
//
//   intro: { kicker?, heading?, body?: string[] }   — side "what's on the ride" panel
//   about: { eyebrow?, heading?, paragraphs?: string[] } — below-the-fold "about" section
export default function FeaturedVideoRoute({ slug, kicker = null, intro = {}, about = {} }) {
  const [searchParams] = useSearchParams();
  const overlay = featuredLayoutFromParam(searchParams.get("layout")) === OVERLAY;
  return (
    <FeaturedRoute slug={slug} layout="video-first" desktopMap="manual" kicker={kicker}>
      <section
        className={`fv-playback${overlay ? " fv-playback--overlay" : ""}`}
        aria-label="סרטון, תיאור ומפת המסלול"
      >
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
          </section>

          {overlay ? (
            <div className="fv-side-elevation-wrap">
              <div className="fv-side-heading">
                <span>מרחק מההתחלה</span>
                <FeaturedRoute.ProgressDistance />
              </div>
              <FeaturedRouteStats />
              <FeaturedElevation />
            </div>
          ) : (
            <div className="fv-side-map-wrap">
              <div className="fv-side-heading">
                <span>מרחק מההתחלה</span>
                <FeaturedRoute.ProgressDistance />
              </div>
              <FeaturedRoute.Map
                variant="desktop"
                className="fv-side-map"
                autoResetAfterInteraction
                routeFitPadding={22}
              />
            </div>
          )}
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
