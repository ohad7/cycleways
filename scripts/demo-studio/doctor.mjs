import { access, readFile, statfs } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { toolVersion, spawnChecked } from "./process.mjs";
import { normalizeSourceClips } from "./sources.mjs";

const voiceRenderer = fileURLToPath(new URL("renderVoice.swift", import.meta.url));
const mobileEnv = fileURLToPath(new URL("../../apps/mobile/.env", import.meta.url));

function shortError(error) {
  const message = String(error?.message || error).split("\n")[0];
  return message.length > 180 ? `${message.slice(0, 177)}…` : message;
}

async function hasMapToken() {
  if (String(process.env.EXPO_PUBLIC_MAPBOX_TOKEN || "").trim()) return true;
  try {
    return /^\s*EXPO_PUBLIC_MAPBOX_TOKEN\s*=\s*\S+/m.test(await readFile(mobileEnv, "utf8"));
  } catch {
    return false;
  }
}

export async function runDoctor({ projectPath, project, platform = process.platform, tool = toolVersion, deps = {} } = {}) {
  const run = deps.spawnChecked || spawnChecked;
  const checks = [];
  for (const [name, args, blocking] of [
    ["ffmpeg", ["-version"], true],
    ["ffprobe", ["-version"], true],
    ["exiftool", ["-ver"], true],
  ]) {
    const result = await tool(name, args);
    checks.push({ name, state: result.available ? "ready" : "blocked", blocking, affects: ["inspect", "render"], detail: result.version || result.error });
  }
  const swift = await tool("swift", ["--version"]);
  checks.push({ name: "swift", state: swift.available ? "ready" : "blocked", blocking: false, affects: ["render"], detail: swift.version || swift.error });
  const sources = normalizeSourceClips(project?.inputs || {});
  if (sources.length) {
    const unreadable = [];
    for (const source of sources) {
      try { await access(source.path, constants.R_OK); } catch { unreadable.push(source.id); }
    }
    checks.push({
      name: "source",
      state: unreadable.length ? "blocked" : "ready",
      blocking: true,
      affects: ["inspect"],
      detail: unreadable.length ? `unreadable: ${unreadable.join(", ")}` : `${sources.length} readable clip${sources.length === 1 ? "" : "s"}`,
    });
  } else {
    checks.push({ name: "source", state: "blocked", blocking: true, affects: ["inspect"], detail: "no source selected" });
  }
  const csvSources = sources.filter((source) => source.kind === "aligned-csv");
  if (csvSources.length) {
    const unreadable = [];
    for (const source of csvSources) {
      try { await access(source.csvPath, constants.R_OK); } catch { unreadable.push(source.id); }
    }
    checks.push({
      name: "gps-csv",
      state: unreadable.length ? "blocked" : "ready",
      blocking: true,
      affects: ["inspect"],
      detail: unreadable.length ? `unreadable: ${unreadable.join(", ")}` : `${csvSources.length} readable sidecar${csvSources.length === 1 ? "" : "s"}`,
    });
  }
  try {
    const disk = await statfs(dirname(projectPath));
    const freeBytes = disk.bavail * disk.bsize;
    checks.push({
      name: "disk",
      state: freeBytes >= 20 * 1024 ** 3 ? "ready" : freeBytes >= 5 * 1024 ** 3 ? "warning" : "blocked",
      blocking: freeBytes < 5 * 1024 ** 3,
      affects: ["capture", "render"],
      detail: `${(freeBytes / 1024 ** 3).toFixed(1)} GB free`,
      freeBytes,
    });
  } catch (error) {
    checks.push({ name: "disk", state: "warning", blocking: false, affects: ["capture", "render"], detail: shortError(error) });
  }
  const mapReady = deps.mapTokenReady ?? await hasMapToken();
  checks.push({ name: "map", state: mapReady ? "ready" : "warning", blocking: false, affects: ["capture"], detail: mapReady ? "Mapbox token configured" : "set EXPO_PUBLIC_MAPBOX_TOKEN before Simulator capture" });
  if (swift.available) {
    try {
      const language = project?.inputs?.captureProfile?.locale || "he-IL";
      const voice = project?.inputs?.captureProfile?.voice || "default";
      const result = await run("swift", ["-module-cache-path", `${tmpdir()}/cycleways-demo-studio-swift-modules`, voiceRenderer, "--check", "--language", language, "--voice", voice], { maxOutputBytes: 8192 });
      checks.push({ name: "voice", state: "ready", blocking: false, affects: ["render"], detail: result.stdout.trim() || `${language} available` });
    } catch (error) {
      checks.push({ name: "voice", state: "blocked", blocking: false, affects: ["render"], detail: shortError(error) });
    }
  } else {
    checks.push({ name: "voice", state: "blocked", blocking: false, affects: ["render"], detail: "Swift is required to verify and render narration" });
  }
  if (platform === "darwin") {
    const xcode = await tool("xcrun", ["--version"]);
    checks.push({ name: "xcode", state: xcode.available ? "ready" : "blocked", blocking: false, affects: ["capture"], detail: xcode.version || xcode.error });
    try {
      const simulators = await run("xcrun", ["simctl", "list", "devices", "booted", "--json"]);
      const parsed = JSON.parse(simulators.stdout);
      const count = Object.values(parsed.devices || {}).flat().filter((device) => device.state === "Booted").length;
      checks.push({
        name: "simulator",
        state: "ready",
        blocking: false,
        affects: ["capture"],
        detail: count ? `${count} booted; capture will use the configured device when available` : "none booted; capture will boot the configured device automatically",
      });
    } catch (error) {
      checks.push({ name: "simulator", state: "warning", blocking: false, affects: ["capture"], detail: `Simulator unavailable: ${shortError(error)}` });
    }
  } else {
    checks.push({ name: "ios-capture", state: "blocked", blocking: false, affects: ["capture"], detail: "iOS capture requires macOS" });
  }
  const blocking = checks.filter((check) => check.blocking && check.state === "blocked");
  const capability = (name) => checks.filter((check) => check.affects?.includes(name)).every((check) => check.state === "ready");
  const capabilities = { inspect: capability("inspect"), capture: capability("capture"), render: capability("render") };
  return { ok: blocking.length === 0, checks, blocking, capabilities };
}
