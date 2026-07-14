// Imperative boundary between semantic navigation-camera intents and
// @rnmapbox/maps. Mapbox remains the projection authority: overview frames use
// native bounds fitting and placement is checked with MapView#getPointInView
// after the transition settles.

const DEFAULT_OVERVIEW_DURATION_MS = 500;
const DEFAULT_ANCHOR_Y = 0.72;
const DEFAULT_CLEARANCE = 12;
const DEFAULT_FOLLOW_PADDING_DURATION_MS = 500;
const PADDING_KEYS = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function validPoint(point) {
  return Number.isFinite(Number(point?.lng)) && Number.isFinite(Number(point?.lat));
}

function samePadding(first, second, tolerance = 0.01) {
  return PADDING_KEYS.every(
    (key) => Math.abs(finite(first?.[key]) - finite(second?.[key])) <= tolerance,
  );
}

function paddingAtTransition(transition, nowMs) {
  const durationMs = Math.max(0, finite(transition?.durationMs));
  const linear = durationMs === 0
    ? 1
    : clamp((nowMs - finite(transition?.startedAtMs)) / durationMs, 0, 1);
  const eased = linear * linear * (3 - 2 * linear);
  return Object.fromEntries(PADDING_KEYS.map((key) => [
    key,
    finite(transition?.from?.[key]) +
      (finite(transition?.to?.[key]) - finite(transition?.from?.[key])) * eased,
  ]));
}

export function normalizeCameraViewport(input = {}) {
  if (
    Number.isFinite(Number(input.width)) &&
    Number.isFinite(Number(input.height)) &&
    Number.isFinite(Number(input.left)) &&
    Number.isFinite(Number(input.right)) &&
    Number.isFinite(Number(input.top)) &&
    Number.isFinite(Number(input.bottom))
  ) {
    const width = Number(input.width);
    const height = Number(input.height);
    const left = Number(input.left);
    const right = Number(input.right);
    const top = Number(input.top);
    const bottom = Number(input.bottom);
    return {
      ...input,
      width,
      height,
      left,
      right,
      top,
      bottom,
      usableWidth: right - left,
      usableHeight: bottom - top,
      padding: {
        paddingTop: top,
        paddingRight: width - right,
        paddingBottom: height - bottom,
        paddingLeft: left,
      },
    };
  }
  const width = Math.max(1, finite(input.width, 1));
  const height = Math.max(1, finite(input.height, 1));
  const clearance = Math.max(0, finite(input.clearance, DEFAULT_CLEARANCE));
  const safeInsets = input.safeInsets || {};
  const safeTop = Math.max(0, finite(safeInsets.top));
  const safeBottom = Math.max(0, finite(safeInsets.bottom));
  const safeLeft = Math.max(0, finite(safeInsets.left));
  const safeRight = Math.max(0, finite(safeInsets.right));
  const topOverlayBottom = Number.isFinite(Number(input.topOverlayBottom))
    ? Number(input.topOverlayBottom)
    : safeTop;
  const bottomOverlayTop = Number.isFinite(Number(input.bottomOverlayTop))
    ? Number(input.bottomOverlayTop)
    : height - safeBottom;
  const horizontalMargin = Math.max(0, finite(input.horizontalMargin, 16));

  const left = clamp(Math.max(safeLeft, horizontalMargin) + clearance, 0, width - 1);
  const right = clamp(
    width - Math.max(safeRight, horizontalMargin) - clearance,
    left + 1,
    width,
  );
  const top = clamp(Math.max(safeTop, topOverlayBottom) + clearance, 0, height - 1);
  const bottom = clamp(
    Math.min(height - safeBottom, bottomOverlayTop) - clearance,
    top + 1,
    height,
  );

  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    usableWidth: right - left,
    usableHeight: bottom - top,
    padding: {
      paddingTop: top,
      paddingRight: width - right,
      paddingBottom: height - bottom,
      paddingLeft: left,
    },
  };
}

// RNMapbox does not expose CameraOptions.anchor for imperative camera stops.
// Native CameraOptions padding does, however, place centerCoordinate at the
// center of the padded viewport. This converts the desired rider slot into a
// deliberate virtual top padding while retaining the real bottom occlusion.
export function cameraPaddingForRiderAnchor(viewport, anchorY = DEFAULT_ANCHOR_Y) {
  const normalized = normalizeCameraViewport(viewport);
  const fraction = clamp(finite(anchorY, DEFAULT_ANCHOR_Y), 0.5, 0.85);
  const desiredY = normalized.top + normalized.usableHeight * fraction;
  const paddingBottom = normalized.height - normalized.bottom;
  const paddingTop = clamp(
    2 * desiredY - (normalized.height - paddingBottom),
    normalized.top,
    Math.max(normalized.top, normalized.height - paddingBottom - 2),
  );
  return {
    paddingTop,
    paddingRight: normalized.width - normalized.right,
    paddingBottom,
    paddingLeft: normalized.left,
  };
}

export function cameraBoundsForPoints(points) {
  const normalized = (Array.isArray(points) ? points : [])
    .filter(validPoint)
    .map((point) => ({ lng: Number(point.lng), lat: Number(point.lat) }));
  if (normalized.length < 2) return null;
  return {
    ne: [
      Math.max(...normalized.map((point) => point.lng)),
      Math.max(...normalized.map((point) => point.lat)),
    ],
    sw: [
      Math.min(...normalized.map((point) => point.lng)),
      Math.min(...normalized.map((point) => point.lat)),
    ],
  };
}

export function evaluateProjectedPlacement(projected, viewport, options = {}) {
  const normalized = normalizeCameraViewport(viewport);
  const points = Array.isArray(projected) ? projected : [];
  const outside = [];
  for (const point of points) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
      outside.push(point?.id ?? null);
      continue;
    }
    if (
      point.x < normalized.left ||
      point.x > normalized.right ||
      point.y < normalized.top ||
      point.y > normalized.bottom
    ) {
      outside.push(point.id ?? null);
    }
  }
  const rider = options.riderId
    ? points.find((point) => point.id === options.riderId)
    : null;
  const desiredAnchorY =
    normalized.top +
    normalized.usableHeight * clamp(finite(options.anchorY, DEFAULT_ANCHOR_Y), 0, 1);
  const riderAnchorErrorPx = rider && Number.isFinite(rider.y)
    ? rider.y - desiredAnchorY
    : null;
  const anchorTolerancePx = Math.max(0, finite(options.anchorTolerancePx, 28));
  return {
    valid: outside.length === 0 &&
      (riderAnchorErrorPx === null || Math.abs(riderAnchorErrorPx) <= anchorTolerancePx),
    outside,
    riderAnchorErrorPx,
    desiredAnchorY,
    viewport: normalized,
  };
}

function overviewStop(frame, viewport) {
  const points = Array.isArray(frame.points) ? frame.points.filter(validPoint) : [];
  const bounds = cameraBoundsForPoints(points);
  const stop = {
    type: "CameraStop",
    heading: Number.isFinite(frame.heading) ? frame.heading : 0,
    pitch: Number.isFinite(frame.pitch) ? frame.pitch : 0,
    padding: normalizeCameraViewport(viewport).padding,
    animationDuration: Math.max(
      0,
      finite(frame.animationDuration, DEFAULT_OVERVIEW_DURATION_MS),
    ),
    animationMode: frame.animationMode || "easeTo",
  };
  if (bounds) stop.bounds = bounds;
  else if (validPoint(points[0])) {
    stop.centerCoordinate = [Number(points[0].lng), Number(points[0].lat)];
    if (Number.isFinite(frame.zoom)) stop.zoomLevel = frame.zoom;
  }
  return stop;
}

export function createNavigationCameraAdapter(options = {}) {
  const getCamera = options.getCamera || (() => null);
  const getMap = options.getMap || (() => null);
  const now = options.now || (() => Date.now());
  const followPaddingDurationMs = Math.max(
    0,
    finite(options.followPaddingDurationMs, DEFAULT_FOLLOW_PADDING_DURATION_MS),
  );
  // Native camera work is only legal while the app is foregrounded. Under a
  // locked screen the When-In-Use session keeps JS and GPS alive, but rnmapbox
  // camera promises against a backgrounded UI wedge the main thread until the
  // iOS watchdog kills the app (0x8BADF00D, TestFlight build 5). Skipped
  // applies return false so callers retry once the app is interactive again.
  const isInteractive = options.isInteractive || (() => true);
  const schedule = options.schedule || ((callback, ms) => setTimeout(callback, ms));
  const cancelSchedule = options.cancelSchedule || ((handle) => clearTimeout(handle));
  let listener = options.onDiagnostics || null;
  let settleHandle = null;
  let transitionSeq = 0;
  let followPaddingTransition = null;
  let state = {
    owner: "idle",
    transitionId: null,
    transitionState: "idle",
    key: null,
    interruptionReason: null,
    fitCount: 0,
    validation: null,
    validationKey: null,
    paddingTransitionState: "idle",
  };

  const emit = (patch = {}) => {
    state = { ...state, ...patch };
    listener?.({ ...state });
    return state;
  };

  const clearSettle = () => {
    if (settleHandle !== null) cancelSchedule(settleHandle);
    settleHandle = null;
  };

  const clearFollowPadding = () => {
    followPaddingTransition = null;
  };

  const resolveFollowPadding = (target, continueFromFollow) => {
    const nowMs = finite(now());
    if (!continueFromFollow || !followPaddingTransition) {
      followPaddingTransition = {
        from: target,
        to: target,
        startedAtMs: nowMs,
        durationMs: followPaddingDurationMs,
      };
      return { padding: { ...target }, settled: true };
    }

    const current = paddingAtTransition(followPaddingTransition, nowMs);
    if (!samePadding(target, followPaddingTransition.to)) {
      if (followPaddingDurationMs === 0) {
        followPaddingTransition = {
          from: target,
          to: target,
          startedAtMs: nowMs,
          durationMs: 0,
        };
        return { padding: { ...target }, settled: true };
      }
      followPaddingTransition = {
        from: current,
        to: target,
        startedAtMs: nowMs,
        durationMs: followPaddingDurationMs,
      };
      return { padding: current, settled: false };
    }

    if (samePadding(followPaddingTransition.from, followPaddingTransition.to)) {
      return { padding: { ...target }, settled: true };
    }

    const settled =
      followPaddingDurationMs === 0 ||
      nowMs - followPaddingTransition.startedAtMs >= followPaddingDurationMs;
    if (settled) {
      followPaddingTransition = {
        from: target,
        to: target,
        startedAtMs: nowMs,
        durationMs: followPaddingDurationMs,
      };
      return { padding: { ...target }, settled: true };
    }
    return { padding: current, settled: false };
  };

  const projectAndValidate = async (frame, viewport, transitionId) => {
    const map = getMap();
    if (!map || typeof map.getPointInView !== "function") return null;
    const projected = [];
    for (const item of Array.isArray(frame.requiredPoints) ? frame.requiredPoints : []) {
      if (!isInteractive()) return null;
      if (!validPoint(item)) continue;
      try {
        const screen = await map.getPointInView([Number(item.lng), Number(item.lat)]);
        if (Array.isArray(screen) && screen.length >= 2) {
          projected.push({ id: item.id ?? null, x: Number(screen[0]), y: Number(screen[1]) });
        }
      } catch {
        projected.push({ id: item.id ?? null, x: NaN, y: NaN });
      }
    }
    if (state.transitionId !== transitionId) return null;
    if (frame.validationKey && state.validationKey !== frame.validationKey) return null;
    const validation = evaluateProjectedPlacement(projected, viewport, {
      riderId: frame.riderId,
      anchorY: frame.riderAnchorY,
      anchorTolerancePx: frame.anchorTolerancePx,
    });
    emit({ validation });
    return validation;
  };

  const interrupt = (reason = "replaced") => {
    clearSettle();
    if (state.transitionState === "running") {
      emit({ transitionState: "interrupted", interruptionReason: reason });
    }
  };

  return {
    setDiagnosticsListener(next) {
      listener = typeof next === "function" ? next : null;
    },

    applyFollow(frame = {}, viewport = {}) {
      if (!isInteractive()) return false;
      const camera = getCamera();
      if (!camera || typeof camera.setCamera !== "function" || !validPoint(frame.center)) {
        return false;
      }
      const wasFollowing = state.owner === "follow";
      const key = frame.key ?? null;
      const ownershipChanged = state.owner !== "follow" || state.key !== key;
      if (ownershipChanged) interrupt(frame.interruptionReason || "follow");
      const transitionId = ownershipChanged ? ++transitionSeq : state.transitionId;
      const targetPadding = cameraPaddingForRiderAnchor(viewport, frame.riderAnchorY);
      const { padding, settled: paddingSettled } = resolveFollowPadding(
        targetPadding,
        wasFollowing,
      );
      camera.setCamera({
        type: "CameraStop",
        centerCoordinate: [Number(frame.center.lng), Number(frame.center.lat)],
        heading: Number.isFinite(frame.heading) ? frame.heading : 0,
        pitch: Number.isFinite(frame.pitch) ? frame.pitch : 0,
        zoomLevel: Number.isFinite(frame.zoom) ? frame.zoom : 16,
        padding,
        animationDuration: 0,
        animationMode: "none",
      });
      const applied = {
        pitch: Number.isFinite(frame.pitch) ? frame.pitch : 0,
        zoom: Number.isFinite(frame.zoom) ? frame.zoom : 16,
        heading: Number.isFinite(frame.heading) ? frame.heading : 0,
        riderAnchorY: frame.riderAnchorY ?? DEFAULT_ANCHOR_Y,
        padding,
      };
      if (ownershipChanged) {
        emit({
          owner: "follow",
          transitionId,
          transitionState: "settled",
          key,
          interruptionReason: null,
          applied,
          validationKey: frame.validationKey ?? null,
          paddingTransitionState: paddingSettled ? "settled" : "running",
        });
      } else {
        state = {
          ...state,
          applied,
          validationKey: frame.validationKey ?? state.validationKey,
          paddingTransitionState: paddingSettled ? "settled" : "running",
        };
      }
      if (
        paddingSettled &&
        frame.validationKey &&
        frame.validationKey !== state.lastValidatedKey &&
        Array.isArray(frame.requiredPoints) &&
        frame.requiredPoints.length > 0
      ) {
        const validationKey = frame.validationKey;
        state = { ...state, validationKey, lastValidatedKey: validationKey };
        schedule(() => {
          void projectAndValidate(frame, viewport, transitionId);
        }, 50);
      }
      return true;
    },

    applyOverview(frame = {}, viewport = {}) {
      if (!isInteractive()) return false;
      const camera = getCamera();
      if (!camera || typeof camera.setCamera !== "function") return false;
      const key = frame.key ?? null;
      if (state.owner === "overview" && key !== null && state.key === key) return false;
      interrupt(frame.interruptionReason || "overview-replaced");
      const stop = overviewStop(frame, viewport);
      if (!stop.bounds && !stop.centerCoordinate) return false;
      clearFollowPadding();
      const transitionId = ++transitionSeq;
      camera.setCamera(stop);
      emit({
        owner: "overview",
        transitionId,
        transitionState: stop.animationDuration > 0 ? "running" : "settled",
        key,
        interruptionReason: null,
        fitCount: state.fitCount + 1,
        validation: null,
        validationKey: null,
        lastValidatedKey: null,
        paddingTransitionState: "idle",
      });
      const settle = () => {
        settleHandle = null;
        if (state.transitionId !== transitionId) return;
        emit({ transitionState: "settled" });
        void projectAndValidate(frame, viewport, transitionId);
      };
      if (stop.animationDuration > 0) {
        settleHandle = schedule(settle, stop.animationDuration);
      } else {
        settle();
      }
      return true;
    },

    setFree(reason = "user-gesture") {
      if (state.owner === "free") return;
      interrupt(reason);
      clearFollowPadding();
      emit({
        owner: "free",
        transitionId: ++transitionSeq,
        transitionState: "settled",
        key: null,
        interruptionReason: reason,
        paddingTransitionState: "idle",
      });
    },

    reset(reason = "reset") {
      interrupt(reason);
      clearFollowPadding();
      emit({
        owner: "idle",
        transitionId: null,
        transitionState: "idle",
        key: null,
        interruptionReason: reason,
        validation: null,
        paddingTransitionState: "idle",
      });
    },

    getState() {
      return { ...state };
    },
  };
}
