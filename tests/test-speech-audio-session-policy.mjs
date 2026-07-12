import assert from "node:assert/strict";
import { createSpeechAudioSessionPolicy } from "@cycleways/core/navigation/speechAudioSessionPolicy.js";

// First speak activates; a concurrent second speak does not re-activate.
{
  const policy = createSpeechAudioSessionPolicy({ lingerMs: 1500 });
  assert.deepEqual(policy.onSpeakRequested(), { shouldActivate: true }, "first speak activates");
  assert.deepEqual(policy.onSpeakRequested(), { shouldActivate: false }, "concurrent speak reuses the active session");
  assert.equal(policy.snapshot().inFlight, 2, "two utterances in flight");
}

// No deactivation while any utterance is still in flight.
{
  const policy = createSpeechAudioSessionPolicy({ lingerMs: 1500 });
  policy.onSpeakRequested();
  policy.onSpeakRequested();
  policy.onUtteranceSettled(1000);
  assert.equal(policy.shouldDeactivateNow(10_000), false, "one utterance still speaking");
}

// Deactivation only after lingerMs past the last settle.
{
  const policy = createSpeechAudioSessionPolicy({ lingerMs: 1500 });
  policy.onSpeakRequested();
  policy.onUtteranceSettled(1000);
  assert.equal(policy.shouldDeactivateNow(2499), false, "still inside the linger window");
  assert.equal(policy.shouldDeactivateNow(2500), true, "linger elapsed -> deactivate");
}

// A new speak inside the linger window suppresses deactivation, and the
// linger clock restarts from the later settle.
{
  const policy = createSpeechAudioSessionPolicy({ lingerMs: 1500 });
  policy.onSpeakRequested();
  policy.onUtteranceSettled(1000);
  assert.deepEqual(policy.onSpeakRequested(), { shouldActivate: false }, "session still active during linger");
  assert.equal(policy.shouldDeactivateNow(2500), false, "new utterance in flight");
  policy.onUtteranceSettled(3000);
  assert.equal(policy.shouldDeactivateNow(4499), false, "linger restarts from the later settle");
  assert.equal(policy.shouldDeactivateNow(4500), true, "later linger elapsed");
}

// After onDeactivated() the next speak re-activates.
{
  const policy = createSpeechAudioSessionPolicy({ lingerMs: 1500 });
  policy.onSpeakRequested();
  policy.onUtteranceSettled(1000);
  assert.equal(policy.shouldDeactivateNow(2500), true);
  policy.onDeactivated();
  assert.equal(policy.snapshot().active, false, "deactivated");
  assert.equal(policy.shouldDeactivateNow(9999), false, "nothing to deactivate");
  assert.deepEqual(policy.onSpeakRequested(), { shouldActivate: true }, "next speak re-activates");
}

// Failed activation path: glue reports onDeactivated() right after requesting,
// so the following speak retries activation even with utterances in flight.
{
  const policy = createSpeechAudioSessionPolicy({ lingerMs: 1500 });
  policy.onSpeakRequested();
  policy.onDeactivated();
  assert.deepEqual(policy.onSpeakRequested(), { shouldActivate: true }, "retry activation after failure");
}

// Settle without any speak (defensive) never deactivates and never underflows.
{
  const policy = createSpeechAudioSessionPolicy({ lingerMs: 1500 });
  policy.onUtteranceSettled(1000);
  assert.equal(policy.snapshot().inFlight, 0, "no underflow");
  assert.equal(policy.shouldDeactivateNow(10_000), false, "never activated -> never deactivates");
}

// Default lingerMs is finite and positive.
{
  const policy = createSpeechAudioSessionPolicy();
  policy.onSpeakRequested();
  policy.onUtteranceSettled(0);
  assert.equal(policy.shouldDeactivateNow(0), false, "linger applies with defaults");
  assert.equal(policy.shouldDeactivateNow(60_000), true, "default linger elapses");
}

console.log("test-speech-audio-session-policy: all assertions passed");
