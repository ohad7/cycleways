import {
  NAV_ACTIONS,
  createNavigationSession,
} from "@cycleways/core/navigation/navigationSession.js";
import { createNavigationVoicePlanner } from "@cycleways/core/navigation/navigationVoice.js";
import {
  clearActiveNavigationSession,
  loadActiveNavigationSession,
  saveActiveNavigationSession,
} from "./activeNavigationStore.js";
import { stopNavigationBackgroundUpdates } from "./locationService.js";
import { speakUtterance } from "./speechAdapter.js";

const ARRIVAL_BACKGROUND_CONFIRM_MS = 60_000;

let foregroundProcessor = null;
let lastTaskError = null;

function fixTimestamp(fix) {
  const value = Number(fix?.timestamp);
  return Number.isFinite(value) ? value : Date.now();
}

function isArrival(state) {
  return (
    state?.progress?.hasAcquiredRoute === true &&
    Number.isFinite(Number(state?.progress?.remainingMeters)) &&
    Number(state.progress.remainingMeters) <= 15
  );
}

function processBackgroundRequest(session, state) {
  const request = state?.routeRequest;
  if (!request) return state;
  return session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_FAILED,
    requestId: request.requestId,
    reason: "background-no-router",
  });
}

async function persistFromSession(session, record, voicePlanner, latestFix) {
  const state = session.getState();
  const timestamp = fixTimestamp(latestFix || state.latestFix);
  const arrivalDetectedAt =
    isArrival(state)
      ? (Number.isFinite(Number(record.arrivalDetectedAt))
          ? Number(record.arrivalDetectedAt)
          : timestamp)
      : null;
  await saveActiveNavigationSession({
    ...record,
    sessionSnapshot: session.snapshot(),
    voiceMemory: voicePlanner?.snapshot?.() || record.voiceMemory || null,
    lastProcessedFixTimestamp: timestamp,
    arrivalDetectedAt,
  });
  if (
    arrivalDetectedAt !== null &&
    timestamp - arrivalDetectedAt >= ARRIVAL_BACKGROUND_CONFIRM_MS
  ) {
    await stopNavigationBackgroundUpdates();
  }
}

export function registerForegroundNavigationProcessor(processor) {
  foregroundProcessor = typeof processor === "function" ? processor : null;
  return () => {
    if (foregroundProcessor === processor) foregroundProcessor = null;
  };
}

export async function processBackgroundNavigationFixes(fixes = []) {
  const normalizedFixes = (Array.isArray(fixes) ? fixes : [])
    .filter(Boolean)
    .sort((a, b) => fixTimestamp(a) - fixTimestamp(b));
  if (normalizedFixes.length === 0) return false;

  if (foregroundProcessor) {
    await foregroundProcessor(normalizedFixes, { source: "background" });
    return true;
  }

  const record = await loadActiveNavigationSession();
  if (!record) {
    await stopNavigationBackgroundUpdates();
    return false;
  }
  const lastProcessedAt = Number(record.lastProcessedFixTimestamp);
  const freshFixes = Number.isFinite(lastProcessedAt)
    ? normalizedFixes.filter((fix) => fixTimestamp(fix) > lastProcessedAt)
    : normalizedFixes;
  if (freshFixes.length === 0) return true;

  const session = createNavigationSession(record.navigationRoute, {
    snapshot: record.sessionSnapshot,
  });
  const voicePlanner = createNavigationVoicePlanner({
    enabled: record.settings?.voiceEnabled === true,
    memory: record.voiceMemory,
  });

  let latestFix = null;
  for (const fix of freshFixes) {
    latestFix = fix;
    let next = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix });
    next = processBackgroundRequest(session, next);
    if (next.cueEvent && record.settings?.voiceEnabled === true) {
      const plan = voicePlanner.plan(next.cueEvent, next, fixTimestamp(fix));
      if (plan.utterance) await speakUtterance(plan.utterance);
    }
  }
  await persistFromSession(session, record, voicePlanner, latestFix);
  return true;
}

export async function persistForegroundNavigation({
  session,
  navigationRoute,
  settings,
  voicePlanner,
  latestFix,
}) {
  if (!session || !navigationRoute) return false;
  return saveActiveNavigationSession({
    sessionId: settings?.sessionId || `nav-${Date.now()}`,
    navigationRoute,
    settings,
    sessionSnapshot: session.snapshot(),
    voiceMemory: voicePlanner?.snapshot?.() || null,
    lastProcessedFixTimestamp: fixTimestamp(latestFix || session.getState()?.latestFix),
    arrivalDetectedAt: null,
  });
}

export async function clearForegroundNavigation() {
  await clearActiveNavigationSession();
}

export function recordBackgroundNavigationTaskError(error) {
  lastTaskError = {
    message: String(error?.message || error),
    at: Date.now(),
  };
}

export function getBackgroundNavigationDiagnostics() {
  return { lastTaskError };
}
