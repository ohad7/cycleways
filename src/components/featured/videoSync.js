function assertValid({ keyframes, videoDuration, routeGeometry }) {
  if (!Array.isArray(keyframes) || keyframes.length < 2) {
    throw new Error("videoSync requires at least 2 keyframes");
  }
  for (let i = 1; i < keyframes.length; i++) {
    if (keyframes[i].t <= keyframes[i - 1].t) {
      throw new Error("videoSync keyframes must be sorted by t (strictly increasing)");
    }
  }
  if (keyframes[0].t !== 0) {
    throw new Error("videoSync first keyframe must have t === 0");
  }
  if (keyframes[keyframes.length - 1].t !== videoDuration) {
    throw new Error("videoSync last keyframe must have t === videoDuration");
  }
  if (!Array.isArray(routeGeometry) || routeGeometry.length < 2) {
    throw new Error("videoSync route geometry must have at least 2 points");
  }
}

export function createVideoSync(input) {
  assertValid(input);
  return {};
}
