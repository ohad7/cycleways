import { primaryPoiImage } from "@cycleways/core/data/poiTypes.js";
import { imageSrc } from "./featured/routePoiStoryData.js";

// Pick a representative image for a segment from its data points (POIs/markers).
// Returns a resolved URL string for the first data point that has an image, or
// "" when none of the segment's data points carry an image. Mirrors how the POI
// preview resolves images, so paths and thumbnail preference stay consistent.
export function segmentPreviewImage(details) {
  const dataPoints = Array.isArray(details?.dataPoints) ? details.dataPoints : [];
  for (const dataPoint of dataPoints) {
    const image = primaryPoiImage(dataPoint);
    if (image) return imageSrc(image);
  }
  return "";
}
