export function isAppForegroundForHeadlessSpeech(appState) {
  return appState !== "background";
}

export function createNavigationFinalizer({
  stopWatch,
  stopBackgroundUpdates,
  deactivateKeepAwake,
  stopSpeech,
  clearPersisted,
}) {
  let inFlight = null;
  let complete = false;

  return function finalizeNavigation() {
    if (complete) return Promise.resolve(false);
    if (inFlight) return inFlight;
    const steps = [
      stopWatch,
      stopBackgroundUpdates,
      deactivateKeepAwake,
      stopSpeech,
      clearPersisted,
    ];
    inFlight = Promise.allSettled(
      steps.map((step) => Promise.resolve().then(() => step?.())),
    ).then(() => {
      complete = true;
      return true;
    });
    return inFlight;
  };
}
