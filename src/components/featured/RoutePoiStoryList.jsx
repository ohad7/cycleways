import React, { useMemo } from "react";
import { poiLabel } from "@cycleways/core/data/poiTypes.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";
import { imageSrc, routePoiStories } from "./routePoiStoryData.js";

function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return "";
  if (meters < 1000) return `${Math.round(meters)} מ׳`;
  return `${(meters / 1000).toFixed(1)} ק״מ`;
}

export default function RoutePoiStoryList({ className = "" }) {
  const {
    routeState,
    focusedPoiId,
    setFocusedPoiId,
    setFocusedCoord,
    seekVideoToFraction,
    playerPauseRef,
  } = useFeaturedRoute();
  const stories = useMemo(
    () => routePoiStories(routeState.activeDataPoints),
    [routeState.activeDataPoints],
  );

  if (stories.length === 0) return null;

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
  }

  return (
    <section
      id="sbh-poi-stories"
      className={["sbh-poi-stories", className].filter(Boolean).join(" ")}
      aria-label="נקודות עניין ותמונות לאורך המסלול"
    >
      <div className="sbh-poi-stories-heading">
        <span>לעצור בדרך</span>
        <h2>נקודות עם תמונות מהמסלול</h2>
      </div>

      <div className="sbh-poi-story-list">
        {stories.map((story, index) => {
          const distance = formatDistance(story.routeProgressMeters);
          const stopLabel = `תחנה ${index + 1}${distance ? ` · ${distance}` : ""}`;
          return (
          <button
            key={story.poiId}
            type="button"
            data-poi-id={story.poiId}
            className={[
              "sbh-poi-story",
              focusedPoiId === story.poiId ? "sbh-poi-story--focused" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => handleSelect(story)}
          >
            <div className="sbh-poi-story-copy">
              <span className="sbh-poi-story-kicker">{stopLabel}</span>
              <h3>{story.name || poiLabel(story.type)}</h3>
              <span className="sbh-poi-story-type">{poiLabel(story.type)}</span>
              {story.description && (
                <p className="sbh-poi-story-description">{story.description}</p>
              )}
            </div>

            <div
              className={[
                "sbh-poi-story-images",
                story.images.length === 1 ? "sbh-poi-story-images--single" : "",
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
          </button>
          );
        })}
      </div>
    </section>
  );
}
