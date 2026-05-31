import assert from "node:assert/strict";
import {
  getNativeLocationHref,
  getQueryParam,
  getShardLoaderLocation,
  hasQueryParam,
  removeUrlParam,
  resetNativeLocationHref,
  setNativeLocationHref,
  setUrlParam,
} from "@cycleways/core/platform/location.native.js";

resetNativeLocationHref();
assert.equal(getNativeLocationHref(), "cycleways:///");
assert.equal(getQueryParam("route"), null);
assert.equal(hasQueryParam("route"), false);

setNativeLocationHref("cycleways:///?route=abc123&osmLayer=graph");
assert.equal(getQueryParam("route"), "abc123");
assert.equal(hasQueryParam("route"), true);
assert.equal(getQueryParam("osmLayer"), "graph");
assert.equal(getShardLoaderLocation().href, "cycleways:///");

setUrlParam("route", "next456");
assert.equal(getQueryParam("route"), "next456");
assert.equal(getNativeLocationHref(), "cycleways:///?route=next456&osmLayer=graph");

removeUrlParam("route");
assert.equal(getQueryParam("route"), null);
assert.equal(hasQueryParam("route"), false);
assert.equal(getNativeLocationHref(), "cycleways:///?osmLayer=graph");

setNativeLocationHref("?route=relative");
assert.equal(getNativeLocationHref(), "cycleways:///?route=relative");
assert.equal(getQueryParam("route"), "relative");

setNativeLocationHref("app.cycleways.mobile:///?route=devclient");
assert.equal(getQueryParam("route"), "devclient");
assert.equal(getShardLoaderLocation().href, "cycleways:///");

setNativeLocationHref("http://[invalid");
assert.equal(getNativeLocationHref(), "cycleways:///");
assert.equal(getQueryParam("route"), null);

console.log("✅ test-native-location passed");
