import * as Speech from "expo-speech";
import { setAudioModeAsync } from "expo-audio";

let audioConfigured = false;
const stats = {
  attempts: 0,
  completed: 0,
  errors: 0,
  lastError: null,
};

export async function configureForNavigationAudio() {
  if (audioConfigured) return true;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "duckOthers",
    });
    audioConfigured = true;
    return true;
  } catch (error) {
    stats.errors += 1;
    stats.lastError = String(error?.message || error);
    return false;
  }
}

export async function speakUtterance(utterance) {
  if (!utterance?.text) return false;
  stats.attempts += 1;
  await configureForNavigationAudio();
  try {
    if (utterance.interruptsCurrentSpeech) {
      await Speech.stop();
    }
    Speech.speak(utterance.text, {
      language: utterance.language || "he-IL",
      rate: 0.92,
      volume: 1,
      onDone: () => {
        stats.completed += 1;
      },
      onStopped: () => {
        stats.completed += 1;
      },
      onError: (error) => {
        stats.errors += 1;
        stats.lastError = String(error?.message || error);
      },
    });
    return true;
  } catch (error) {
    stats.errors += 1;
    stats.lastError = String(error?.message || error);
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
    text: "בעוד 200 מטר, פנה ימינה",
    language: "he-IL",
    priority: 3,
    interruptsCurrentSpeech: true,
  });
}

export function getSpeechDiagnostics() {
  return { ...stats, audioConfigured };
}
