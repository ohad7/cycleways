import {
  NAV_ACTIONS,
  createNavigationSession,
} from "@cycleways/core/navigation/navigationSession.js";
import { createNavigationVoicePlanner } from "@cycleways/core/navigation/navigationVoice.js";
import { shouldSpeakHeadlessCue } from "@cycleways/core/navigation/resumePolicy.js";
import { AppState } from "react-native";
import {
  clearActiveNavigationSession,
  loadActiveNavigationSession,
  saveActiveNavigationSession,
} from "./activeNavigationStore.js";
import { stopNavigationBackgroundUpdates } from "./locationService.js";
import { speakUtterance } from "./speechAdapter.js";
import { isAppForegroundForHeadlessSpeech } from "./navigationLifecycle.js";

let foregroundProcessor = null;
let lastTaskError = null;
const defaultAppActiveProbe = () =>
  isAppForegroundForHeadlessSpeech(AppState.currentState);
let appActiveProbe = defaultAppActiveProbe;

function fixTimestamp(fix) {
  const value = Number(fix?.timestamp);
  return Number.isFinite(value) ? value : Date.now();
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
  // The store queue serializes file operations, but this save's payload was
  // built from a record loaded before the (async) fix processing above. If the
  // foreground stopped the ride in that window, saving would resurrect it —
  // re-check the store still holds this session before writing.
  const current = await loadActiveNavigationSession();
  if (!current || (record.sessionId && current.sessionId !== record.sessionId)) {
    return;
  }
  const state = session.getState();
  const timestamp = fixTimestamp(latestFix || state.latestFix);
  await saveActiveNavigationSession({
    ...record,
    sessionSnapshot: session.snapshot(),
    voiceMemory: voicePlanner?.snapshot?.() || record.voiceMemory || null,
    lastProcessedFixTimestamp: timestamp,
  });
}

export function setNavigationRuntimeAppActiveProbe(probe) {
  appActiveProbe = typeof probe === "function" ? probe : defaultAppActiveProbe;
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
    const handled = await foregroundProcessor(normalizedFixes, { source: "background" });
    if (handled !== false) return true;
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
    if (
      next.cueEvent &&
      record.settings?.voiceEnabled === true &&
      shouldSpeakHeadlessCue({ appActive: appActiveProbe() })
    ) {
      const plan = voicePlanner.plan(next.cueEvent, next, fixTimestamp(fix));
      if (plan.utterance) await speakUtterance(plan.utterance);
    }
    if (next.status === "ended") {
      await clearActiveNavigationSession();
      await stopNavigationBackgroundUpdates();
      return true;
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
