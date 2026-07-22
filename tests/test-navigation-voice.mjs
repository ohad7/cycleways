import assert from "node:assert/strict";
import {
  compassWord,
  createNavigationVoicePlanner,
  formatNavigationHorizonMeters,
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

assert.equal(formatSpeechDistanceMeters(96), "100 מטרים");
assert.equal(formatSpeechDistanceMeters(1250), "1.3 קילומטר");
assert.equal(formatSpeechDistanceMeters(null), "");
assert.equal(formatNavigationHorizonMeters(326), "350 מטרים");
assert.equal(formatNavigationHorizonMeters(1510), "1.5 קילומטר");

{
  const planner = createNavigationVoicePlanner();
  const preview = planner.plan(turnPreview, state, 1000).utterance;
  assert.ok(preview, "preview turn speaks");
  assert.equal(preview.language, "he-IL");
  assert.match(preview.text, /בעוד 100 מטרים/);
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
  const cue = {
    type: "turn",
    direction: "right",
    distanceMeters: 500,
    ontoGuidance: {
      guidanceIdentity: "way:tel-hai-trail",
      name: "שביל תל חי",
      spokenName: null,
      role: "named-way",
    },
    continueOnWayMeters: 1510,
    continueOnWayGuidance: {
      guidanceIdentity: "way:tel-hai-trail",
      name: "שביל תל חי",
      role: "named-way",
    },
  };
  const utterance = planner.plan(
    { kind: "cue", cueType: "turn", phase: "final", cue },
    { activeCue: { cue, phase: "final", distanceToCueMeters: 20 } },
    1000,
  ).utterance;
  assert.equal(
    utterance.text,
    "פנה ימינה אל שביל תל חי, והמשיכו עליו 1.5 קילומטר",
  );
}

{
  const planner = createNavigationVoicePlanner();
  const utterance = planner.plan(
    {
      kind: "acquired",
      acquisition: "join-route",
      guidance: {
        guidanceIdentity: "way:road-99",
        name: "כביש 99",
        spokenName: "כביש תשעים ותשע",
        role: "named-way",
      },
      guidanceHorizonMeters: 1480,
      includeGuidanceDistance: true,
    },
    {},
    1000,
  ).utterance;
  assert.equal(
    utterance.text,
    "הגעת למסלול, הניווט במסלול מתחיל, ממשיכים על כביש תשעים ותשע במשך 1.5 קילומטר",
  );
}

{
  const planner = createNavigationVoicePlanner();
  const offRoute = planner.plan(
    { kind: "off-route", distanceMeters: 52, bearingDeg: 10 },
    {},
    1000,
  ).utterance;
  assert.ok(offRoute);
  assert.match(offRoute.text, /יָצָאתָ מֵהַמַּסְלוּל/);
  assert.match(offRoute.text, /המסלול צפונה מכאן/);
  assert.match(offRoute.text, /50 מטרים/);
  assert.match(offRoute.text, /עקוב אחרי הקו המסומן/);
  assert.equal(offRoute.interruptsCurrentSpeech, true);

  const bareOffRoute = createNavigationVoicePlanner().plan(
    { kind: "off-route" },
    {},
    1000,
  ).utterance;
  assert.equal(bareOffRoute.text, "יָצָאתָ מֵהַמַּסְלוּל.");

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
  assert.equal(acquired.text, "הַכֹּל מוּכָן, יוֹצְאִים לַדֶּרֶךְ. רִכְבוּ בִּזְהִירוּת");
}

{
  const planner = createNavigationVoicePlanner();
  const preview = planner.plan(
    {
      kind: "cue",
      cueType: "arrive",
      phase: "preview",
      cue: { type: "arrive", distanceMeters: 1000 },
    },
    {
      activeCue: {
        cue: { type: "arrive", distanceMeters: 1000 },
        phase: "preview",
        distanceToCueMeters: 198,
      },
    },
    1000,
  ).utterance;
  assert.equal(preview.text, "בעוד 200 מטרים תגיע ליעד");

  const final = planner.plan(
    {
      kind: "cue",
      cueType: "arrive",
      phase: "final",
      cue: { type: "arrive", distanceMeters: 1000 },
    },
    {
      activeCue: {
        cue: { type: "arrive", distanceMeters: 1000 },
        phase: "final",
        distanceToCueMeters: 20,
      },
    },
    2000,
  ).utterance;
  assert.equal(final.text, "הִגַּעְתָּ לַיַּעַד.");
}

{
  const planner = createNavigationVoicePlanner();
  const approachTurn = {
    kind: "cue",
    cueType: "turn",
    phase: "preview",
    leg: "approach",
    cue: { type: "turn", direction: "left", distanceMeters: 80 },
  };
  const approach = planner.plan(
    approachTurn,
    { approach: { approachActiveCue: { distanceToCueMeters: 76, cue: approachTurn.cue } } },
    1000,
  ).utterance;
  assert.ok(approach, "approach cue speaks");
  assert.match(approach.text, /בעוד 80 מטרים/);
  assert.match(approach.text, /פנה שמאלה/);

  const falseArrival = planner.plan(
    {
      kind: "cue",
      cueType: "arrive",
      phase: "final",
      leg: "approach",
      cue: { type: "arrive", distanceMeters: 180 },
    },
    { approach: { approachActiveCue: { distanceToCueMeters: 10 } } },
    2000,
  );
  assert.equal(falseArrival.utterance, null, "approach seam is not a destination");
  assert.equal(falseArrival.reason, "no-phrase");
}

{
  const planner = createNavigationVoicePlanner();
  const joined = planner.plan(
    { kind: "acquired", acquisition: "join-route" },
    {},
    1000,
  ).utterance;
  assert.ok(joined, "join-route acquired speaks");
  assert.equal(joined.text, "הגעת למסלול, הניווט במסלול מתחיל");
}

{
  const planner = createNavigationVoicePlanner({ enabled: false });
  assert.equal(planner.plan(turnPreview, state, 1000).reason, "disabled");
}

// --- Compound turns -------------------------------------------------------
{
  const planner = createNavigationVoicePlanner();
  const first = planner.plan(
    {
      kind: "cue",
      cueType: "turn",
      phase: "final",
      cue: {
        type: "turn",
        direction: "left",
        thenDirection: "right",
        distanceMeters: 800,
      },
    },
    {},
    1000,
  ).utterance;
  assert.match(first.text, /פנה שמאלה ומיד ימינה/);

  const covered = planner.plan(
    {
      kind: "cue",
      cueType: "turn",
      phase: "final",
      cue: {
        type: "turn",
        direction: "right",
        distanceMeters: 840,
        compoundPreviousDistanceMeters: 800,
      },
    },
    {},
    4000,
  );
  assert.equal(covered.utterance, null);
  assert.equal(covered.reason, "compound-covered");

  const missedFirst = createNavigationVoicePlanner().plan(
    {
      kind: "cue",
      cueType: "turn",
      phase: "final",
      cue: {
        type: "turn",
        direction: "right",
        distanceMeters: 840,
        compoundPreviousDistanceMeters: 800,
      },
    },
    {},
    4000,
  );
  assert.ok(missedFirst.utterance, "follow-up still speaks if the compound cue was missed");
}

// --- Compound turn/roundabout maneuvers -----------------------------------
{
  const turnThenRoundabout = createNavigationVoicePlanner().plan(
    {
      kind: "cue",
      cueType: "turn",
      phase: "final",
      cue: {
        type: "turn",
        direction: "right",
        distanceMeters: 500,
        thenManeuver: { type: "roundabout", direction: "straight" },
      },
    },
    {},
    1000,
  ).utterance;
  assert.equal(turnThenRoundabout.text, "פנה ימינה, ואז בכיכר המשיכו ישר");

  const planner = createNavigationVoicePlanner();
  const roundaboutThenTurn = planner.plan(
    {
      kind: "cue",
      cueType: "roundabout",
      phase: "final",
      cue: {
        type: "roundabout",
        direction: "straight",
        distanceMeters: 600,
        exitDistanceMeters: 650,
        thenManeuver: { type: "turn", direction: "right" },
      },
    },
    {},
    1000,
  ).utterance;
  assert.equal(roundaboutThenTurn.text, "בכיכר, המשיכו ישר, ואז פנו ימינה");

  const coveredTurn = planner.plan(
    {
      kind: "cue",
      cueType: "turn",
      phase: "final",
      cue: {
        type: "turn",
        direction: "right",
        distanceMeters: 659,
        compoundPreviousType: "roundabout",
        compoundPreviousDistanceMeters: 600,
      },
    },
    {},
    4000,
  );
  assert.equal(coveredTurn.reason, "compound-covered");

  const missedRoundabout = createNavigationVoicePlanner().plan(
    {
      kind: "cue",
      cueType: "turn",
      phase: "final",
      cue: {
        type: "turn",
        direction: "right",
        distanceMeters: 659,
        compoundPreviousType: "roundabout",
        compoundPreviousDistanceMeters: 600,
      },
    },
    {},
    4000,
  );
  assert.ok(missedRoundabout.utterance);
}

// --- Segment names --------------------------------------------------------
{
  const planner = createNavigationVoicePlanner();
  const turnOnto = planner.plan(
    {
      kind: "cue",
      cueType: "turn",
      phase: "final",
      cue: {
        type: "turn",
        direction: "right",
        ontoSegmentName: "גשר הירדן",
        distanceMeters: 900,
      },
    },
    {},
    1000,
  ).utterance;
  assert.match(turnOnto.text, /פנה ימינה אל גשר הירדן/);

  const duplicateName = planner.plan(
    {
      kind: "cue",
      cueType: "enter-segment",
      phase: "final",
      cue: {
        type: "enter-segment",
        segmentName: "גשר הירדן",
        distanceMeters: 950,
      },
    },
    {},
    5000,
  );
  assert.equal(duplicateName.reason, "same-segment");

  const unnamed = planner.plan(
    {
      kind: "cue",
      cueType: "turn",
      phase: "final",
      cue: { type: "turn", direction: "left", distanceMeters: 1100 },
    },
    {},
    8000,
  );
  assert.ok(unnamed.utterance);

  const returnToName = planner.plan(
    {
      kind: "cue",
      cueType: "enter-segment",
      phase: "final",
      cue: {
        type: "enter-segment",
        segmentName: "גשר הירדן",
        distanceMeters: 1300,
      },
    },
    {},
    11_000,
  );
  assert.ok(returnToName.utterance, "same name may be spoken again after an intervening cue");

  const preview = planner.plan(
    {
      kind: "cue",
      cueType: "enter-segment",
      phase: "preview",
      cue: { type: "enter-segment", segmentName: "שביל אחר", distanceMeters: 1600 },
    },
    {},
    14_000,
  );
  assert.equal(preview.reason, "no-phrase");
}

// --- Wrong-way, rejoin, and compass --------------------------------------
assert.equal(compassWord(0, "he-IL"), "צפונה");
assert.equal(compassWord(90, "he-IL"), "מזרחה");
assert.equal(compassWord(225, "he-IL"), "דרום-מערבה");
assert.equal(compassWord(359, "he-IL"), "צפונה");
assert.equal(compassWord(null, "he-IL"), null);

{
  const wrongWay = createNavigationVoicePlanner().plan(
    { kind: "wrong-way" },
    {},
    1000,
  ).utterance;
  assert.match(wrongWay.text, /נגד כיוון המסלול/);
  assert.equal(wrongWay.interruptsCurrentSpeech, true);

  const acquired = createNavigationVoicePlanner().plan(
    { kind: "acquired", acquisition: "join-route" },
    { progress: { bearingToNextDeg: 180 } },
    1000,
  ).utterance;
  assert.match(acquired.text, /דרומה/);
}

// Bends remain visual/haptic only.
{
  const bend = createNavigationVoicePlanner().plan(
    {
      kind: "cue",
      cueType: "bend",
      phase: "final",
      cue: { type: "bend", direction: "left", distanceMeters: 400 },
    },
    {},
    1000,
  );
  assert.equal(bend.utterance, null);
  assert.equal(bend.reason, "no-phrase");
}

// Roundabout phrasing supports all directions and preview distance prefixes.
{
  for (const [direction, expected] of [
    ["straight", /ישר/],
    ["right", /ימינה/],
    ["left", /שמאלה/],
    ["u-turn", /לאחור/],
  ]) {
    const cue = { type: "roundabout", direction, distanceMeters: 500 };
    const utterance = createNavigationVoicePlanner().plan(
      { kind: "cue", cueType: "roundabout", phase: "preview", cue },
      { activeCue: { distanceToCueMeters: 95, cue, phase: "preview" } },
      1000,
    ).utterance;
    assert.match(utterance.text, /בעוד 100 מטרים/);
    assert.match(utterance.text, /בכיכר/);
    assert.match(utterance.text, expected);
  }
}

// Crossing phrasing is safety-specific and supports a following maneuver.
{
  const cue = {
    type: "crossing",
    distanceMeters: 500,
    thenManeuver: { type: "roundabout", direction: "straight" },
  };
  const utterance = createNavigationVoicePlanner().plan(
    { kind: "cue", cueType: "crossing", phase: "preview", cue },
    { activeCue: { distanceToCueMeters: 118, cue, phase: "preview" } },
    1000,
  ).utterance;
  assert.match(utterance.text, /בעוד 120 מטרים/);
  assert.match(utterance.text, /חצו בזהירות לצד השני של הכביש/);
  assert.match(utterance.text, /ואז בכיכר המשיכו ישר/);

  const english = createNavigationVoicePlanner({ locale: "en-US" }).plan(
    { kind: "cue", cueType: "crossing", phase: "final", cue },
    { activeCue: { distanceToCueMeters: 10, cue, phase: "final" } },
    1000,
  ).utterance;
  assert.match(english.text, /Cross carefully to the other side of the road/);

  const crossingPairCue = {
    type: "crossing",
    distanceMeters: 550,
    thenManeuver: { type: "crossing" },
  };
  const crossingPair = createNavigationVoicePlanner().plan(
    { kind: "cue", cueType: "crossing", phase: "final", cue: crossingPairCue },
    { activeCue: { distanceToCueMeters: 10, cue: crossingPairCue, phase: "final" } },
    1500,
  ).utterance;
  assert.equal(
    crossingPair.text,
    "חצו בזהירות לצד השני של הכביש, ואז חצו בזהירות גם את הכביש הבא",
  );

  const roundaboutThenCrossingCue = {
    type: "roundabout",
    direction: "left",
    distanceMeters: 575,
    thenManeuver: { type: "crossing" },
  };
  const roundaboutThenCrossing = createNavigationVoicePlanner().plan(
    { kind: "cue", cueType: "roundabout", phase: "final", cue: roundaboutThenCrossingCue },
    { activeCue: { distanceToCueMeters: 10, cue: roundaboutThenCrossingCue, phase: "final" } },
    1750,
  ).utterance;
  assert.equal(
    roundaboutThenCrossing.text,
    "בכיכר, פנו שמאלה, ואז חצו בזהירות גם את הכביש הבא",
  );

  const crossingRoundaboutComplexCue = {
    type: "roundabout",
    direction: "left",
    distanceMeters: 580,
    exitDistanceMeters: 650,
    containsReviewedCrossing: true,
    ontoSegmentName: "שביל אופניים יובלים",
  };
  const crossingRoundaboutComplex = createNavigationVoicePlanner().plan(
    {
      kind: "cue",
      cueType: "roundabout",
      phase: "final",
      cue: crossingRoundaboutComplexCue,
    },
    { activeCue: { distanceToCueMeters: 10, cue: crossingRoundaboutComplexCue, phase: "final" } },
    1800,
  ).utterance;
  assert.equal(
    crossingRoundaboutComplex.text,
    "בכיכר, חצו בזהירות את הכביש, ולאחר מכן פנו שמאלה אל שביל אופניים יובלים",
  );

  const intersectionCue = {
    type: "crossing",
    distanceMeters: 600,
    thenManeuver: {
      type: "turn",
      direction: "left",
      ontoSegmentName: "דרך נוף מצפה עדי - מטולה דרום",
    },
  };
  const intersection = createNavigationVoicePlanner().plan(
    { kind: "cue", cueType: "crossing", phase: "final", cue: intersectionCue },
    { activeCue: { distanceToCueMeters: 10, cue: intersectionCue, phase: "final" } },
    2000,
  ).utterance;
  assert.match(
    intersection.text,
    /חצו בזהירות לצד השני של הכביש, ואז פנו שמאלה אל דרך נוף מצפה עדי - מטולה דרום/,
  );

  const directNamedCrossing = {
    type: "crossing",
    distanceMeters: 700,
    ontoGuidance: {
      guidanceIdentity: "way:tel-hai-trail",
      name: "שביל תל חי",
      role: "named-way",
    },
    continueOnWayGuidance: {
      guidanceIdentity: "way:tel-hai-trail",
      name: "שביל תל חי",
      role: "named-way",
    },
    continueOnWayMeters: 1510,
  };
  const direct = createNavigationVoicePlanner().plan(
    { kind: "cue", cueType: "crossing", phase: "final", cue: directNamedCrossing },
    { activeCue: { distanceToCueMeters: 10, cue: directNamedCrossing, phase: "final" } },
    3000,
  ).utterance;
  assert.equal(
    direct.text,
    "חצו בזהירות לצד השני של הכביש, והמשיכו על שביל תל חי במשך 1.5 קילומטר",
  );

  const legacyNamedCrossing = {
    type: "crossing",
    distanceMeters: 750,
    ontoSegmentName: "שביל תל חי",
  };
  const legacyDirect = createNavigationVoicePlanner().plan(
    { kind: "cue", cueType: "crossing", phase: "final", cue: legacyNamedCrossing },
    { activeCue: { distanceToCueMeters: 10, cue: legacyNamedCrossing, phase: "final" } },
    3500,
  ).utterance;
  assert.equal(
    legacyDirect.text,
    "חצו בזהירות לצד השני של הכביש, והיכנסו אל שביל תל חי",
  );
}

console.log("navigation voice tests passed");
