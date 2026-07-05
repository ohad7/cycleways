import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
} from "expo-keep-awake";

const NAVIGATION_KEEP_AWAKE_TAG = "cycleways-navigation";

export async function activateNavigationKeepAwake() {
  try {
    await activateKeepAwakeAsync(NAVIGATION_KEEP_AWAKE_TAG);
    return true;
  } catch {
    return false;
  }
}

export async function deactivateNavigationKeepAwake() {
  try {
    await deactivateKeepAwake(NAVIGATION_KEEP_AWAKE_TAG);
  } catch {
    // Best-effort; the OS releases this when the process exits.
  }
}
