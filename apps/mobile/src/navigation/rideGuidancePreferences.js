import * as FileSystem from "expo-file-system/legacy";
import {
  DEFAULT_RIDE_GUIDANCE_PREFERENCES,
  normalizeRideGuidancePreferences,
} from "@cycleways/core/navigation/rideGuidancePreferences.js";

export {
  DEFAULT_RIDE_GUIDANCE_PREFERENCES,
  normalizeRideGuidancePreferences,
};

const FILE_URI = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}ride-guidance-preferences.json`
  : null;

export async function loadRideGuidancePreferences() {
  if (!FILE_URI) return { ...DEFAULT_RIDE_GUIDANCE_PREFERENCES };
  try {
    const info = await FileSystem.getInfoAsync(FILE_URI);
    if (!info.exists) return { ...DEFAULT_RIDE_GUIDANCE_PREFERENCES };
    return normalizeRideGuidancePreferences(
      JSON.parse(await FileSystem.readAsStringAsync(FILE_URI)),
    );
  } catch {
    return { ...DEFAULT_RIDE_GUIDANCE_PREFERENCES };
  }
}

export async function saveRideGuidancePreferences(value) {
  if (!FILE_URI) return false;
  try {
    await FileSystem.writeAsStringAsync(
      FILE_URI,
      JSON.stringify(normalizeRideGuidancePreferences(value)),
    );
    return true;
  } catch {
    return false;
  }
}
