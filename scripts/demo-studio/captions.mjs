import { createHash } from "node:crypto";

export function captionTextKey(text) {
  return createHash("sha256").update(String(text)).digest("hex").slice(0, 16);
}

function speechId(event) {
  return event?.payload?.utteranceId || event?.payload?.text || `sequence-${event?.sequence}`;
}

export function captionsFromCaptureEvents(events, options = {}) {
  const list = [...(Array.isArray(events) ? events : [])].sort((a, b) => a.sequence - b.sequence);
  const starts = list.filter((event) => event.kind === "speech-start");
  const completions = list.filter((event) => ["speech-done", "speech-error"].includes(event.kind));
  const maxEstimatedMs = Math.max(1000, Number(options.maxEstimatedMs) || 6000);
  const translations = options.translations || {};
  const language = options.language || "he";
  const cues = starts.map((start, index) => {
    const id = speechId(start);
    const nextStart = starts[index + 1] || null;
    const done = completions.find((event) => event.sequence > start.sequence && speechId(event) === id);
    let endMs;
    let endRule;
    if (done) {
      endMs = Number(done.mediaTimeMs);
      endRule = done.kind;
    } else if (nextStart?.payload?.interruptsCurrentSpeech === true) {
      endMs = Number(nextStart.mediaTimeMs);
      endRule = "next-interrupt";
    } else {
      endMs = Number(start.mediaTimeMs) + Math.min(maxEstimatedMs, Math.max(1800, String(start.payload?.text || "").length * 95));
      endRule = "estimated";
    }
    const sourceText = String(start.payload?.text || "").trim();
    const key = captionTextKey(sourceText);
    const text = language === "en" ? translations[id] || translations[key] : sourceText;
    if (language === "en" && !text) throw new Error(`missing reviewed English translation for ${id} (${key})`);
    if (!(endMs > Number(start.mediaTimeMs))) endMs = Number(start.mediaTimeMs) + 1000;
    return {
      id,
      key,
      startMs: Number(start.mediaTimeMs),
      endMs,
      text,
      sourceText,
      language,
      endRule,
      overlaps: false,
    };
  });
  for (let index = 1; index < cues.length; index += 1) {
    if (cues[index].startMs < cues[index - 1].endMs) {
      const sourceEvent = starts[index];
      if (sourceEvent.payload?.interruptsCurrentSpeech === true) cues[index - 1].endMs = cues[index].startMs;
      else {
        cues[index - 1].overlaps = true;
        cues[index].overlaps = true;
      }
    }
  }
  return cues;
}

function srtTimestamp(milliseconds) {
  const value = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  const millis = value % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function writeSrt(cues, { originMs = 0 } = {}) {
  return (Array.isArray(cues) ? cues : []).map((cue, index) => [
    index + 1,
    `${srtTimestamp(cue.startMs - originMs)} --> ${srtTimestamp(cue.endMs - originMs)}`,
    cue.text,
    "",
  ].join("\n")).join("\n");
}

export function remapCuesToSegments(cues, segments) {
  const mapped = [];
  let outputOffsetMs = 0;
  for (const [segmentIndex, segment] of (segments || []).entries()) {
    const inMs = Number(segment.inMs);
    const outMs = Number(segment.outMs);
    for (const cue of cues || []) {
      const clippedStart = Math.max(Number(cue.startMs), inMs);
      const clippedEnd = Math.min(Number(cue.endMs), outMs);
      if (clippedEnd <= clippedStart) continue;
      mapped.push({
        ...cue,
        id: `${cue.id}-showcase-${segmentIndex + 1}`,
        startMs: outputOffsetMs + clippedStart - inMs,
        endMs: outputOffsetMs + clippedEnd - inMs,
      });
    }
    outputOffsetMs += outMs - inMs;
  }
  return mapped;
}
