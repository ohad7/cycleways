import assert from "node:assert/strict";
import { routeRestoreDecision } from "../apps/mobile/src/navigation/routeRestorePolicy.js";

assert.equal(routeRestoreDecision(null, "initializing"), "idle");
assert.equal(routeRestoreDecision("encoded-route", "initializing"), "wait");
assert.equal(routeRestoreDecision("encoded-route", "ready"), "load");

console.log("test-mobile-route-restore: ok");
