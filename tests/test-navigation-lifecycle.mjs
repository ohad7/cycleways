import assert from "node:assert/strict";
import {
  createNavigationFinalizer,
  isAppForegroundForHeadlessSpeech,
} from "../apps/mobile/src/navigation/navigationLifecycle.js";

assert.equal(isAppForegroundForHeadlessSpeech("active"), true);
assert.equal(isAppForegroundForHeadlessSpeech("inactive"), true);
assert.equal(isAppForegroundForHeadlessSpeech(null), true);
assert.equal(isAppForegroundForHeadlessSpeech("background"), false);

const calls = new Map();
const call = (name, { reject = false } = {}) => async () => {
  calls.set(name, (calls.get(name) || 0) + 1);
  if (reject) throw new Error(name);
};
const finalize = createNavigationFinalizer({
  stopWatch: call("watch"),
  stopBackgroundUpdates: call("background", { reject: true }),
  deactivateKeepAwake: call("awake"),
  stopSpeech: call("speech"),
  clearPersisted: call("persisted"),
});
const first = finalize();
const second = finalize();
assert.equal(first, second, "concurrent finalization shares one promise");
assert.equal(await first, true);
assert.equal(await finalize(), false, "completed finalization is a no-op");
for (const name of ["watch", "background", "awake", "speech", "persisted"]) {
  assert.equal(calls.get(name), 1, `${name} cleanup runs exactly once`);
}

console.log("navigation lifecycle tests passed");
