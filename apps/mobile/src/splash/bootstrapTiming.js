export const MIN_LAUNCH_SPLASH_MS = 1200;
export const SERVER_PRELOAD_BUDGET_MS = 900;

export function remainingLaunchSplashMs(
  startedAt,
  now = Date.now(),
  minimumMs = MIN_LAUNCH_SPLASH_MS,
) {
  const elapsed = Math.max(0, Number(now) - Number(startedAt));
  return Math.max(0, Number(minimumMs) - elapsed);
}

export function waitForLaunchSplashMinimum(
  startedAt,
  now = Date.now(),
  minimumMs = MIN_LAUNCH_SPLASH_MS,
) {
  const remaining = remainingLaunchSplashMs(startedAt, now, minimumMs);
  return remaining > 0
    ? new Promise((resolve) => setTimeout(resolve, remaining))
    : Promise.resolve();
}

export function settleWithin(promise, timeoutMs) {
  return Promise.race([
    Promise.resolve(promise).then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    ),
    new Promise((resolve) =>
      setTimeout(() => resolve({ status: "timeout" }), Math.max(0, timeoutMs)),
    ),
  ]);
}
