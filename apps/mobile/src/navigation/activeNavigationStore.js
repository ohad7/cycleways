import * as FileSystem from "expo-file-system/legacy";
import {
  createNavigationPersistenceCoordinator,
  isNavigationSnapshotFresh,
} from "@cycleways/core/navigation/persistencePolicy.js";

const FILE_URI = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}active-navigation-session.json`
  : null;
const SCHEMA_VERSION = 1;
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

async function applyStoreOperation(operation) {
  if (!FILE_URI) return false;
  if (operation.kind === "save") {
    try {
      await FileSystem.writeAsStringAsync(
        FILE_URI,
        JSON.stringify(operation.payload),
      );
      return true;
    } catch {
      return false;
    }
  }
  if (operation.kind === "clear") {
    try {
      const info = await FileSystem.getInfoAsync(FILE_URI);
      if (info.exists) {
        await FileSystem.deleteAsync(FILE_URI, { idempotent: true });
      }
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// Save and clear share one queue so a slow older file write cannot land after
// a newer snapshot's. The queue only orders the writes themselves — a payload
// built from pre-clear state and requested after a clear still wins, which the
// background path guards separately (see persistFromSession's re-check).
const storeCoordinator = createNavigationPersistenceCoordinator(
  applyStoreOperation,
);

export async function saveActiveNavigationSession(record) {
  if (!FILE_URI || !record?.navigationRoute || !record?.sessionSnapshot) {
    return false;
  }
  const payload = {
    ...record,
    version: SCHEMA_VERSION,
    savedAt: Date.now(),
  };
  return storeCoordinator.request({
    kind: "save",
    payload,
  });
}

export async function loadActiveNavigationSession(now = Date.now()) {
  if (!FILE_URI) return null;
  try {
    const info = await FileSystem.getInfoAsync(FILE_URI);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(FILE_URI));
    if (parsed?.version !== SCHEMA_VERSION) {
      await clearActiveNavigationSession();
      return null;
    }
    const savedAt = Number(parsed.savedAt);
    // Storage freshness is a wall-clock concern. Fix timestamps are retained
    // for dedupe, but may be synthetic in the journey harness.
    if (
      !isNavigationSnapshotFresh({
        savedAtMs: savedAt,
        nowMs: now,
        staleAfterMs: STALE_AFTER_MS,
      })
    ) {
      await clearActiveNavigationSession();
      return null;
    }
    if (!parsed.navigationRoute || !parsed.sessionSnapshot) {
      await clearActiveNavigationSession();
      return null;
    }
    return parsed;
  } catch {
    await clearActiveNavigationSession();
    return null;
  }
}

export async function clearActiveNavigationSession() {
  if (!FILE_URI) return;
  await storeCoordinator.request({ kind: "clear" });
}
