// Speech output for turn-by-turn navigation, thin glue over expo-speech +
// expo-audio.
//
// Lock-screen speech (design D11, plans/navigation-ride-feedback): iOS only
// implicitly activates an audio session for foreground apps, and neither
// expo-speech (AVSpeechSynthesizer with usesApplicationAudioSession=true) nor
// expo-audio's setAudioModeAsync ever activates it. So the session is
// explicitly activated before each utterance and released after a short
// linger once all utterances settle — otherwise other audio stays ducked.
// Timing decisions live in the pure, node-tested speechAudioSessionPolicy.
//
// NOTE: native module — not covered by the node test suite.

import * as Speech from "expo-speech";
import { setAudioModeAsync, setIsAudioActiveAsync } from "expo-audio";
import { createSpeechAudioSessionPolicy } from "@cycleways/core/navigation/speechAudioSessionPolicy.js";

const SESSION_LINGER_MS = 1500;
// If speech callbacks never fire (observed as a background failure mode), the
// utterance is force-settled so the session (and ducking) cannot stay stuck.
const UTTERANCE_SETTLE_TIMEOUT_MS = 30_000;
const RECENT_EVENTS_LIMIT = 20;

let audioConfigured = false;
const sessionPolicy = createSpeechAudioSessionPolicy({ lingerMs: SESSION_LINGER_MS });
let deactivateTimer = null;
let utteranceCounter = 0;

const stats = {
  attempts: 0,
  completed: 0,
  errors: 0,
  lastError: null,
  activations: 0,
  activationErrors: 0,
};
const recentEvents = [];

function recordEvent(event) {
  recentEvents.push({ ...event, at: Date.now() });
  if (recentEvents.length > RECENT_EVENTS_LIMIT) recentEvents.shift();
}

function recordError(error) {
  stats.errors += 1;
  stats.lastError = String(error?.message || error);
}

export async function configureForNavigationAudio() {
  if (audioConfigured) return true;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "duckOthers",
      shouldPlayInBackground: true,
    });
    audioConfigured = true;
    return true;
  } catch (error) {
    recordError(error);
    return false;
  }
}

async function activateSessionForUtterance() {
  const { shouldActivate } = sessionPolicy.onSpeakRequested();
  if (!shouldActivate) return;
  try {
    await setIsAudioActiveAsync(true);
    stats.activations += 1;
  } catch (error) {
    stats.activationErrors += 1;
    stats.lastError = String(error?.message || error);
    recordEvent({ kind: "activation-error", error: stats.lastError });
    // Retry activation on the next speak instead of assuming the session is up.
    sessionPolicy.onDeactivated();
  }
}

function scheduleSessionRelease() {
  if (deactivateTimer) clearTimeout(deactivateTimer);
  deactivateTimer = setTimeout(() => {
    deactivateTimer = null;
    if (!sessionPolicy.shouldDeactivateNow(Date.now())) return;
    sessionPolicy.onDeactivated();
    // notifyOthersOnDeactivation inside expo-audio un-ducks other audio.
    setIsAudioActiveAsync(false).catch(() => {});
  }, SESSION_LINGER_MS + 50);
}

// One settle per utterance, whichever callback fires first.
function createSettler(utteranceId, events = {}) {
  let settled = false;
  const timeout = setTimeout(
    () => settle("timeout", new Error("speech callbacks never fired")),
    UTTERANCE_SETTLE_TIMEOUT_MS,
  );
  function settle(outcome, error) {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (outcome === "done" || outcome === "stopped") {
      stats.completed += 1;
    } else {
      recordError(error || new Error(outcome));
    }
    recordEvent({
      kind: "utterance",
      utteranceId,
      outcome,
      error: error ? String(error?.message || error) : null,
    });
    sessionPolicy.onUtteranceSettled(Date.now());
    scheduleSessionRelease();
    if (outcome === "done") events.onDone?.();
    else if (outcome === "stopped") events.onStopped?.();
    else events.onError?.(error || new Error(outcome));
  }
  return settle;
}

export async function speakUtterance(utterance, events = {}) {
  if (!utterance?.text) return false;
  stats.attempts += 1;
  await configureForNavigationAudio();
  utteranceCounter += 1;
  const utteranceId = utterance.utteranceId || `utterance-${utteranceCounter}`;
  const settle = createSettler(utteranceId, events);
  try {
    if (utterance.interruptsCurrentSpeech) {
      await Speech.stop();
    }
    await activateSessionForUtterance();
    Speech.speak(utterance.text, {
      language: utterance.language || "he-IL",
      rate: 0.92,
      volume: 1,
      onStart: () => events.onStart?.(),
      onDone: () => settle("done"),
      onStopped: () => settle("stopped"),
      onError: (error) => settle("error", error),
    });
    return true;
  } catch (error) {
    settle("error", error);
    return false;
  }
}

export async function stopNavigationSpeech() {
  try {
    await Speech.stop();
  } catch {
    // Speech stop is best-effort during navigation teardown.
  }
}

export async function speakSampleNavigationPrompt() {
  return speakUtterance({
    utteranceId: "sample",
    text: "בעוד 200 מטרים, פנה ימינה",
    language: "he-IL",
    priority: 3,
    interruptsCurrentSpeech: true,
  });
}

export function getSpeechDiagnostics() {
  const session = sessionPolicy.snapshot();
  return {
    ...stats,
    audioConfigured,
    sessionActive: session.active,
    inFlight: session.inFlight,
    recentEvents: [...recentEvents],
  };
}
