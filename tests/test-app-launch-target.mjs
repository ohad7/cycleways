import assert from "node:assert/strict";
import { launchTargetFromHref } from "../apps/mobile/src/navigation/launchTarget.js";

// A bare launch (no route) opens Discover.
assert.deepEqual(launchTargetFromHref("cycleways:///"), {
  screen: "Discover",
  params: undefined,
});
assert.deepEqual(launchTargetFromHref(null), {
  screen: "Discover",
  params: undefined,
});

// A routes/<slug> deep link opens RouteDetail with the slug.
assert.deepEqual(
  launchTargetFromHref("cycleways:///routes/sovev-beit-hillel"),
  { screen: "RouteDetail", params: { slug: "sovev-beit-hillel" } },
);

// A featured/<slug> deep link also opens RouteDetail with the slug.
assert.deepEqual(
  launchTargetFromHref("cycleways:///featured/banias-gan-hatsafon"),
  { screen: "RouteDetail", params: { slug: "banias-gan-hatsafon" } },
);

console.log("test-app-launch-target: ok");
