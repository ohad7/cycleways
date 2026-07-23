import { basename } from "node:path";

function clipId(index) {
  return `clip-${String(index + 1).padStart(3, "0")}`;
}

export function sourceClipFromLegacy(source = {}, index = 0) {
  return {
    id: source.id || clipId(index),
    kind: source.kind || (source.csvPath ? "aligned-csv" : "gopro-mp4"),
    path: source.path || null,
    csvPath: source.csvPath || null,
    sha256: source.sha256 || null,
    csvSha256: source.csvSha256 || null,
    trim: {
      inSeconds: Math.max(0, Number(source.trim?.inSeconds) || 0),
      outSeconds: source.trim?.outSeconds ?? null,
    },
    gpsOffsetSeconds: Number(source.gpsOffsetSeconds) || 0,
    timeline: source.timeline || null,
  };
}

export function normalizeSourceClips(inputs = {}) {
  const raw = Array.isArray(inputs.sources) && inputs.sources.length
    ? inputs.sources
    : inputs.source?.path
      ? [inputs.source]
      : [];
  return raw.map((source, index) => ({
    ...sourceClipFromLegacy(source, index),
    id: source.id || clipId(index),
  }));
}

export function sourceTimeline(project) {
  const clips = normalizeSourceClips(project?.inputs || {});
  let cursorMs = 0;
  return clips.map((clip) => {
    const trimInMs = Math.round(Math.max(0, Number(clip.trim?.inSeconds) || 0) * 1000);
    const explicitOut = Number(clip.trim?.outSeconds);
    const durationMs = Number.isFinite(explicitOut)
      ? Math.max(0, Math.round(explicitOut * 1000) - trimInMs)
      : Math.max(0, Number(clip.timeline?.durationMs) || 0);
    const timeline = clip.timeline && Number.isFinite(Number(clip.timeline.inMs))
      ? {
          inMs: Math.round(Number(clip.timeline.inMs)),
          outMs: Math.round(Number(clip.timeline.outMs)),
          sourceInMs: Math.round(Number(clip.timeline.sourceInMs ?? trimInMs)),
          sourceOutMs: Math.round(Number(clip.timeline.sourceOutMs ?? (trimInMs + durationMs))),
          durationMs: Math.round(Number(clip.timeline.durationMs ?? durationMs)),
        }
      : {
          inMs: cursorMs,
          outMs: cursorMs + durationMs,
          sourceInMs: trimInMs,
          sourceOutMs: trimInMs + durationMs,
          durationMs,
        };
    cursorMs = Math.max(cursorMs, timeline.outMs);
    return { ...clip, timeline };
  });
}

export function projectSourceDurationMs(project) {
  return sourceTimeline(project).at(-1)?.timeline.outMs || 0;
}

export function splitGlobalSegmentsAcrossClips(segments, clips) {
  const orderedClips = clips || [];
  const result = [];
  for (const segment of segments || []) {
    for (const clip of orderedClips) {
      const overlapIn = Math.max(Number(segment.inMs), clip.timeline.inMs);
      const overlapOut = Math.min(Number(segment.outMs), clip.timeline.outMs);
      if (overlapOut <= overlapIn) continue;
      result.push({
        ...segment,
        inMs: overlapIn,
        outMs: overlapOut,
        sourceId: clip.id,
        sourceInMs: clip.timeline.sourceInMs + overlapIn - clip.timeline.inMs,
        sourceOutMs: clip.timeline.sourceInMs + overlapOut - clip.timeline.inMs,
      });
    }
  }
  return result;
}

export function summarizeSourceClip(clip) {
  return {
    id: clip.id,
    name: basename(clip.path || clip.id),
    kind: clip.kind,
    path: clip.path,
    csvPath: clip.csvPath,
    timeline: clip.timeline || null,
  };
}

