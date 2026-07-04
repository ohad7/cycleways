import assert from "node:assert/strict";
import {
  createNavigationVoicePlanner,
  formatSpeechDistanceMeters,
} from "@cycleways/core/navigation/navigationVoice.js";

const turnPreview = {
  kind: "cue",
  cueType: "turn",
  phase: "preview",
  cue: { type: "turn", direction: "right", distanceMeters: 500 },
};

const turnFinal = {
  kind: "cue",
  cueType: "turn",
  phase: "final",
  cue: { type: "turn", direction: "right", distanceMeters: 500 },
};

const state = {
  activeCue: { distanceToCueMeters: 95, cue: turnPreview.cue, phase: "preview" },
};

assert.equal(formatSpeechDistanceMeters(96), "100 מטר");
assert.equal(formatSpeechDistanceMeters(1250), "1.3 קילומטר");

{
  const planner = createNavigationVoicePlanner();
  const preview = planner.plan(turnPreview, state, 1000).utterance;
  assert.ok(preview, "preview turn speaks");
  assert.equal(preview.language, "he-IL");
  assert.match(preview.text, /בעוד 100 מטר/);
  assert.match(preview.text, /פנה ימינה/);
  assert.equal(preview.interruptsCurrentSpeech, false);

  const duplicate = planner.plan(turnPreview, state, 2000);
  assert.equal(duplicate.utterance, null, "same cue/phase dedupes");
  assert.equal(duplicate.reason, "duplicate");

  const final = planner.plan(
    turnFinal,
    { activeCue: { ...state.activeCue, distanceToCueMeters: 25 } },
    2100,
  ).utterance;
  assert.ok(final, "final phase speaks despite prior preview");
  assert.equal(final.interruptsCurrentSpeech, true);
}

{
  const planner = createNavigationVoicePlanner();
  const offRoute = planner.plan({ kind: "off-route" }, {}, 1000).utterance;
  assert.ok(offRoute);
  assert.equal(offRoute.text, "יצאת מהמסלול");
  assert.equal(offRoute.interruptsCurrentSpeech, true);

  const snapshot = planner.snapshot();
  const restored = createNavigationVoicePlanner({ memory: snapshot });
  assert.equal(
    restored.plan({ kind: "off-route" }, {}, 2000).reason,
    "duplicate",
    "snapshot preserves spoken ids",
  );
  const acquired = restored.plan(
    { kind: "acquired", acquisition: "reacquired" },
    {},
    3000,
  ).utterance;
  assert.ok(acquired, "state prompts can move to reacquired");
  assert.equal(acquired.text, "חזרנו למסלול, ממשיכים בניווט");
  const secondOffRoute = restored.plan({ kind: "off-route" }, {}, 4000).utterance;
  assert.ok(secondOffRoute, "off-route can speak again after reacquisition");
}

{
  const planner = createNavigationVoicePlanner();
  const acquired = planner.plan(
    { kind: "acquired", acquisition: "initial" },
    {},
    1000,
  ).utterance;
  assert.ok(acquired, "initial acquired speaks");
  assert.equal(acquired.text, "הכל מוכן, יוצאים לדרך. רכבו בזהירות");
}

{
  const planner = createNavigationVoicePlanner({ enabled: false });
  assert.equal(planner.plan(turnPreview, state, 1000).reason, "disabled");
}

console.log("navigation voice tests passed");
