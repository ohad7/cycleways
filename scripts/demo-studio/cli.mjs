import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runDoctor } from "./doctor.mjs";
import { previewDemoProjectMutation } from "./projectState.mjs";
import { commandResult, formatProjectStatus } from "./status.mjs";
import { createProjectWorkspace, listProjectRevisions, readProject, restoreProjectRevision, updateProject } from "./workspace.mjs";
import { normalizeSourceClips } from "./sources.mjs";

const FLAG_DEFINITIONS = Object.freeze({
  "--project": "value",
  "--source": "value",
  "--route": "value",
  "--route-token": "value",
  "--reason": "value",
  "--note": "value",
  "--run": "value",
  "--video": "value",
  "--csv": "value",
  "--manifest": "value",
  "--bundle": "value",
  "--edit": "value",
  "--out": "value",
  "--output": "value",
  "--retry-from": "value",
  "--port": "value",
  "--host": "value",
  "--json": "boolean",
  "--non-interactive": "boolean",
  "--yes": "boolean",
  "--share-endpoints": "boolean",
  "--allow-lan": "boolean",
  "--open": "boolean",
  "--force": "boolean",
  "--help": "boolean",
  "-h": "boolean",
});

const ANSI = Object.freeze({
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
});

function paint(value, style, enabled) {
  return enabled ? `${style}${value}${ANSI.reset}` : value;
}

export function terminalColorsEnabled({ isTTY = output.isTTY, env = process.env } = {}) {
  if (Object.prototype.hasOwnProperty.call(env, "NO_COLOR")) return false;
  if (Object.prototype.hasOwnProperty.call(env, "FORCE_COLOR")) return env.FORCE_COLOR !== "0";
  return isTTY === true;
}

function stripMatchingQuotes(value) {
  if (value.length < 2) return value;
  const quote = value[0];
  return (quote === "\"" || quote === "'") && value.at(-1) === quote ? value.slice(1, -1) : value;
}

function expandHome(value) {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function unescapePastedShellPath(value) {
  // Terminal drag/drop commonly inserts shell escapes. A readline prompt does
  // not remove them as a shell would, so try the pasted form as a fallback.
  return value.replace(/\\([\\\s'"()&;[\]{}!#$`])/g, "$1");
}

export function resolveOperatorPath(value, { cwd = process.cwd(), pathExists = existsSync } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("path must not be empty");
  const unquoted = stripMatchingQuotes(raw);
  const unescaped = unescapePastedShellPath(unquoted);
  const candidates = [...new Set([raw, unquoted, unescaped].map(expandHome).map((candidate) => resolve(cwd, candidate)))];
  return candidates.find((candidate) => pathExists(candidate)) || candidates.at(-1);
}

export function formatDoctorHuman(doctor, { next, unavailable = [], color = false } = {}) {
  const stateStyles = { ready: ANSI.green, warning: ANSI.yellow, blocked: ANSI.red };
  const checks = doctor.checks.map((check) => {
    const state = check.state.padEnd(8);
    return `${check.name.padEnd(12)} ${paint(state, stateStyles[check.state] || ANSI.dim, color)} ${check.detail}`;
  });
  const summary = commandResult({
    result: doctor.ok ? "Available studio stages are shown above" : `${doctor.blocking.length} inspection prerequisite(s) blocked`,
    why: unavailable.length ? `Not ready yet: ${unavailable.join(", ")}` : "Inspect, capture, and render prerequisites are ready",
    next,
  }).split("\n").map((line) => {
    const match = /^(RESULT|WHY|NEXT)(\s+)/.exec(line);
    if (!match) return line;
    const style = match[1] === "RESULT" ? (doctor.ok ? ANSI.green : ANSI.red) : match[1] === "WHY" ? ANSI.yellow : ANSI.cyan;
    return `${paint(match[1], `${ANSI.bold}${style}`, color)}${match[2]}${line.slice(match[0].length)}`;
  });
  return [...checks, ...summary].join("\n");
}

export function parseCliArguments(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith("-") || /^-\d+(?:\.\d+)?$/.test(arg)) {
      positional.push(arg);
      continue;
    }
    const definition = FLAG_DEFINITIONS[arg];
    if (!definition) throw new Error(`unknown option ${arg}`);
    if (definition === "boolean") {
      options[arg.slice(arg.startsWith("--") ? 2 : 1)] = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    const key = arg.slice(2);
    if (["source", "csv"].includes(key) && options[key] !== undefined) {
      options[key] = Array.isArray(options[key]) ? [...options[key], value] : [options[key], value];
    } else {
      options[key] = value;
    }
  }
  return { positional, options };
}

function parseValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (value !== "" && Number.isFinite(Number(value))) return Number(value);
  if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
    return JSON.parse(value);
  }
  return value;
}

function kindFromAttempt(id) {
  if (id === "inputs" || id.startsWith("inputs-")) return "inputs";
  if (id.startsWith("capture-")) return "capture";
  if (id.startsWith("voice-")) return "voice";
  if (id.startsWith("render-")) return "render";
  throw new Error(`cannot infer attempt kind from "${id}"`);
}

async function askMissing(options, nonInteractive) {
  if (options.source && (options.route || options["route-token"])) return options;
  if (nonInteractive || !input.isTTY) {
    throw new Error("new requires --source and --route in non-interactive mode");
  }
  const prompt = createInterface({ input, output });
  try {
    return {
      ...options,
      source: options.source || await prompt.question("GoPro video or aligned CSV path: "),
      route: options.route || options["route-token"] || await prompt.question("Catalog route slug: "),
    };
  } finally {
    prompt.close();
  }
}

export function helpText() {
  return `CycleWays Navigation Demo Studio

Operator workflow:
  npm run demo:studio                    open the complete local web studio
  new <name> --source <video> [--source <next-video>] --route <slug>
  doctor | status | inspect | review
  configure <field> <value> --reason <why>
  route set <slug>
  validate | capture proof | render proof
  accept|reject <attempt-id> --note <text>
  make proof | publish proof | history | restore <revision>

Expert stages:
  compile --manifest <path> [--out <dir>]
  serve --bundle <path>
  capture-ios --bundle <path> --output <mov>
  render --edit <path>

All project commands accept --project <project.json-or-directory> and --json.`;
}

async function requireProject(options) {
  return readProject(options.project ? resolve(options.project) : undefined);
}

async function outputResult(io, options, payload, human) {
  io.log(options.json ? JSON.stringify(payload, null, 2) : human);
  return payload;
}

function launcherNext(project) {
  return formatProjectStatus(project).status.next.replace("demo:studio ", "./studio ");
}

export async function runCli(argv, io = console, deps = {}) {
  const { positional, options } = parseCliArguments(argv);
  const [command, ...rest] = positional;
  if (!command) {
    const { launchStudio } = await import("./studioServer.mjs");
    return launchStudio({ options, io });
  }
  if (options.help || options.h || command === "help") {
    io.log(helpText());
    return { ok: true, code: "HELP" };
  }

  if (command === "new") {
    if (rest.length !== 1) {
      const pathHint = rest.length > 1 ? '; wrap paths containing spaces in quotes, for example --source "/path/My Ride.mp4"' : "";
      throw new Error(`usage: new <name> --source <path> --route <slug>${pathHint}`);
    }
    const values = await askMissing(options, options["non-interactive"]);
    const rawSources = Array.isArray(values.source) ? values.source : [values.source];
    const rawCsv = values.csv === undefined ? [] : Array.isArray(values.csv) ? values.csv : [values.csv];
    const sourcePaths = rawSources.map((value) => resolveOperatorPath(value));
    const created = await createProjectWorkspace({
      id: rest[0],
      sourcePath: sourcePaths[0],
      csvPath: rawCsv[0] ? resolveOperatorPath(rawCsv[0]) : null,
      routeValue: values.route || values["route-token"],
      workspaceRoot: deps.workspaceRoot,
    });
    let acknowledged = await updateProject(created.path, {
      type: "privacy-acknowledged",
      shareExactEndpoints: values["share-endpoints"] === true,
      reason: "project-created",
    });
    if (values["route-token"]) {
      acknowledged = await updateProject(created.path, {
        type: "configure",
        field: "route.kind",
        value: "route-token",
        reason: "route-token-selected",
      });
    }
    if (sourcePaths.length > 1) {
      acknowledged = await updateProject(created.path, {
        type: "replace-sources",
        sources: sourcePaths.map((path, index) => ({
          path,
          csvPath: rawCsv[index] ? resolveOperatorPath(rawCsv[index]) : null,
          kind: rawCsv[index] ? "aligned-csv" : "gopro-mp4",
        })),
        reason: "multi-clip-project-created",
      });
    }
    return outputResult(io, options, { ok: true, code: "PROJECT_CREATED", project: acknowledged.path }, commandResult({
      result: `Created demo project ${rest[0]}`,
      wrote: acknowledged.path,
      next: `cd ${acknowledged.directory} && ./studio doctor`,
    }));
  }

  // Compilation is the one intentionally project-free expert command. Keeping
  // it ahead of project discovery makes manifests usable in CI and tooling.
  if (command === "compile") {
    const { compileManifestCommand } = await import("./pipeline.mjs");
    return compileManifestCommand({ options, io, outputResult, commandResult });
  }

  const loaded = await requireProject(options);
  if (command === "status") {
    const formatted = formatProjectStatus(loaded.project);
    return outputResult(io, options, { ok: true, code: "STATUS", ...formatted.status }, formatted.text);
  }
  if (command === "doctor") {
    const doctor = await runDoctor({ projectPath: loaded.path, project: loaded.project });
    const unavailable = Object.entries(doctor.capabilities).filter(([, ready]) => !ready).map(([name]) => name);
    const desiredNext = formatProjectStatus(loaded.project).status.next;
    const desiredCapability = desiredNext.includes("capture") ? "capture" : desiredNext.includes("render") || desiredNext.includes("publish") ? "render" : "inspect";
    const next = doctor.capabilities[desiredCapability]
      ? desiredNext.replace("demo:studio ", "./studio ")
      : `resolve the ${desiredCapability} checks above, then rerun ./studio doctor`;
    const human = formatDoctorHuman(doctor, {
      next,
      unavailable,
      color: !options.json && terminalColorsEnabled(),
    });
    return outputResult(io, options, { ok: doctor.ok, code: doctor.ok ? "DOCTOR_READY" : "DOCTOR_BLOCKED", ...doctor }, human);
  }
  if (command === "configure") {
    if (rest.length !== 2) throw new Error("usage: configure <field> <value> --reason <why>");
    if (!options.reason) throw new Error("configure requires --reason so project history remains understandable");
    const value = ["source.path", "source.csvPath"].includes(rest[0]) && rest[1] !== "null"
      ? resolveOperatorPath(rest[1])
      : parseValue(rest[1]);
    const preview = previewDemoProjectMutation(loaded.project, rest[0], value);
    if (!options.yes) {
      const impact = `Would invalidate: ${preview.invalidated.join(", ") || "nothing"}`;
      if (options["non-interactive"] || !input.isTTY) {
        return outputResult(io, options, { ok: false, code: "CONFIRMATION_REQUIRED", preview }, commandResult({
          result: "Change was not saved",
          why: impact,
          next: "rerun with --yes after reviewing the impact",
        }));
      }
      io.log(commandResult({ result: `Preview ${rest[0]}: ${JSON.stringify(preview.previous)} → ${JSON.stringify(value)}`, why: impact }));
      const prompt = createInterface({ input, output });
      const answer = await prompt.question("Save this revision? [y/N] ");
      prompt.close();
      if (!/^y(es)?$/i.test(answer.trim())) {
        return outputResult(io, options, { ok: false, code: "CANCELLED", preview }, commandResult({ result: "Change was not saved", kept: `Project remains at revision ${loaded.project.revision}`, next: "adjust the value or reason and try again" }));
      }
    }
    const updated = await updateProject(loaded.path, { type: "configure", field: rest[0], value, reason: options.reason });
    return outputResult(io, options, { ok: true, code: "PROJECT_UPDATED", preview, revision: updated.project.revision }, commandResult({
      result: `Updated ${rest[0]}`,
      why: `Invalidated: ${updated.invalidated.join(", ") || "nothing"}`,
      wrote: updated.path,
      next: launcherNext(updated.project),
    }));
  }
  if (command === "route") {
    if (rest[0] !== "set" || rest.length !== 2) throw new Error("usage: route set <slug>");
    const updated = await updateProject(loaded.path, { type: "configure", field: "route.value", value: rest[1], reason: options.reason || "operator-selected-route" });
    return outputResult(io, options, { ok: true, code: "ROUTE_SELECTED", invalidated: updated.invalidated }, commandResult({
      result: `Selected route ${rest[1]}`,
      why: `Invalidated: ${updated.invalidated.join(", ")}`,
      next: "./studio validate",
    }));
  }
  if (command === "accept" || command === "reject") {
    if (rest.length !== 1) throw new Error(`usage: ${command} <attempt-id> --note <text>`);
    const kind = kindFromAttempt(rest[0]);
    const updated = await updateProject(loaded.path, { type: command, kind, attemptId: rest[0], note: options.note || null, reason: options.note || `${command}ed-by-operator` });
    return outputResult(io, options, { ok: true, code: `ATTEMPT_${command.toUpperCase()}ED`, attemptId: rest[0] }, commandResult({
      result: `${command === "accept" ? "Accepted" : "Rejected"} ${rest[0]}`,
      kept: "All previous attempts remain available",
      next: launcherNext(updated.project),
    }));
  }
  if (command === "history") {
    const text = await readFile(resolve(loaded.directory, "history.jsonl"), "utf8");
    const events = text.trim() ? text.trim().split("\n").map(JSON.parse) : [];
    const human = events.length
      ? events.map((event) => `r${event.revision} ${event.at} ${event.type} ${event.reason || ""}`).join("\n")
      : "No project changes recorded.";
    const revisions = await listProjectRevisions(loaded.path);
    return outputResult(io, options, { ok: true, code: "HISTORY", events, revisions }, human);
  }
  if (command === "restore") {
    if (rest.length !== 1 || !Number.isInteger(Number(rest[0]))) throw new Error("usage: restore <revision> --yes");
    if (!options.yes) {
      return outputResult(io, options, { ok: false, code: "CONFIRMATION_REQUIRED", targetRevision: Number(rest[0]) }, commandResult({
        result: "Revision was not restored",
        why: "Restoring changes current decisions but preserves every immutable attempt",
        next: `rerun ./studio restore ${rest[0]} --yes`,
      }));
    }
    const restored = await restoreProjectRevision(loaded.path, Number(rest[0]), {
      reason: options.reason || `operator-restored-revision-${rest[0]}`,
    });
    return outputResult(io, options, { ok: true, code: "REVISION_RESTORED", revision: restored.project.revision, targetRevision: Number(rest[0]) }, commandResult({
      result: `Restored project decisions from revision ${rest[0]}`,
      kept: "All later captures and renders remain in project history",
      next: launcherNext(restored.project),
    }));
  }
  if (command === "source") {
    const clips = normalizeSourceClips(loaded.project.inputs);
    if (rest[0] === "add" && rest.length === 2) {
      const path = resolveOperatorPath(rest[1]);
      const updated = await updateProject(loaded.path, {
        type: "replace-sources",
        sources: [...clips, { path }],
        reason: options.reason || "source-clip-added",
      });
      return outputResult(io, options, { ok: true, code: "SOURCE_ADDED", sources: updated.project.inputs.sources }, commandResult({
        result: `Added source clip ${path}`,
        why: `The virtual ride now contains ${updated.project.inputs.sources.length} clips`,
        next: "./studio inspect",
      }));
    }
    if (rest[0] === "remove" && rest.length === 2) {
      const remaining = clips.filter((clip) => clip.id !== rest[1]);
      if (remaining.length === clips.length) throw new Error(`unknown source clip "${rest[1]}"`);
      if (!remaining.length) throw new Error("a project must retain at least one source clip");
      const updated = await updateProject(loaded.path, {
        type: "replace-sources",
        sources: remaining,
        reason: options.reason || "source-clip-removed",
      });
      return outputResult(io, options, { ok: true, code: "SOURCE_REMOVED", sources: updated.project.inputs.sources }, commandResult({
        result: `Removed ${rest[1]} from the current timeline`,
        kept: "Earlier revisions and their artifacts remain available",
        next: "./studio inspect",
      }));
    }
    throw new Error("usage: source add <video> | source remove <clip-id>");
  }

  if (command === "inspect") {
    const { inspectProject } = await import("./pipeline.mjs");
    return inspectProject(loaded, { options, io, outputResult, commandResult });
  }
  if (command === "validate") {
    const { validateProject } = await import("./pipeline.mjs");
    return validateProject(loaded, { options, io, outputResult, commandResult });
  }
  if (command === "review") {
    const { reviewProject } = await import("./reviewServer.mjs");
    return reviewProject(loaded, { options, io, outputResult, commandResult });
  }
  if (command === "serve") {
    const { serveProjectCommand } = await import("./captureServer.mjs");
    return serveProjectCommand(loaded, { options, io, outputResult, commandResult });
  }
  if (command === "capture" || command === "capture-ios") {
    const { captureProject } = await import("./captureIos.mjs");
    return captureProject(loaded, { options, io, outputResult, commandResult, alias: command, args: rest });
  }
  if (command === "render") {
    const { renderProject } = await import("./render.mjs");
    return renderProject(loaded, { options, io, outputResult, commandResult, args: rest });
  }
  if (command === "make") {
    if (rest[0] !== "proof") throw new Error("usage: make proof");
    const { makeProof } = await import("./pipeline.mjs");
    return makeProof(loaded, { options, io, outputResult, commandResult });
  }
  if (command === "publish") {
    if (rest[0] !== "proof") throw new Error("usage: publish proof");
    const { publishProof } = await import("./render.mjs");
    return publishProof(loaded, { options, io, outputResult, commandResult });
  }
  throw new Error(`unknown command "${command}"`);
}
