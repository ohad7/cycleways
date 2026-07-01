import * as FileSystem from "expo-file-system/legacy";
import { normalizePendingRideIntent } from "@cycleways/core/navigation/pendingRidePlan.js";

const FILE_URI = `${FileSystem.documentDirectory}pending-ride-plan.json`;

export async function savePendingRideIntent(intent) {
  const normalized = normalizePendingRideIntent(
    { ...intent, timestamp: Date.now() },
    Date.now(),
  );
  if (!normalized || !FILE_URI) return false;
  try {
    await FileSystem.writeAsStringAsync(FILE_URI, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export async function loadPendingRideIntent() {
  if (!FILE_URI) return null;
  try {
    const info = await FileSystem.getInfoAsync(FILE_URI);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(FILE_URI));
    const normalized = normalizePendingRideIntent(parsed);
    if (!normalized) await clearPendingRideIntent();
    return normalized;
  } catch {
    await clearPendingRideIntent();
    return null;
  }
}

export async function clearPendingRideIntent() {
  if (!FILE_URI) return;
  try {
    const info = await FileSystem.getInfoAsync(FILE_URI);
    if (info.exists) await FileSystem.deleteAsync(FILE_URI, { idempotent: true });
  } catch {
    // Restoration is best-effort; a stale file is harmless and revalidated.
  }
}
