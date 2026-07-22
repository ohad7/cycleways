import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runDoctor } from "./doctor.mjs";
import { previewDemoProjectMutation } from "./projectState.mjs";
import { commandResult, formatProjectStatus } from "./status.mjs";
import { createProjectWorkspace, readProject, updateProject } from "./workspace.mjs";

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
    options[arg.slice(2)] = value;
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
  if (options.source && options.route) return options;
  if (nonInteractive || !input.isTTY) {
    throw new Error("new requires --source and --route in non-interactive mode");
  }
  const prompt = createInterface({ input, output });
  try {
    return {
      ...options,
      source: options.source || await prompt.question("GoPro video or aligned CSV path: "),
      route: options.route || await prompt.question("Catalog route slug: "),
    };
  } finally {
    prompt.close();
  }
}

export function helpText() {
  return `CycleWays Navigation Demo Studio

Operator workflow:
  new <name> --source <video> [--csv <aligned-gps.csv>] --route <slug>
  doctor | status | inspect | review
  configure <field> <value> --reason <why>
  route set <slug>
  validate | capture proof | render proof
  accept|reject <attempt-id> --note <text>
  make proof | publish proof | history

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

export async function runCli(argv, io = console) {
  const { positional, options } = parseCliArguments(argv);
  const [command, ...rest] = positional;
  if (!command || options.help || options.h || command === "help") {
    io.log(helpText());
    return { ok: true, code: "HELP" };
  }

  if (command === "new") {
    if (rest.length !== 1) throw new Error("usage: new <name> --source <path> --route <slug>");
    const values = await askMissing(options, options["non-interactive"]);
    const created = await createProjectWorkspace({
      id: rest[0],
      sourcePath: resolve(values.source),
      csvPath: values.csv ? resolve(values.csv) : null,
      routeValue: values.route,
    });
    const acknowledged = await updateProject(created.path, {
      type: "privacy-acknowledged",
      shareExactEndpoints: values["share-endpoints"] === true,
      reason: "project-created",
    });
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
    const human = [
      ...doctor.checks.map((check) => `${check.name.padEnd(12)} ${check.state.padEnd(8)} ${check.detail}`),
      commandResult({
        result: doctor.ok ? "Available studio stages are shown above" : `${doctor.blocking.length} inspection prerequisite(s) blocked`,
        why: unavailable.length ? `Not ready yet: ${unavailable.join(", ")}` : "Inspect, capture, and render prerequisites are ready",
        next,
      }),
    ].join("\n");
    return outputResult(io, options, { ok: doctor.ok, code: doctor.ok ? "DOCTOR_READY" : "DOCTOR_BLOCKED", ...doctor }, human);
  }
  if (command === "configure") {
    if (rest.length !== 2) throw new Error("usage: configure <field> <value> --reason <why>");
    if (!options.reason) throw new Error("configure requires --reason so project history remains understandable");
    const value = parseValue(rest[1]);
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
    return outputResult(io, options, { ok: true, code: "HISTORY", events }, human);
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
