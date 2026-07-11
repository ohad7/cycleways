// Lock-screen voice soak test (design D12, plans/navigation-ride-feedback).
//
// Reproduces the "silent under lock" failure indoors: starts the same
// background location updates a real ride uses (that is what keeps the app
// alive while the screen is locked) and speaks a numbered prompt every 10 s.
// The rider locks the phone and listens; on unlock the ride-setup sheet shows
// instrumented results from the speech diagnostics.
//
// NOTE: native glue — not covered by the node test suite.

import {
  getSpeechDiagnostics,
  speakUtterance,
} from "./speechAdapter.js";
import {
  requestNavigationPermissions,
  startNavigationBackgroundUpdates,
  stopNavigationBackgroundUpdates,
} from "./locationService.js";

export const LOCK_SCREEN_TEST_TICKS = 12;
export const LOCK_SCREEN_TEST_INTERVAL_MS = 10_000;

let run = null;
let snapshot = { status: "idle" };
const listeners = new Set();

function diagnosticsDelta(baseline) {
  const now = getSpeechDiagnostics();
  return {
    attempts: now.attempts - baseline.attempts,
    completed: now.completed - baseline.completed,
    errors: now.errors - baseline.errors,
    activationErrors: now.activationErrors - baseline.activationErrors,
    lastError: now.errors > baseline.errors ? now.lastError : null,
  };
}

function publish() {
  snapshot = !run
    ? { status: "idle" }
    : {
        status: run.status,
        tick: run.tick,
        totalTicks: LOCK_SCREEN_TEST_TICKS,
        backgroundUpdates: run.backgroundUpdates,
        permissionSpike: run.permissionSpike,
        error: run.error,
        results: diagnosticsDelta(run.baseline),
      };
  for (const listener of listeners) listener(snapshot);
}

export function getLockScreenVoiceTestSnapshot() {
  return snapshot;
}

export function subscribeLockScreenVoiceTest(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function finishRun(status) {
  if (!run) return;
  if (run.timer) {
    clearInterval(run.timer);
    run.timer = null;
  }
  run.status = status;
  await stopNavigationBackgroundUpdates();
  publish();
  // The last utterance settles a few seconds after it starts; refresh the
  // published results once so the final spoken/error counts are accurate.
  setTimeout(publish, 4000);
}

async function handleTick() {
  if (!run || run.status !== "running") return;
  run.tick += 1;
  const tick = run.tick;
  await speakUtterance({
    utteranceId: `lock-screen-test-${tick}`,
    text: `בדיקה מספר ${tick}`,
    language: "he-IL",
  });
  if (run && run.tick >= LOCK_SCREEN_TEST_TICKS) {
    await finishRun("finished");
  } else {
    publish();
  }
}

export async function startLockScreenVoiceTest() {
  if (run?.status === "running") return snapshot;
  run = {
    status: "running",
    tick: 0,
    backgroundUpdates: false,
    permissionSpike: null,
    error: null,
    baseline: getSpeechDiagnostics(),
    timer: null,
  };
  publish();

  let permission;
  try {
    permission = await requestNavigationPermissions({ background: true });
  } catch {
    permission = { granted: false, background: false };
  }
  if (!permission.granted) {
    run.error = "location-permission";
    await finishRun("error");
    return snapshot;
  }
  run.permissionSpike = permission.permissionSpike || null;
  run.backgroundUpdates = permission.background
    ? await startNavigationBackgroundUpdates()
    : false;

  await speakUtterance({
    utteranceId: "lock-screen-test-intro",
    text: "מתחילים בדיקת קול למסך נעול. נעלו את המסך עכשיו.",
    language: "he-IL",
    interruptsCurrentSpeech: true,
  });
  if (!run || run.status !== "running") return snapshot;
  run.timer = setInterval(() => {
    void handleTick();
  }, LOCK_SCREEN_TEST_INTERVAL_MS);
  publish();
  return snapshot;
}

export async function stopLockScreenVoiceTest() {
  if (!run || run.status !== "running") return snapshot;
  await finishRun("finished");
  return snapshot;
}
