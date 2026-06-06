import {
  galleryImageSlides,
  isWarningType,
  nearestSlideIndexByFraction,
  normalizePoiImages,
  primaryPoiImage,
} from "@cycleways/core/data/poiTypes.js";

const PREVIEW_MAX_FRACTION = 0.025;
const PREVIEW_MAX_METERS = 80;

// Route-level start/end points. Their content (image + name + description) lives
// on the catalog meta; their location is derived from the route geometry, and
// they anchor route-fraction 0 (start) and 1 (end).
const ROUTE_ENDPOINTS = [
  { key: "start", poiId: "route-start", fraction: 0 },
  { key: "end", poiId: "route-end", fraction: 1 },
];

function endpointLocation(kind, geometry) {
  if (!Array.isArray(geometry) || geometry.length === 0) return null;
  const point = kind === "start" ? geometry[0] : geometry[geometry.length - 1];
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  return [point.lat, point.lng];
}

// Build normalized start/end "story" objects (grouped, with images[]) from the
// catalog meta + route state. Returns [start?, end?] in order; entries without a
// valid image + name are skipped, so [] means the feature is off for this route.
export function routeEndpointStories(meta, routeState) {
  const geometry = routeState?.geometry || [];
  const distance = routeState?.distance;
  const stories = [];
  for (const def of ROUTE_ENDPOINTS) {
    const content = meta?.[def.key];
    if (!content || !content.name) continue;
    const images = normalizePoiImages(content);
    if (images.length === 0) continue;
    stories.push({
      poiId: def.poiId,
      kind: def.key,
      type: null,
      name: content.name,
      information: "",
      description: content.description || "",
      location: endpointLocation(def.key, geometry),
      routeFraction: def.fraction,
      routeProgressMeters:
        def.key === "start" ? 0 : Number.isFinite(distance) ? distance : undefined,
      images: images.map((image, imageIndex) => ({
        photo: image.photo,
        thumbnail: image.thumbnail,
        imageIndex,
      })),
    });
  }
  return stories;
}

// Flatten the endpoint stories into preview slides (one per image, with
// photo/thumbnail at top level) so they can be merged into the gallery slides.
export function routeEndpointSlides(meta, routeState) {
  const slides = [];
  for (const story of routeEndpointStories(meta, routeState)) {
    story.images.forEach((image) => {
      slides.push({
        poiId: story.poiId,
        kind: story.kind,
        type: null,
        name: story.name,
        information: story.information,
        description: story.description,
        location: story.location,
        routeProgressMeters: story.routeProgressMeters,
        routeFraction: story.routeFraction,
        imageIndex: image.imageIndex,
        photo: image.photo,
        thumbnail: image.thumbnail,
      });
    });
  }
  return slides;
}

// Hebrew label + flag for an endpoint slide/story; null for a regular POI.
export function endpointLabel(kind) {
  if (kind === "start") return "🚩 התחלה";
  if (kind === "end") return "🏁 סיום";
  return null;
}

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

function routeWarningCueSlides(points) {
  const warnings = (Array.isArray(points) ? points : [])
    .filter((point) => point && isWarningType(point.type))
    .map((point) => {
      const image = primaryPoiImage(point);
      return {
        poiId: point.id || `${point.type}-${point.location?.join(",")}`,
        kind: "warning",
        type: point.type,
        name: point.name || "",
        information: point.information || "",
        description: point.description || "",
        location: point.location,
        routeProgressMeters: point.routeProgressMeters,
        routeFraction: point.routeFraction,
        imageIndex: 0,
        photo: image?.photo || "",
        thumbnail: image?.thumbnail || image?.photo || "",
      };
    });

  warnings.sort(compareRouteCueProgress);
  return warnings;
}

function compareRouteCueProgress(a, b) {
  const ap = Number.isFinite(a?.routeProgressMeters)
    ? a.routeProgressMeters
    : Number.POSITIVE_INFINITY;
  const bp = Number.isFinite(b?.routeProgressMeters)
    ? b.routeProgressMeters
    : Number.POSITIVE_INFINITY;
  if (ap !== bp) return ap - bp;
  return String(a?.poiId || "").localeCompare(String(b?.poiId || ""));
}

export function routeVideoCueSlides(meta, routeState) {
  const activeDataPoints = routeState?.activeDataPoints || [];
  const endpoints = routeEndpointSlides(meta, routeState);
  const start = endpoints.filter((slide) => slide.kind === "start");
  const end = endpoints.filter((slide) => slide.kind === "end");
  const routeCues = [
    ...galleryImageSlides(activeDataPoints),
    ...routeWarningCueSlides(activeDataPoints),
  ].sort(compareRouteCueProgress);
  return [...start, ...routeCues, ...end];
}

// Returns the nearest video cue to the cursor and whether the cursor is
// close enough to count as "at" that POI. `near` drives the expanded preview;
// the slide itself is always returned (defaulting the cursor to the route
// start) so callers can keep a persistent thumbnail of the nearest stop.
export function nearestPreviewForCursor(
  slides,
  fraction,
  routeDistanceMeters,
  options = {},
) {
  const f = Number.isFinite(fraction) ? fraction : 0;
  const index = nearestSlideIndexByFraction(slides, f);
  const slide = slides[index] || null;
  if (!slide || !Number.isFinite(slide.routeFraction)) {
    return { slide, near: false };
  }
  const maxMeters = Number.isFinite(options.maxMeters) && options.maxMeters > 0
    ? options.maxMeters
    : PREVIEW_MAX_METERS;
  const maxFraction = Number.isFinite(options.maxFraction) && options.maxFraction > 0
    ? options.maxFraction
    : PREVIEW_MAX_FRACTION;

  const distanceThreshold =
    Number.isFinite(routeDistanceMeters) && routeDistanceMeters > 0
      ? maxMeters / routeDistanceMeters
      : maxFraction;
  const threshold = Math.min(maxFraction, distanceThreshold);
  const delta = Math.abs(slide.routeFraction - f);

  return { slide, near: delta <= threshold };
}

export function previewSlideForCursor(slides, fraction, routeDistanceMeters, options = {}) {
  const { slide, near } = nearestPreviewForCursor(
    slides,
    fraction,
    routeDistanceMeters,
    options,
  );
  return near ? slide : null;
}

export {
  PREVIEW_MAX_FRACTION,
  PREVIEW_MAX_METERS,
};
