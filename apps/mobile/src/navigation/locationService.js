// Native location service for turn-by-turn navigation (turn-by-turn Phase 6).
//
// Wraps expo-location so the navigation session controls accuracy, cadence,
// permissions, and teardown — instead of relying on the RNMapbox `UserLocation`
// puck (which stays only for visual display). Emits the route-progress fix shape
// via the shared, unit-tested `toNavigationFix` mapper.
//
// First release is FOREGROUND-ONLY (see useNavigationSession `background`
// default). Background/lock-screen updates need `UIBackgroundModes: location`
// (configured in app.json) plus `expo-task-manager`, and must be verified on a
// physical device before being enabled.
//
// NOTE: native module — not covered by the node test suite. The pure mapping it
// depends on is tested in tests/test-location-fix.mjs.

import * as Location from "expo-location";
import { toNavigationFix } from "@cycleways/core/navigation/locationFix.js";

// Request the permissions navigation needs. Foreground is always required;
// background is requested only when asked AND after foreground is granted.
export async function requestNavigationPermissions({ background = false } = {}) {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") {
    return { granted: false, background: false, status: foreground.status };
  }
  if (!background) {
    return { granted: true, background: false, status: foreground.status };
  }
  const bg = await Location.requestBackgroundPermissionsAsync();
  return {
    granted: true,
    background: bg.status === "granted",
    status: foreground.status,
  };
}

// Start a high-accuracy foreground watch. Returns a handle with stop(); calling
// stop() removes the subscription so watchers never leak after navigation ends.
export async function startNavigationWatch({ onFix, onError } = {}) {
  let subscription = null;
  let stopped = false;
  try {
    subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 3,
      },
      (location) => {
        const fix = toNavigationFix(location);
        if (fix && typeof onFix === "function") onFix(fix);
      },
    );
    // Guard against stop() being called before the async subscription resolved.
    if (stopped) subscription.remove();
  } catch (error) {
    if (typeof onError === "function") onError(error);
  }

  return {
    stop() {
      stopped = true;
      if (subscription) {
        subscription.remove();
        subscription = null;
      }
    },
  };
}
