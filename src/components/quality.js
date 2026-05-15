export function getSegmentQualityOverall(segmentMetadata) {
  const quality =
    segmentMetadata?.quality && typeof segmentMetadata.quality === "object"
      ? Number(segmentMetadata.quality.overall)
      : NaN;
  return Number.isInteger(quality) && quality >= 1 && quality <= 5
    ? quality
    : 3;
}

export function getSegmentQualityLabel(segmentMetadata, featureFlags) {
  if (!featureFlags.segmentQualityPublicDisplay) return null;

  const overall = getSegmentQualityOverall(segmentMetadata);
  if (overall >= 5) {
    return {
      tone: "excellent",
      text: "★★★★★ מומלץ",
    };
  }

  if (overall <= 2) {
    return {
      tone: "caution",
      text: "דירוג נמוך",
    };
  }

  return null;
}
