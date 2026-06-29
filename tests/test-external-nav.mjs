import assert from "node:assert/strict";
import { buildExternalNavLinks } from "@cycleways/core/navigation/externalNav.js";

assert.equal(buildExternalNavLinks(null), null);
assert.equal(buildExternalNavLinks({ lat: NaN, lng: 1 }), null);

const links = buildExternalNavLinks({ lat: 32.123456, lng: 35.654321 });
assert.match(links.googleMaps, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&/);
assert.match(links.googleMaps, /destination=32\.123456%2C35\.654321/);
assert.match(links.googleMaps, /travelmode=bicycling/);
assert.match(links.waze, /^https:\/\/waze\.com\/ul\?/);
assert.match(links.waze, /ll=32\.123456%2C35\.654321/);
assert.match(links.waze, /navigate=yes/);

console.log("external-nav ok");
