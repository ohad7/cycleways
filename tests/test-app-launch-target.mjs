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

// A shared route token opens the native planner on cold and warm launches.
const sharedRouteToken =
  "G9EAbKv36BT1q3pviFXF8P6DjGtxVveQfibUxKcathBHzr8xYcBLhiq5c6ouAbrMjTk6gKWjg5jQAayU";
assert.deepEqual(
  launchTargetFromHref(`cycleways:///?route=${sharedRouteToken}`),
  { screen: "Build", params: { routeToken: sharedRouteToken } },
);

console.log("test-app-launch-target: ok");
