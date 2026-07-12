import assert from "node:assert/strict";
import {
  createNativeRouteHref,
  getNativeLocationHref,
  getNativePathname,
  getQueryParam,
  getNativeRoutePath,
  getNativeRouteToken,
  getShardLoaderLocation,
  hasQueryParam,
  removeUrlParam,
  resetNativeLocationHref,
  setNativeLocationHref,
  setUrlParam,
} from "@cycleways/core/platform/location.native.js";

resetNativeLocationHref();
assert.equal(getNativeLocationHref(), "cycleways:///");
assert.equal(getNativePathname(), "/");
assert.equal(getNativeRoutePath(), null);
assert.equal(getQueryParam("route"), null);
assert.equal(hasQueryParam("route"), false);

setNativeLocationHref("cycleways:///?route=abc123&source=test");
assert.equal(getQueryParam("route"), "abc123");
assert.equal(getNativeRouteToken(), "abc123");
assert.equal(getNativeRouteToken("cycleways:///?route=from-href"), "from-href");
assert.equal(getNativeRouteToken("https://example.com/?route=external"), null);
assert.equal(hasQueryParam("route"), true);
assert.equal(getQueryParam("source"), "test");
assert.equal(getShardLoaderLocation().href, "cycleways:///");

setUrlParam("route", "next456");
assert.equal(getQueryParam("route"), "next456");
assert.equal(getNativeLocationHref(), "cycleways:///?route=next456&source=test");

removeUrlParam("route");
assert.equal(getQueryParam("route"), null);
assert.equal(hasQueryParam("route"), false);
assert.equal(getNativeLocationHref(), "cycleways:///?source=test");

setNativeLocationHref("?route=relative");
assert.equal(getNativeLocationHref(), "cycleways:///?route=relative");
assert.equal(getQueryParam("route"), "relative");

setNativeLocationHref("app.cycleways.mobile:///?route=devclient");
assert.equal(getQueryParam("route"), "devclient");
assert.equal(getShardLoaderLocation().href, "cycleways:///");

assert.equal(
  getNativePathname("cycleways:///routes/sovev-beit-hillel"),
  "/routes/sovev-beit-hillel",
);
assert.deepEqual(
  getNativeRoutePath("cycleways:///routes/sovev-beit-hillel"),
  { collection: "routes", slug: "sovev-beit-hillel" },
);
assert.deepEqual(
  getNativeRoutePath("cycleways:///featured/banias-gan-hatsafon"),
  { collection: "featured", slug: "banias-gan-hatsafon" },
);
assert.deepEqual(
  getNativeRoutePath("cycleways://routes/sovev-beit-hillel"),
  { collection: "routes", slug: "sovev-beit-hillel" },
);
assert.deepEqual(
  getNativeRoutePath("app.cycleways.mobile://routes/sovev-beit-hillel"),
  { collection: "routes", slug: "sovev-beit-hillel" },
);
assert.deepEqual(
  getNativeRoutePath("https://www.cycleways.app/routes/sovev-beit-hillel"),
  { collection: "routes", slug: "sovev-beit-hillel" },
);
assert.deepEqual(
  getNativeRoutePath("https://www.cycleways.app/featured/banias-gan-hatsafon"),
  { collection: "featured", slug: "banias-gan-hatsafon" },
);
assert.deepEqual(
  getNativeRoutePath("https://cycleways.app/routes/sovev-beit-hillel"),
  { collection: "routes", slug: "sovev-beit-hillel" },
);
assert.equal(getNativeRoutePath("https://www.cycleways.app/routes"), null);
assert.equal(getNativeRoutePath("https://www.cycleways.app/about"), null);
assert.equal(
  getNativeRoutePath("https://example.com/routes/sovev-beit-hillel"),
  null,
);

const catalogHref = createNativeRouteHref("encoded-route", {
  source: "catalog",
  collection: "routes",
  slug: "sovev-beit-hillel",
  name: "סובב בית הלל",
});
setNativeLocationHref(catalogHref);
assert.equal(getQueryParam("route"), "encoded-route");
assert.equal(getQueryParam("routeSource"), "catalog");
assert.equal(getQueryParam("routeCollection"), "routes");
assert.equal(getQueryParam("routeSlug"), "sovev-beit-hillel");
assert.equal(getQueryParam("routeName"), "סובב בית הלל");

setNativeLocationHref("http://[invalid");
assert.equal(getNativeLocationHref(), "cycleways:///");
assert.equal(getQueryParam("route"), null);

console.log("✅ test-native-location passed");
