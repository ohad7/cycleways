import * as FileSystem from "expo-file-system/legacy";

const FILE_URI = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}active-navigation-session.json`
  : null;
const SCHEMA_VERSION = 1;
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export async function saveActiveNavigationSession(record) {
  if (!FILE_URI || !record?.navigationRoute || !record?.sessionSnapshot) {
    return false;
  }
  const payload = {
    version: SCHEMA_VERSION,
    savedAt: Date.now(),
    ...record,
  };
  try {
    await FileSystem.writeAsStringAsync(FILE_URI, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
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
    const lastFixAt = Number(parsed.lastProcessedFixTimestamp);
    const freshnessAnchor = Number.isFinite(lastFixAt) ? lastFixAt : savedAt;
    if (!Number.isFinite(freshnessAnchor) || now - freshnessAnchor > STALE_AFTER_MS) {
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
  try {
    const info = await FileSystem.getInfoAsync(FILE_URI);
    if (info.exists) await FileSystem.deleteAsync(FILE_URI, { idempotent: true });
  } catch {
    // Best-effort cleanup; stale files are revalidated on load.
  }
}
