// Native location service for turn-by-turn navigation.
//
// Wraps expo-location so the navigation session controls accuracy, cadence,
// permissions, and teardown — instead of relying on the RNMapbox `UserLocation`
// puck (which stays only for visual display). Emits the route-progress fix shape
// via the shared, unit-tested `toNavigationFix` mapper.
//
// NOTE: native module — not covered by the node test suite. The pure mapping it
// depends on is tested in tests/test-location-fix.mjs.

import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { toNavigationFix } from "@cycleways/core/navigation/locationFix.js";
import { NAVIGATION_LOCATION_TASK } from "./backgroundTaskName.js";

export const NAVIGATION_BACKGROUND_LOCATION_OPTIONS = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 1000,
  distanceInterval: 5,
  activityType: Location.ActivityType.Fitness,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
};

// One bounded location lookup for ride setup. This is deliberately separate
// from the high-accuracy navigation watch: opening setup must not leave a GPS
// subscription running.
export async function getRideSetupLocation() {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      return { status: "denied", fix: null };
    }

    const cached = await Location.getLastKnownPositionAsync({
      maxAge: 30_000,
      requiredAccuracy: 100,
    });
    const cachedFix = toNavigationFix(cached);
    if (cachedFix) return { status: "ready", fix: cachedFix };

    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const fix = toNavigationFix(current);
    return fix
      ? { status: "ready", fix }
      : { status: "unavailable", fix: null };
  } catch (error) {
    return { status: "unavailable", fix: null, error };
  }
}

// Request the permissions navigation needs. Foreground is always required;
// background is requested only when asked AND after foreground is granted.
export async function requestNavigationPermissions({ background = false } = {}) {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") {
    return { granted: false, background: false, status: foreground.status };
  }
  if (!background || Platform.OS !== "ios") {
    return { granted: true, background: false, status: foreground.status };
  }
  const bg = await Location.requestBackgroundPermissionsAsync();
  return {
    granted: true,
    background: bg.status === "granted",
    status: foreground.status,
  };
}

export async function getNavigationPermissionStatus() {
  const foreground = await Location.getForegroundPermissionsAsync();
  const background = Platform.OS === "ios"
    ? await Location.getBackgroundPermissionsAsync()
    : { status: "undetermined", granted: false };
  return {
    foreground,
    background,
    canUseBackground: foreground.status === "granted" && background.status === "granted",
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

export async function isNavigationBackgroundUpdatesActive() {
  try {
    return await Location.hasStartedLocationUpdatesAsync(NAVIGATION_LOCATION_TASK);
  } catch {
    return false;
  }
}

export async function startNavigationBackgroundUpdates(options = {}) {
  if (Platform.OS !== "ios") return false;
  if (!TaskManager.isTaskDefined(NAVIGATION_LOCATION_TASK)) return false;
  try {
    const available = await TaskManager.isAvailableAsync();
    if (!available) return false;
    const alreadyStarted = await isNavigationBackgroundUpdatesActive();
    if (!alreadyStarted) {
      await Location.startLocationUpdatesAsync(NAVIGATION_LOCATION_TASK, {
        ...NAVIGATION_BACKGROUND_LOCATION_OPTIONS,
        ...options,
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function stopNavigationBackgroundUpdates() {
  try {
    if (await isNavigationBackgroundUpdatesActive()) {
      await Location.stopLocationUpdatesAsync(NAVIGATION_LOCATION_TASK);
    }
  } catch {
    // Best-effort cleanup; the next start/check path revalidates task state.
  }
}

// Default real-GPS location source implementing the injectable locationSource
// interface consumed by useNavigationSession. Returns a fresh wrapper object
// each call so callers can safely hold the reference for the lifetime of one
// navigation session. Swap for createSimulateRideSource (dev-only) in tests.
export function createDefaultLocationSource() {
  return {
    requestPermissions: (opts) => requestNavigationPermissions(opts),
    startWatch: (handlers) => startNavigationWatch(handlers),
  };
}
