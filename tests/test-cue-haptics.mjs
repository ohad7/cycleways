import assert from "node:assert/strict";
import { createCueHapticPlanner } from "@cycleways/core/navigation/cueHaptics.js";

// Maps session cue events to a haptic intensity, with a global cooldown so the
// same ride does not buzz constantly.
{
  const planner = createCueHapticPlanner({ cooldownMs: 1000 });

  assert.equal(planner.plan(null, 0).kind, null, "no event -> no haptic");

  // Off-route entry is the strongest cue.
  assert.equal(
    planner.plan({ kind: "off-route" }, 1000).kind,
    "heavy",
    "off-route -> heavy",
  );

  // Within the cooldown window, suppressed.
  assert.equal(
    planner.plan({ kind: "cue", cueType: "turn", phase: "final" }, 1500).kind,
    null,
    "suppressed inside cooldown",
  );

  // After the cooldown, a final cue fires medium.
  assert.equal(
    planner.plan({ kind: "cue", cueType: "turn", phase: "final" }, 2100).kind,
    "medium",
    "final cue -> medium",
  );

  // A preview cue (after cooldown) is light.
  assert.equal(
    planner.plan({ kind: "cue", cueType: "turn", phase: "preview" }, 3200).kind,
    "light",
    "preview cue -> light",
  );
}

// --- enter-segment cues do not vibrate ---
{
  const planner = createCueHapticPlanner();
  const out = planner.plan({ kind: "cue", cueType: "enter-segment", phase: "preview" }, 1000);
  assert.equal(out.kind, null, "plain segment entry is visual-only");
  const turn = planner.plan({ kind: "cue", cueType: "turn", phase: "final" }, 5000);
  assert.equal(turn.kind, "medium", "turns still vibrate");
}

console.log("cue haptics planner tests passed");
