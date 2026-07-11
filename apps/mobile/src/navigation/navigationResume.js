const RESUMABLE_STATUSES = new Set([
  "navigating",
  "approaching",
  "off-route",
  "paused",
]);

export function createNavigationResumeCoordinator({
  loadRecord,
  createSession,
  installSession,
  beginWatch,
  startBackgroundUpdates,
  stopBackgroundUpdates,
  activateKeepAwake,
  deactivateKeepAwake,
  clearPersisted,
  markForegroundOnly,
  setBackgroundActive,
}) {
  let requestKey = null;
  let inFlight = null;

  async function fail(reason) {
    await Promise.allSettled([
      Promise.resolve().then(() => clearPersisted?.()),
      Promise.resolve().then(() => stopBackgroundUpdates?.()),
      Promise.resolve().then(() => deactivateKeepAwake?.()),
    ]);
    return { status: "failed", reason };
  }

  function activate({ navigationRoute, sessionId, sessionOptions = {} }) {
    const key = `${sessionId || ""}:${navigationRoute?.id || ""}`;
    if (inFlight && key === requestKey) return inFlight;
    requestKey = key;
    inFlight = (async () => {
      try {
        const record = await loadRecord?.();
        if (!record || record.sessionId !== sessionId) return fail("session-mismatch");
        if (!navigationRoute?.id || record.navigationRoute?.id !== navigationRoute.id) {
          return fail("route-mismatch");
        }
        const session = createSession(navigationRoute, {
          ...sessionOptions,
          snapshot: record.sessionSnapshot,
        });
        const restoredState = session?.getState?.();
        if (!session || !RESUMABLE_STATUSES.has(restoredState?.status)) {
          return fail("invalid-snapshot");
        }

        installSession(session, record);
        if (restoredState.status === "paused") {
          await Promise.allSettled([
            Promise.resolve().then(() => stopBackgroundUpdates?.()),
            Promise.resolve().then(() => deactivateKeepAwake?.()),
          ]);
          setBackgroundActive?.(false);
          return { status: "restored", paused: true, backgroundActive: false };
        }

        let backgroundActive = false;
        if (restoredState.backgroundLocation === true) {
          backgroundActive = (await startBackgroundUpdates?.()) === true;
        } else {
          await stopBackgroundUpdates?.();
        }

        if (backgroundActive) {
          await deactivateKeepAwake?.();
        } else {
          markForegroundOnly?.(session);
          await activateKeepAwake?.();
        }
        setBackgroundActive?.(backgroundActive);
        beginWatch?.();
        return { status: "restored", paused: false, backgroundActive };
      } catch (error) {
        return fail(error?.message || "restore-error");
      }
    })();
    return inFlight;
  }

  return { activate };
}
