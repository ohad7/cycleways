import React, { useMemo } from "react";
import { poiLabel } from "@cycleways/core/data/poiTypes.js";
import RichText from "../RichText.jsx";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import {
  endpointLabel,
  imageSrc,
  routeEndpointStories,
  routePoiStories,
} from "./routePoiStoryData.js";

function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return "";
  if (meters < 1000) return `${Math.round(meters)} מ׳`;
  return `${(meters / 1000).toFixed(1)} ק״מ`;
}

function scrollRoutePlayerIntoView() {
  const target = document.querySelector("[data-route-stage]") || document.querySelector(".fv-video-shell");
  if (!target) return;
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "start",
  });
}

export default function RoutePoiStoryList({ className = "" }) {
  const {
    meta,
    routeState,
    focusedPoiId,
    setFocusedPoiId,
    setFocusedCoord,
    seekVideoToFraction,
    playerPauseRef,
  } = useFeaturedRoute();
  const stories = useMemo(() => {
    const base = routePoiStories(routeState.activeDataPoints);
    const ends = routeEndpointStories(meta, routeState);
    const start = ends.find((e) => e.kind === "start");
    const end = ends.find((e) => e.kind === "end");
    return [
      ...(start ? [start] : []),
      ...base,
      ...(end ? [end] : []),
    ];
  }, [meta, routeState]);

  if (stories.length === 0) return null;

  // Number only the on-route stops; the start/end endpoints get their own label.
  let stopNumber = 0;
  const items = stories.map((story) => {
    let kicker;
    if (story.kind) {
      kicker = endpointLabel(story.kind);
    } else {
      stopNumber += 1;
      const distance = formatDistance(story.routeProgressMeters);
      kicker = `תחנה ${stopNumber}${distance ? ` · ${distance}` : ""}`;
    }
    return { story, kicker };
  });

  function handleSelect(story) {
    setFocusedPoiId(story.poiId);
    if (Array.isArray(story.location) && story.location.length >= 2) {
      const [lat, lng] = story.location;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setFocusedCoord({ lat, lng });
        seekVideoToFraction(story.routeFraction, { lat, lng });
      } else {
        seekVideoToFraction(story.routeFraction);
      }
    } else {
      seekVideoToFraction(story.routeFraction);
    }
    playerPauseRef.current?.();
    window.requestAnimationFrame(scrollRoutePlayerIntoView);
  }

  return (
    <section
      id="fv-poi-stories"
      className={["fv-poi-stories", className].filter(Boolean).join(" ")}
      aria-label="נקודות עניין ותמונות לאורך המסלול"
    >      

      <div className="fv-poi-story-list">
        {items.map(({ story, kicker }) => (
          <button
            key={story.poiId}
            type="button"
            data-poi-id={story.poiId}
            className={[
              "fv-poi-story",
              story.kind ? "fv-poi-story--endpoint" : "",
              focusedPoiId === story.poiId ? "fv-poi-story--focused" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => handleSelect(story)}
          >            
            <div className="fv-poi-story-copy">              
              <span className="fv-poi-story-kicker">{kicker}</span>
              <h3>{story.name || poiLabel(story.type)}</h3>
              {!story.kind && (
                <span className="fv-poi-story-type">{poiLabel(story.type)}</span>
              )}
              <RichText className="fv-poi-story-description" text={story.description} />
            </div>            

            <div className="fv-poi-story-media">
              <div
                className={[
                  "fv-poi-story-images",
                  story.images.length === 1 ? "fv-poi-story-images--single" : "",
                  story.images.length > 1 ? "fv-poi-story-images--multiple" : "",
                ].filter(Boolean).join(" ")}
              >
                {story.images.map((image) => (
                  <img
                    key={`${story.poiId}-${image.imageIndex}`}
                    src={imageSrc(image)}
                    alt={story.name || poiLabel(story.type)}
                  />
                ))}
              </div>
              {story.images.length > 1 && (
                <span
                  className="fv-poi-story-image-count"
                  aria-label={`יש ${story.images.length} תמונות`}
                >
                  {story.images.length} תמונות
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
