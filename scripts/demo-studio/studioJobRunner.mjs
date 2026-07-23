#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";
import { runCli } from "./cli.mjs";
import { writeJsonAtomic } from "./workspace.mjs";

const [jobPath, logPath, projectPath, kind, ...command] = process.argv.slice(2);
if (!jobPath || !logPath || !projectPath || !kind || !command.length) {
  throw new Error("studio job runner arguments are incomplete");
}

const append = (value) => appendFile(logPath, `${String(value)}\n`).catch(() => {});
const update = async (patch) => {
  const current = JSON.parse(await readFile(jobPath, "utf8"));
  await writeJsonAtomic(jobPath, { ...current, ...patch });
};

let cancelled = false;
const stop = async () => {
  cancelled = true;
  await update({
    state: "cancelled",
    finishedAt: new Date().toISOString(),
    reason: "cancelled-by-operator",
    retryable: true,
  }).catch(() => {});
  process.exit(143);
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

try {
  await update({ pid: process.pid });
  const result = await runCli([...command, "--project", projectPath, "--non-interactive"], {
    log: append,
    warn: append,
    error: append,
  });
  if (!cancelled) {
    await update({
      state: result?.ok === false ? "failed" : "completed",
      finishedAt: new Date().toISOString(),
      exitCode: result?.ok === false ? 2 : 0,
      reason: result?.ok === false ? result.code || "studio-command-failed" : null,
      retryable: result?.ok === false,
    });
  }
} catch (error) {
  await append(error.stack || error.message);
  if (!cancelled) {
    await update({
      state: "failed",
      finishedAt: new Date().toISOString(),
      exitCode: 1,
      reason: error.message,
      retryable: true,
    });
  }
  process.exitCode = 1;
}
