const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const NAVIGATION_CAMERA_DEFAULTS = Object.freeze({
  riderAnchorY: 0.72,
  lookaheadMinMeters: 120,
  lookaheadMaxMeters: 400,
  lookaheadBaseMeters: 100,
  lookaheadSpeedSeconds: 30,
  behindMeters: 30,
  postManeuverMeters: 90,
  followMinZoom: 15.6,
  followMaxZoom: 17,
  maneuverMinZoom: 16.2,
  maneuverMaxZoom: 17.2,
  zoomDeadBand: 0.15,
  maxZoomVelocityPerSecond: 0.7,
  overviewDurationMs: 500,
  joinDurationMs: 1200,
  reacquireDurationMs: 1200,
});

function intent(stage, values) {
  const viewportMode = values.viewportMode;
  const pitch = Number(values.pitch);
  return {
    stage,
    viewportMode,
    geometryRole: values.geometryRole,
    bearingPolicy: values.bearingPolicy,
    pitch: Number.isFinite(pitch) ? pitch : 0,
    pitchRange: values.pitchRange || { min: pitch, max: pitch },
    zoomPolicy: values.zoomPolicy,
    riderAnchorY: values.riderAnchorY ?? NAVIGATION_CAMERA_DEFAULTS.riderAnchorY,
    lookaheadMeters: values.lookaheadMeters ?? null,
    behindMeters: values.behindMeters ?? null,
    postManeuverMeters: values.postManeuverMeters ?? null,
    fitKind: values.fitKind ?? null,
    focusKind: values.focusKind ?? null,
    transition: values.transition || { kind: "steady", durationMs: 0 },
    holdFrame: values.holdFrame === true,
  };
}

function speedFor(state, approach = false) {
  const progress = approach
    ? state?.approach?.approachProgress || state?.progress
    : state?.progress;
  return Number.isFinite(progress?.smoothedSpeedMps)
    ? progress.smoothedSpeedMps
    : 3;
}

export function cameraLookaheadMeters(speedMps, defaults = NAVIGATION_CAMERA_DEFAULTS) {
  const speed = Math.max(0, Number(speedMps) || 0);
  return clamp(
    defaults.lookaheadBaseMeters + speed * defaults.lookaheadSpeedSeconds,
    defaults.lookaheadMinMeters,
    defaults.lookaheadMaxMeters,
  );
}

export function cameraIntentForStage(stage, state = {}) {
  const defaults = NAVIGATION_CAMERA_DEFAULTS;
  const follow = (geometryRole, values = {}) => intent(stage, {
    viewportMode: "follow",
    geometryRole,
    bearingPolicy: "route",
    pitch: 55,
    pitchRange: { min: 45, max: 55 },
    zoomPolicy: {
      kind: "corridor-fit",
      minZoom: defaults.followMinZoom,
      maxZoom: defaults.followMaxZoom,
    },
    lookaheadMeters: cameraLookaheadMeters(speedFor(state, geometryRole === "approach")),
    behindMeters: defaults.behindMeters,
    ...values,
  });

  switch (stage) {
    case "approach-resolving":
      return intent(stage, {
        viewportMode: "overview",
        geometryRole: "direct",
        bearingPolicy: "target",
        pitch: 55,
        pitchRange: { min: 35, max: 55 },
        zoomPolicy: { kind: "points-fit", minZoom: 8.8, maxZoom: 16.8 },
        fitKind: "approach-start",
        transition: { kind: "hold-or-intro", durationMs: 0 },
      });
    case "approach-too-far":
      return intent(stage, {
        viewportMode: "overview",
        geometryRole: "direct",
        bearingPolicy: "target",
        pitch: 55,
        pitchRange: { min: 55, max: 55 },
        zoomPolicy: { kind: "retain-frame" },
        fitKind: "approach-start",
        transition: { kind: "hold", durationMs: 0 },
        holdFrame: true,
      });
    case "approach-guide":
      return follow("approach");
    case "approach-guide-pre-turn":
      return follow("approach", {
        pitch: 38,
        pitchRange: { min: 35, max: 40 },
        zoomPolicy: {
          kind: "corridor-fit",
          minZoom: defaults.maneuverMinZoom,
          maxZoom: defaults.maneuverMaxZoom,
        },
        focusKind: "approach-cue",
        postManeuverMeters: defaults.postManeuverMeters,
        transition: { kind: "maneuver", durationMs: 900 },
      });
    case "join-route":
      return follow("join", {
        pitch: 42,
        pitchRange: { min: 40, max: 55 },
        focusKind: "route-start",
        transition: { kind: "join", durationMs: defaults.joinDurationMs },
      });
    case "reacquire-route":
      return follow("main", {
        pitch: 35,
        pitchRange: { min: 20, max: 55 },
        transition: { kind: "reacquire", durationMs: defaults.reacquireDurationMs },
      });
    case "off-route":
      return intent(stage, {
        viewportMode: "overview",
        geometryRole: "rejoin",
        bearingPolicy: "hold",
        pitch: 20,
        pitchRange: { min: 0, max: 20 },
        zoomPolicy: { kind: "points-fit", minZoom: 12, maxZoom: 17 },
        fitKind: "rejoin",
        transition: { kind: "immediate", durationMs: 0 },
      });
    case "pre-turn":
      return follow("main", {
        pitch: 38,
        pitchRange: { min: 35, max: 40 },
        zoomPolicy: {
          kind: "corridor-fit",
          minZoom: defaults.maneuverMinZoom,
          maxZoom: defaults.maneuverMaxZoom,
        },
        focusKind: "cue",
        postManeuverMeters: defaults.postManeuverMeters,
        transition: { kind: "maneuver", durationMs: 900 },
      });
    case "arrival":
      return follow("arrival", {
        pitch: 33,
        pitchRange: { min: 30, max: 35 },
        zoomPolicy: { kind: "local", minZoom: 16, maxZoom: 17.2 },
        focusKind: "cue",
        transition: { kind: "arrival", durationMs: 900 },
      });
    case "arrived-local":
      return intent(stage, {
        viewportMode: "overview",
        geometryRole: "arrival",
        bearingPolicy: "north-up",
        pitch: 0,
        pitchRange: { min: 0, max: 0 },
        zoomPolicy: { kind: "local", minZoom: 15.5, maxZoom: 17 },
        fitKind: "arrival-local",
        transition: { kind: "arrival-local", durationMs: 450 },
      });
    case "ride-summary":
      return intent(stage, {
        viewportMode: "overview",
        geometryRole: "summary",
        bearingPolicy: "north-up",
        pitch: 0,
        pitchRange: { min: 0, max: 0 },
        zoomPolicy: { kind: "summary", minZoom: 8, maxZoom: 17 },
        fitKind: "route",
        transition: { kind: "summary", durationMs: 550 },
      });
    case "ride":
    default:
      return follow("main");
  }
}
