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

// Reviewed crossings use the normal maneuver pattern.
{
  const preview = createCueHapticPlanner();
  assert.equal(
    preview.plan({ kind: "cue", cueType: "crossing", phase: "preview" }, 1000).kind,
    "light",
  );
  const final = createCueHapticPlanner();
  assert.equal(
    final.plan({ kind: "cue", cueType: "crossing", phase: "final" }, 1000).kind,
    "medium",
  );
}

// Acquiring the selected route start gets one affirmative haptic.
{
  const planner = createCueHapticPlanner();
  assert.equal(planner.plan({ kind: "acquired" }, 1000).kind, "medium");
}

// --- bend cues are heads-up only: light at final, silent in preview ---
{
  const planner = createCueHapticPlanner();
  assert.equal(
    planner.plan({ kind: "cue", cueType: "bend", phase: "preview" }, 1000).kind,
    null,
    "bend preview is visual-only",
  );
  assert.equal(
    planner.plan({ kind: "cue", cueType: "bend", phase: "final" }, 2000).kind,
    "light",
    "bend final -> light (a turn would be medium)",
  );
}

// --- enter-segment cues do not vibrate ---
{
  const planner = createCueHapticPlanner();
  const out = planner.plan({ kind: "cue", cueType: "enter-segment", phase: "preview" }, 1000);
  assert.equal(out.kind, null, "plain segment entry is visual-only");
  // Intentionally inside the cooldown window (1000 + 1200 = 2200 ms).
  // If enter-segment incorrectly consumed the cooldown, the turn would be
  // suppressed and return null — proving the "null does not consume cooldown"
  // invariant.
  const turn = planner.plan({ kind: "cue", cueType: "turn", phase: "final" }, 1500);
  assert.equal(turn.kind, "medium", "turns still vibrate after null-intensity cue inside cooldown window");
}

console.log("cue haptics planner tests passed");
