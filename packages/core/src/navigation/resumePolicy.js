// Pure resume/headless-voice policy (plans/navigation-ride-feedback-2, R3/R4).
// Native callers provide timestamps and app activity; keeping these decisions
// here makes their boundary and invalid-input behavior deterministic.

export const RESUME_HOT_MAX_AGE_MS = 10 * 60 * 1000;
export const RESUME_WARM_MAX_AGE_MS = 60 * 60 * 1000;
const RESUMABLE_STATUSES = new Set([
  "navigating",
  "approaching",
  "off-route",
  "paused",
]);

// hot: crashed moments ago, mid-ride — auto-resume into the navigation UI.
// warm: recent — prompt to continue or end.
// stale: too old — clear silently. none: nothing usable was persisted.
export function classifyResumeRecord(record, now = Date.now()) {
  if (
    !record?.sessionId ||
    !record?.sessionSnapshot ||
    !record?.navigationRoute?.id ||
    !record?.navigationRoute?.routeParam
  ) {
    return "none";
  }
  if (!RESUMABLE_STATUSES.has(record.sessionSnapshot?.state?.status)) return "none";

  const rawLast = record.lastProcessedFixTimestamp;
  if (rawLast === null || rawLast === undefined || rawLast === "") {
    return "none";
  }
  const last = Number(rawLast);
  if (!Number.isFinite(last)) return "none";

  const age = now - last;
  if (age < 0) return "none";
  if (age <= RESUME_HOT_MAX_AGE_MS) return "hot";
  if (age <= RESUME_WARM_MAX_AGE_MS) return "warm";
  return "stale";
}

// Headless cues exist for the locked screen; a rider looking at the app on
// another screen must not hear guidance from a hidden ride.
export function shouldSpeakHeadlessCue({ appActive = false } = {}) {
  return appActive !== true;
}

export function activeRideLaunchDecision(
  record,
  { initialUrl = null, now = Date.now() } = {},
) {
  const resumeClass = classifyResumeRecord(record, now);
  if (resumeClass === "hot") {
    return { action: "resume", resumeClass, deferredUrl: null };
  }
  if (resumeClass === "warm") {
    return { action: "prompt", resumeClass, deferredUrl: initialUrl || null };
  }
  return { action: "continue", resumeClass, deferredUrl: initialUrl || null };
}
