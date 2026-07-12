// Pure navigation voice planner. It maps one-shot navigation session cue events
// to spoken utterance plans, while owning dedupe/cooldown state so native
// speech adapters stay side-effect-only.

const DEFAULT_LANGUAGE = "he-IL";
const DEFAULT_COOLDOWN_MS = 1200;

const PRIORITY = {
  info: 1,
  preview: 2,
  final: 3,
  alert: 4,
};

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function formatSpeechDistanceMeters(meters, locale = DEFAULT_LANGUAGE) {
  const value = finite(meters);
  if (value === null || value < 0) return "";
  if (locale === "he-IL") {
    if (value < 1000) return `${Math.max(10, Math.round(value / 10) * 10)} מטרים`;
    const km = value / 1000;
    return `${km.toFixed(km >= 10 ? 0 : 1)} קילומטר`;
  }
  if (value < 1000) return `${Math.max(10, Math.round(value / 10) * 10)} meters`;
  const km = value / 1000;
  return `${km.toFixed(km >= 10 ? 0 : 1)} kilometers`;
}

function directionText(direction, locale) {
  if (locale === "he-IL") return direction === "right" ? "ימינה" : "שמאלה";
  return direction === "right" ? "right" : "left";
}

function roundaboutText(direction, locale) {
  const phrases = locale === "he-IL"
    ? {
        straight: "בכיכר, המשיכו ישר",
        right: "בכיכר, פנו ימינה",
        left: "בכיכר, פנו שמאלה",
        "u-turn": "בכיכר, חזרו לאחור",
      }
    : {
        straight: "At the roundabout, continue straight",
        right: "At the roundabout, turn right",
        left: "At the roundabout, turn left",
        "u-turn": "At the roundabout, turn back",
      };
  return phrases[direction] || null;
}

function thenManeuverText(maneuver, locale, sourceType) {
  if (!maneuver) return "";
  if (maneuver.type === "roundabout") {
    const phrase = roundaboutText(maneuver.direction, locale);
    if (!phrase) return "";
    const normalized = locale === "he-IL"
      ? phrase.replace(/^בכיכר,\s*/, "בכיכר ")
      : phrase.replace(/^At the roundabout,\s*/, "at the roundabout, ");
    return locale === "he-IL" ? `, ואז ${normalized}` : `, then ${normalized}`;
  }
  if (maneuver.type === "turn") {
    if (sourceType === "roundabout") {
      return locale === "he-IL"
        ? `, ואז פנו ${directionText(maneuver.direction, locale)}`
        : `, then turn ${directionText(maneuver.direction, locale)}`;
    }
    return locale === "he-IL"
      ? ` ומיד ${directionText(maneuver.direction, locale)}`
      : `, then turn ${directionText(maneuver.direction, locale)}`;
  }
  return "";
}

export function compassWord(bearingDeg, locale = DEFAULT_LANGUAGE) {
  if (bearingDeg === null || bearingDeg === undefined || bearingDeg === "") {
    return null;
  }
  const bearing = Number(bearingDeg);
  if (!Number.isFinite(bearing)) return null;
  const names =
    locale === "he-IL"
      ? [
          "צפונה",
          "צפון-מזרחה",
          "מזרחה",
          "דרום-מזרחה",
          "דרומה",
          "דרום-מערבה",
          "מערבה",
          "צפון-מערבה",
        ]
      : [
          "north",
          "northeast",
          "east",
          "southeast",
          "south",
          "southwest",
          "west",
          "northwest",
        ];
  const normalized = ((bearing % 360) + 360) % 360;
  return names[Math.round(normalized / 45) % 8];
}

function cuePhrase(event, state, locale) {
  if (event.kind === "off-route") {
    const direction = compassWord(event.bearingDeg, locale);
    const distanceText = formatSpeechDistanceMeters(event.distanceMeters, locale);
    if (locale === "he-IL") {
      const routeDetails = direction
        ? `המסלול ${direction} מכאן${distanceText ? `, במרחק כ־${distanceText}` : ""}`
        : distanceText
          ? `המסלול במרחק כ־${distanceText} מכאן`
          : "";
      return routeDetails
        ? `יָצָאתָ מֵהַמַּסְלוּל. ${routeDetails}. עקוב אחרי הקו המסומן`
        : "יָצָאתָ מֵהַמַּסְלוּל.";
    }
    const routeDetails = direction
      ? `The route is ${direction} of you${distanceText ? `, about ${distanceText} away` : ""}`
      : distanceText
        ? `The route is about ${distanceText} away`
        : "";
    return routeDetails
      ? `You left the route. ${routeDetails}. Follow the marked line.`
      : "You left the route.";
  }
  if (event.kind === "acquired") {
    const direction = compassWord(state?.progress?.bearingToNextDeg, locale);
    if (event.acquisition === "join-route") {
      return locale === "he-IL"
        ? `הגעת למסלול, הניווט במסלול מתחיל${direction ? `, ממשיכים ${direction}` : ""}`
        : `You reached the route. Route navigation starts now${direction ? `, heading ${direction}` : ""}.`;
    }
    if (event.acquisition === "reacquired") {
      return locale === "he-IL"
        ? `חזרנו למסלול, ממשיכים בניווט${direction ? ` ${direction}` : ""}`
        : `Back on route. Continuing navigation${direction ? `, heading ${direction}` : ""}.`;
    }
    return locale === "he-IL"
      ? `הַכֹּל מוּכָן, יוֹצְאִים לַדֶּרֶךְ${direction ? ` ${direction}` : ""}. רִכְבוּ בִּזְהִירוּת`
      : `All set. Let's ride${direction ? `, heading ${direction}` : ""}. Ride safely.`;
  }
  if (event.kind === "wrong-way") {
    return locale === "he-IL"
      ? "אתה רוכב נגד כיוון המסלול"
      : "You are riding against the route direction.";
  }
  if (event.kind !== "cue") return null;

  const cue = event.cue || {};
  const activeCue =
    event.leg === "approach"
      ? state?.approach?.approachActiveCue || state?.activeCue
      : state?.activeCue;
  const distanceText = formatSpeechDistanceMeters(
    activeCue?.distanceToCueMeters,
    locale,
  );
  const prefix =
    event.phase === "preview" && distanceText
      ? (locale === "he-IL" ? `בעוד ${distanceText}, ` : `In ${distanceText}, `)
      : "";

  switch (cue.type) {
    case "turn": {
      const onto = cue.ontoSegmentName
        ? locale === "he-IL"
          ? ` אל ${cue.ontoSegmentName}`
          : ` onto ${cue.ontoSegmentName}`
        : "";
      const then = thenManeuverText(
        cue.thenManeuver || (cue.thenDirection
          ? { type: "turn", direction: cue.thenDirection }
          : null),
        locale,
        "turn",
      );
      return locale === "he-IL"
        ? `${prefix}פנה ${directionText(cue.direction, locale)}${onto}${then}`
        : `${prefix}turn ${directionText(cue.direction, locale)}${onto}${then}`;
    }
    case "roundabout": {
      const phrase = roundaboutText(cue.direction, locale);
      const then = thenManeuverText(cue.thenManeuver, locale, "roundabout");
      return phrase ? `${prefix}${phrase}${then}` : null;
    }
    case "bend":
      return null;
    case "enter-segment":
      if (event.phase !== "final" || !cue.segmentName) return null;
      return locale === "he-IL"
        ? `ממשיכים על ${cue.segmentName}`
        : `Continuing on ${cue.segmentName}`;
    case "arrive":
      // Defensive guard for restored/legacy events: reaching the end of an
      // approach leg means joining the main route, not arriving at the ride's
      // destination. The acquired(join-route) event owns that announcement.
      if (event.leg === "approach") return null;
      if (event.phase === "preview") {
        if (locale === "he-IL") {
          return distanceText
            ? `בעוד ${distanceText} תגיע ליעד`
            : "בקרוב תגיע ליעד";
        }
        return distanceText
          ? `In ${distanceText}, you will reach your destination.`
          : "You will reach your destination soon.";
      }
      return locale === "he-IL" ? "הִגַּעְתָּ לַיַּעַד." : "You have arrived.";
    case "hazard":
    case "caution":
      return locale === "he-IL" ? `${prefix}שים לב.` : `${prefix}Caution.`;
    default:
      return null;
  }
}

// Single owner of the cue utterance-id format: the compound-turn suppression
// below looks ids up by (type, distance, phase), so the format must never be
// rebuilt by hand elsewhere.
function cueUtteranceId(type, distanceMeters, phase) {
  return `cue:${type}:${distanceMeters}:${phase}`;
}

function utteranceIdFor(event) {
  if (!event) return null;
  if (event.kind === "off-route") return "state:off-route";
  if (event.kind === "wrong-way") return "state:wrong-way";
  if (event.kind === "acquired") {
    if (event.acquisition === "join-route") return "state:acquired:join-route";
    if (event.acquisition === "reacquired") return "state:acquired:reacquired";
    return "state:acquired:initial";
  }
  if (event.kind === "cue") {
    const cue = event.cue || {};
    return cueUtteranceId(cue.type, cue.distanceMeters, event.phase);
  }
  return null;
}

function priorityFor(event) {
  if (!event) return PRIORITY.info;
  if (event.kind === "off-route") return PRIORITY.alert;
  if (event.kind === "wrong-way") return PRIORITY.alert;
  if (event.kind === "acquired") return PRIORITY.info;
  if (event.kind === "cue") {
    if (event.cueType === "arrive") return PRIORITY.alert;
    return event.phase === "final" ? PRIORITY.final : PRIORITY.preview;
  }
  return PRIORITY.info;
}

function isRepeatableStateEvent(event) {
  return (
    event?.kind === "off-route" ||
    event?.kind === "acquired" ||
    event?.kind === "wrong-way"
  );
}

export function createNavigationVoicePlanner({
  locale = DEFAULT_LANGUAGE,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  enabled = true,
  memory,
} = {}) {
  const spokenIds = new Set(Array.isArray(memory?.spokenIds) ? memory.spokenIds : []);
  let lastSpokenAt = finite(memory?.lastSpokenAt);
  let lastUtterance = memory?.lastUtterance || null;
  let lastSegmentNameSpoken = memory?.lastSegmentNameSpoken || null;

  function plan(cueEvent, state = {}, nowMs = Date.now(), settings = {}) {
    const voiceEnabled = settings.enabled !== undefined ? settings.enabled : enabled;
    if (!voiceEnabled) return { utterance: null, reason: "disabled" };
    if (!cueEvent) return { utterance: null, reason: "no-event" };

    const utteranceId = utteranceIdFor(cueEvent);
    if (!utteranceId) return { utterance: null, reason: "unsupported-event" };
    if (spokenIds.has(utteranceId)) {
      if (
        !isRepeatableStateEvent(cueEvent) ||
        lastUtterance?.utteranceId === utteranceId
      ) {
        return { utterance: null, reason: "duplicate" };
      }
    }

    if (
      cueEvent.kind === "cue" &&
      Number.isFinite(Number(cueEvent.cue.compoundPreviousDistanceMeters))
    ) {
      const previousType = cueEvent.cue.compoundPreviousType || "turn";
      const previousDistance = Number(
        cueEvent.cue.compoundPreviousDistanceMeters,
      );
      if (
        spokenIds.has(cueUtteranceId(previousType, previousDistance, "preview")) ||
        spokenIds.has(cueUtteranceId(previousType, previousDistance, "final"))
      ) {
        return { utterance: null, reason: "compound-covered" };
      }
    }
    if (
      cueEvent.kind === "cue" &&
      cueEvent.cue?.type === "enter-segment" &&
      cueEvent.cue.segmentName &&
      cueEvent.cue.segmentName === lastSegmentNameSpoken
    ) {
      return { utterance: null, reason: "same-segment" };
    }

    const text = cuePhrase(cueEvent, state, settings.locale || locale);
    if (!text) return { utterance: null, reason: "no-phrase" };

    const priority = priorityFor(cueEvent);
    if (
      lastSpokenAt !== null &&
      nowMs - lastSpokenAt < cooldownMs &&
      priority < PRIORITY.final &&
      !isRepeatableStateEvent(cueEvent)
    ) {
      return { utterance: null, reason: "cooldown" };
    }

    const utterance = {
      utteranceId,
      text,
      language: settings.locale || locale,
      priority,
      interruptsCurrentSpeech: priority >= PRIORITY.final,
    };
    spokenIds.add(utteranceId);
    lastSpokenAt = finite(nowMs);
    lastUtterance = utterance;
    const spokenName =
      cueEvent.cue?.ontoSegmentName ||
      (cueEvent.cue?.type === "enter-segment"
        ? cueEvent.cue.segmentName
        : null);
    lastSegmentNameSpoken = spokenName || null;
    return { utterance, reason: null };
  }

  function snapshot() {
    return {
      version: 1,
      spokenIds: Array.from(spokenIds),
      lastSpokenAt,
      lastUtterance,
      lastSegmentNameSpoken,
    };
  }

  function reset(nextMemory = null) {
    spokenIds.clear();
    if (Array.isArray(nextMemory?.spokenIds)) {
      for (const id of nextMemory.spokenIds) spokenIds.add(id);
    }
    lastSpokenAt = finite(nextMemory?.lastSpokenAt);
    lastUtterance = nextMemory?.lastUtterance || null;
    lastSegmentNameSpoken = nextMemory?.lastSegmentNameSpoken || null;
  }

  return { plan, snapshot, reset };
}
