import assert from "node:assert/strict";
import { initialWizardState, wizardReducer } from "../src/components/wizardReducer.js";

const s0 = initialWizardState();
assert.equal(s0.step, 0);
assert.equal(s0.answers.place, null);

// Answering place jumps past region (step 1 -> 2)
const s1 = wizardReducer(s0, { type: "ANSWER", key: "place", value: "dafna" });
assert.equal(s1.answers.place, "dafna");
assert.equal(s1.step, 2);

// Answering place="any" keeps the region question (step 1)
const sAny = wizardReducer(s0, { type: "ANSWER", key: "place", value: "any" });
assert.equal(sAny.answers.place, "any");
assert.equal(sAny.step, 1);

// Continue forward
const s2 = wizardReducer(s1, { type: "ANSWER", key: "distance", value: "medium" });
assert.equal(s2.step, 3);
const s3 = wizardReducer(s2, { type: "ANSWER", key: "difficulty", value: "easy" });
assert.equal(s3.step, 4);
const s4 = wizardReducer(s3, { type: "ANSWER", key: "style", value: "family" });
assert.equal(s4.step, 5); // results step

// BACK from results goes to step 4
const back1 = wizardReducer(s4, { type: "BACK" });
assert.equal(back1.step, 4);

// BACK across the skipped region step (step 2 -> 0, not 2 -> 1)
const back2 = wizardReducer(s1, { type: "BACK" });
assert.equal(back2.step, 0);

// RESET
const reset = wizardReducer(s4, { type: "RESET" });
assert.deepEqual(reset, initialWizardState());

// BACK from step 0 is a no-op
assert.deepEqual(wizardReducer(s0, { type: "BACK" }), s0);

console.log("wizardReducer tests passed");
