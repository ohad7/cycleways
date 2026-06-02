import {
  galleryImageSlides,
  nearestSlideIndexByFraction,
} from "@cycleways/core/data/poiTypes.js";

const PREVIEW_MAX_FRACTION = 0.025;
const PREVIEW_MAX_METERS = 80;

export function imageSrc(item) {
  const src = item?.thumbnail || item?.photo || "";
  if (!src) return "";
  if (/^(https?:)?\/\//.test(src) || src.startsWith("/")) return src;
  return `/${src}`;
}

export function routePoiStories(points) {
  const stories = [];
  const byPoiId = new Map();

  for (const slide of galleryImageSlides(points)) {
    const poiId = slide.poiId || `${slide.type}-${slide.location?.join(",")}`;
    let story = byPoiId.get(poiId);
    if (!story) {
      story = {
        poiId,
        type: slide.type,
        name: slide.name || "",
        information: slide.information || "",
        description: slide.description || "",
        location: slide.location,
        routeProgressMeters: slide.routeProgressMeters,
        routeFraction: slide.routeFraction,
        images: [],
      };
      byPoiId.set(poiId, story);
      stories.push(story);
    }
    story.images.push({
      photo: slide.photo,
      thumbnail: slide.thumbnail,
      imageIndex: slide.imageIndex,
    });
  }

  return stories;
}

export function previewSlideForCursor(slides, fraction, routeDistanceMeters) {
  const index = nearestSlideIndexByFraction(slides, fraction);
  const slide = slides[index];
  if (!slide || !Number.isFinite(slide.routeFraction)) return null;

  const distanceThreshold =
    Number.isFinite(routeDistanceMeters) && routeDistanceMeters > 0
      ? PREVIEW_MAX_METERS / routeDistanceMeters
      : PREVIEW_MAX_FRACTION;
  const threshold = Math.min(PREVIEW_MAX_FRACTION, distanceThreshold);
  const delta = Math.abs(slide.routeFraction - fraction);

  return delta <= threshold ? slide : null;
}
