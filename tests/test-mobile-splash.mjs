import assert from "node:assert/strict";
import {
  MIN_LAUNCH_SPLASH_MS,
  remainingLaunchSplashMs,
  settleWithin,
} from "../apps/mobile/src/splash/bootstrapTiming.js";

assert.equal(MIN_LAUNCH_SPLASH_MS, 1200);
assert.equal(remainingLaunchSplashMs(1000, 1000), 1200);
assert.equal(remainingLaunchSplashMs(1000, 1600), 600);
assert.equal(remainingLaunchSplashMs(1000, 2400), 0);
assert.equal(remainingLaunchSplashMs(2000, 1500), 1200);

assert.deepEqual(await settleWithin(Promise.resolve("ready"), 50), {
  status: "fulfilled",
  value: "ready",
});
assert.equal(
  (await settleWithin(new Promise(() => {}), 5)).status,
  "timeout",
);

console.log("test-mobile-splash: ok");
