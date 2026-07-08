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
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function formatSpeechDistanceMeters(meters, locale = DEFAULT_LANGUAGE) {
  const value = finite(meters);
  if (value === null || value < 0) return "";
  if (locale === "he-IL") {
    if (value < 1000) return `${Math.max(10, Math.round(value / 10) * 10)} מטר`;
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

function cuePhrase(event, state, locale) {
  if (event.kind === "off-route") {
    return locale === "he-IL" ? "יָצָאתָ מֵהַמַּסְלוּל." : "You left the route.";
  }
  if (event.kind === "acquired") {
    if (event.acquisition === "reacquired") {
      return locale === "he-IL"
        ? "חזרנו למסלול, ממשיכים בניווט"
        : "Back on route. Continuing navigation.";
    }
    return locale === "he-IL"
      ? "הַכֹּל מוּכָן, יוֹצְאִים לַדֶּרֶךְ. רִכְבוּ בִּזְהִירוּת"
      : "All set. Let's ride. Ride safely.";
  }
  if (event.kind !== "cue") return null;

  const cue = event.cue || {};
  const distanceText = formatSpeechDistanceMeters(
    state?.activeCue?.distanceToCueMeters,
    locale,
  );
  const prefix =
    event.phase === "preview" && distanceText
      ? (locale === "he-IL" ? `בעוד ${distanceText}, ` : `In ${distanceText}, `)
      : "";

  switch (cue.type) {
    case "turn":
      return locale === "he-IL"
        ? `${prefix}פנה ${directionText(cue.direction, locale)}`
        : `${prefix}turn ${directionText(cue.direction, locale)}`;
    case "bend":
      if (event.phase !== "final") return null;
      return locale === "he-IL"
        ? `עיקול ${directionText(cue.direction, locale)}`
        : `Bend ${directionText(cue.direction, locale)}`;
    case "arrive":
      return locale === "he-IL" ? "הִגַּעְתָּ לַיַּעַד." : "You have arrived.";
    case "hazard":
    case "caution":
      return locale === "he-IL" ? `${prefix}שים לב.` : `${prefix}Caution.`;
    default:
      return null;
  }
}

function utteranceIdFor(event) {
  if (!event) return null;
  if (event.kind === "off-route") return "state:off-route";
  if (event.kind === "acquired") {
    return event.acquisition === "reacquired"
      ? "state:acquired:reacquired"
      : "state:acquired:initial";
  }
  if (event.kind === "cue") {
    const cue = event.cue || {};
    return `cue:${cue.type}:${cue.distanceMeters}:${event.phase}`;
  }
  return null;
}

function priorityFor(event) {
  if (!event) return PRIORITY.info;
  if (event.kind === "off-route") return PRIORITY.alert;
  if (event.kind === "acquired") return PRIORITY.info;
  if (event.kind === "cue") {
    if (event.cueType === "arrive") return PRIORITY.alert;
    return event.phase === "final" ? PRIORITY.final : PRIORITY.preview;
  }
  return PRIORITY.info;
}

function isRepeatableStateEvent(event) {
  return event?.kind === "off-route" || event?.kind === "acquired";
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
    return { utterance, reason: null };
  }

  function snapshot() {
    return {
      version: 1,
      spokenIds: Array.from(spokenIds),
      lastSpokenAt,
      lastUtterance,
    };
  }

  function reset(nextMemory = null) {
    spokenIds.clear();
    if (Array.isArray(nextMemory?.spokenIds)) {
      for (const id of nextMemory.spokenIds) spokenIds.add(id);
    }
    lastSpokenAt = finite(nextMemory?.lastSpokenAt);
    lastUtterance = nextMemory?.lastUtterance || null;
  }

  return { plan, snapshot, reset };
}
