import { spawnChecked } from "./process.mjs";

export function findGpmfStream(probe) {
  return (probe?.streams || []).find((stream) => {
    const tag = String(stream.codec_tag_string || stream.codec_name || "").toLowerCase();
    return tag === "gpmd" || (stream.codec_type === "data" && tag.includes("gpm"));
  }) || null;
}

export function parseProbe(value) {
  const durationSeconds = Number(value?.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("ffprobe did not report a positive media duration");
  }
  const streams = Array.isArray(value.streams) ? value.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video") || null;
  const audio = streams.find((stream) => stream.codec_type === "audio") || null;
  return {
    durationSeconds,
    video: video ? {
      codec: video.codec_name || null,
      width: Number(video.width) || null,
      height: Number(video.height) || null,
      frameRate: video.avg_frame_rate || video.r_frame_rate || null,
    } : null,
    audio: audio ? { codec: audio.codec_name || null, sampleRate: Number(audio.sample_rate) || null, channels: Number(audio.channels) || null } : null,
    telemetry: findGpmfStream(value) ? { kind: "gpmf", streamIndex: findGpmfStream(value).index } : null,
    raw: value,
  };
}

export async function probeMedia(path, deps = {}) {
  const run = deps.spawnChecked || spawnChecked;
  const result = await run("ffprobe", [
    "-v", "error",
    "-show_streams",
    "-show_format",
    "-of", "json",
    path,
  ]);
  let raw;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    throw new Error("ffprobe returned invalid JSON");
  }
  return parseProbe(raw);
}
