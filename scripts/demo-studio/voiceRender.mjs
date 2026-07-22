import { createHash } from "node:crypto";
import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnChecked } from "./process.mjs";

const swiftRenderer = fileURLToPath(new URL("renderVoice.swift", import.meta.url));

export function voiceClipKey({ text, language = "he-IL", voice = "default", rate = 0.92 }) {
  return createHash("sha256").update(JSON.stringify({ text, language, voice, rate })).digest("hex");
}

export function voicePlacementsFromEvents(events, { originMs = 0 } = {}) {
  const starts = (events || []).filter((event) => event.kind === "speech-start").sort((a, b) => a.sequence - b.sequence);
  return starts.map((event, index) => {
    const next = starts[index + 1];
    const id = event.payload?.utteranceId || event.payload?.text || `speech-${event.sequence}`;
    const done = (events || []).find((candidate) => candidate.sequence > event.sequence && candidate.kind === "speech-done" && (candidate.payload?.utteranceId || candidate.payload?.text) === (event.payload?.utteranceId || event.payload?.text));
    return {
      id,
      text: event.payload?.text || "",
      language: event.payload?.language || "he-IL",
      rate: Number(event.payload?.rate) || 0.92,
      startMs: Math.max(0, Number(event.mediaTimeMs) - originMs),
      trimAtMs: next?.payload?.interruptsCurrentSpeech === true ? Math.max(0, Number(next.mediaTimeMs) - Number(event.mediaTimeMs)) : done ? Math.max(0, Number(done.mediaTimeMs) - Number(event.mediaTimeMs)) : null,
    };
  });
}

export function buildVoiceMixArgs(placements, output) {
  if (placements.length === 0) {
    return ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "0.1", "-c:a", "pcm_s16le", output];
  }
  const args = ["-y"];
  for (const placement of placements) args.push("-i", placement.clip);
  const chains = placements.map((placement, index) => {
    const trim = placement.trimAtMs ? `,atrim=duration=${(placement.trimAtMs / 1000).toFixed(3)}` : "";
    return `[${index}:a]aresample=48000${trim},adelay=${Math.round(placement.startMs)}|${Math.round(placement.startMs)}[v${index}]`;
  });
  const inputs = placements.map((_, index) => `[v${index}]`).join("");
  args.push("-filter_complex", `${chains.join(";")};${inputs}amix=inputs=${placements.length}:duration=longest:normalize=0[out]`, "-map", "[out]", "-ar", "48000", "-c:a", "pcm_s16le", output);
  return args;
}

export async function renderVoiceStem(events, { output, cacheDirectory, voice = "default", originMs = 0, deps = {} } = {}) {
  const run = deps.spawnChecked || spawnChecked;
  const placements = voicePlacementsFromEvents(events, { originMs });
  await mkdir(cacheDirectory, { recursive: true });
  await mkdir(dirname(output), { recursive: true });
  for (const placement of placements) {
    const key = voiceClipKey({ ...placement, voice });
    const clip = join(cacheDirectory, `${key}.wav`);
    placement.clip = clip;
    let valid = false;
    try {
      const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", clip]);
      valid = Number(probe.stdout.trim()) > 0;
    } catch {}
    if (!valid) {
      const moduleCache = join(cacheDirectory, "swift-modules");
      await mkdir(moduleCache, { recursive: true });
      const temporary = join(cacheDirectory, `.${key}.${process.pid}.wav`);
      try {
        await run("swift", ["-module-cache-path", moduleCache, swiftRenderer, "--output", temporary, "--text", placement.text, "--language", placement.language, "--voice", voice, "--rate", String(placement.rate)]);
        const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", temporary]);
        if (!(Number(probe.stdout.trim()) > 0)) throw new Error("rendered speech clip has no duration");
        await rename(temporary, clip);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
    }
  }
  await run("ffmpeg", buildVoiceMixArgs(placements, output));
  return { output, placements, voice };
}
