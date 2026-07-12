import assert from "node:assert/strict";
import {
  RESUME_HOT_MAX_AGE_MS,
  RESUME_WARM_MAX_AGE_MS,
  activeRideLaunchDecision,
  classifyResumeRecord,
  shouldSpeakHeadlessCue,
} from "@cycleways/core/navigation/resumePolicy.js";

const NOW = 1_800_000_000_000;
const record = (ageMs) => ({
  sessionId: "s1",
  sessionSnapshot: { version: 1, state: { status: "navigating" } },
  navigationRoute: { id: "r1", routeParam: "encoded-route" },
  lastProcessedFixTimestamp: NOW - ageMs,
});

// Exact age boundaries are inclusive.
assert.equal(classifyResumeRecord(record(0), NOW), "hot");
assert.equal(classifyResumeRecord(record(60_000), NOW), "hot");
assert.equal(classifyResumeRecord(record(RESUME_HOT_MAX_AGE_MS), NOW), "hot");
assert.equal(classifyResumeRecord(record(RESUME_HOT_MAX_AGE_MS + 1), NOW), "warm");
assert.equal(classifyResumeRecord(record(RESUME_WARM_MAX_AGE_MS), NOW), "warm");
assert.equal(classifyResumeRecord(record(RESUME_WARM_MAX_AGE_MS + 1), NOW), "stale");

// Every field needed to identify and reconstruct the saved ride is required.
assert.equal(classifyResumeRecord(null, NOW), "none");
assert.equal(classifyResumeRecord({}, NOW), "none");
for (const [label, invalidRecord] of [
  ["session id", { ...record(0), sessionId: null }],
  ["session snapshot", { ...record(0), sessionSnapshot: null }],
  ["navigation route", { ...record(0), navigationRoute: null }],
  ["route id", { ...record(0), navigationRoute: { ...record(0).navigationRoute, id: null } }],
  [
    "route param",
    { ...record(0), navigationRoute: { ...record(0).navigationRoute, routeParam: null } },
  ],
  [
    "terminal snapshot",
    { ...record(0), sessionSnapshot: { version: 1, state: { status: "ended" } } },
  ],
  [
    "permission snapshot",
    {
      ...record(0),
      sessionSnapshot: { version: 1, state: { status: "requesting-permission" } },
    },
  ],
]) {
  assert.equal(classifyResumeRecord(invalidRecord, NOW), "none", `missing ${label}`);
}

for (const [label, timestamp] of [
  ["missing", undefined],
  ["null", null],
  ["empty", ""],
  ["not numeric", "not-a-timestamp"],
  ["infinite", Infinity],
  ["negative infinite", -Infinity],
  ["NaN", Number.NaN],
]) {
  assert.equal(
    classifyResumeRecord({ ...record(0), lastProcessedFixTimestamp: timestamp }, NOW),
    "none",
    `${label} fix timestamp is invalid`,
  );
}
assert.equal(
  classifyResumeRecord(record(-1), NOW),
  "none",
  "future timestamps are invalid",
);

assert.equal(shouldSpeakHeadlessCue({ appActive: true }), false);
assert.equal(shouldSpeakHeadlessCue({ appActive: false }), true);
assert.equal(shouldSpeakHeadlessCue(), true, "no probe = assume off-screen (lock screen)");

assert.deepEqual(
  activeRideLaunchDecision(record(60_000), {
    initialUrl: "cycleways://routes/new-route",
    now: NOW,
  }),
  { action: "resume", resumeClass: "hot", deferredUrl: null },
);
assert.deepEqual(
  activeRideLaunchDecision(record(RESUME_HOT_MAX_AGE_MS + 1), {
    initialUrl: "cycleways://routes/new-route",
    now: NOW,
  }),
  {
    action: "prompt",
    resumeClass: "warm",
    deferredUrl: "cycleways://routes/new-route",
  },
);

console.log("resume policy tests passed");
