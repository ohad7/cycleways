import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEMO_REPOSITORY_ROOT, readProject, writeJsonAtomic } from "./workspace.mjs";

const ALLOWED_JOBS = new Map([
  ["doctor", ["doctor"]],
  ["inspect", ["inspect"]],
  ["validate", ["validate"]],
  ["capture", ["capture", "proof"]],
  ["render", ["render", "proof"]],
  ["publish", ["publish", "proof"]],
]);

export function studioJobCommand(kind, options = {}, project = null) {
  const base = ALLOWED_JOBS.get(kind);
  if (!base) throw new Error(`unsupported studio job "${kind}"`);
  const retryFrom = options.retryFrom || null;
  if (!retryFrom) return [...base];
  if (kind !== "capture") throw new Error("retryFrom is only supported for capture jobs");
  if (!/^capture-\d+$/.test(retryFrom)) throw new Error("capture retry source has an invalid id");
  const attempt = project?.attempts?.capture?.find((item) => item.id === retryFrom);
  if (!attempt) throw new Error(`capture retry source "${retryFrom}" does not exist`);
  if (attempt.state !== "completed" || !attempt.artifact) throw new Error(`capture retry source "${retryFrom}" is not complete`);
  if (attempt.staleAtRevision) throw new Error(`capture retry source "${retryFrom}" is stale because ${attempt.staleReason}`);
  return [...base, "--retry-from", retryFrom];
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}

function jobPaths(directory, id) {
  return {
    json: join(directory, "jobs", `${id}.json`),
    log: join(directory, "jobs", `${id}.log`),
  };
}

async function nextJobId(directory) {
  await mkdir(join(directory, "jobs"), { recursive: true });
  const names = await readdir(join(directory, "jobs")).catch(() => []);
  const highest = Math.max(0, ...names.map((name) => Number(name.match(/^job-(\d+)\.json$/)?.[1])).filter(Number.isFinite));
  return `job-${String(highest + 1).padStart(3, "0")}`;
}

export async function recoverInterruptedJobs(projectPath) {
  const loaded = await readProject(projectPath);
  await mkdir(join(loaded.directory, "jobs"), { recursive: true });
  const names = await readdir(join(loaded.directory, "jobs"));
  const recovered = [];
  for (const name of names.filter((value) => /^job-\d+\.json$/.test(value))) {
    const path = join(loaded.directory, "jobs", name);
    const job = await readJson(path);
    if (job?.state !== "running" && job?.state !== "cancelling") continue;
    if (Number.isInteger(job.pid)) {
      try {
        process.kill(job.pid, 0);
        continue;
      } catch {}
    }
    const updated = {
      ...job,
      state: "interrupted",
      finishedAt: new Date().toISOString(),
      reason: "studio-server-restarted",
      retryable: true,
    };
    await writeJsonAtomic(path, updated);
    recovered.push(updated);
  }
  return recovered;
}

export async function listStudioJobs(projectPath) {
  const loaded = await readProject(projectPath);
  const directory = join(loaded.directory, "jobs");
  await mkdir(directory, { recursive: true });
  const names = (await readdir(directory)).filter((name) => /^job-\d+\.json$/.test(name)).sort();
  const jobs = [];
  for (const name of names) {
    const job = await readJson(join(directory, name));
    if (!job) continue;
    const logPath = join(directory, `${job.id}.log`);
    const log = await readFile(logPath, "utf8").catch(() => "");
    jobs.push({ ...job, log: log.slice(-24_000) });
  }
  return jobs;
}

export function createStudioJobManager() {
  async function start(projectPath, kind, options = {}) {
    const loaded = await readProject(projectPath);
    const args = studioJobCommand(kind, options, loaded.project);
    const existing = (await listStudioJobs(projectPath)).find((job) => job.state === "running" || job.state === "cancelling");
    if (existing) throw new Error(`${existing.id} is already running ${existing.kind}`);
    const id = await nextJobId(loaded.directory);
    const paths = jobPaths(loaded.directory, id);
    const job = {
      schemaVersion: 1,
      id,
      kind,
      state: "running",
      projectId: loaded.project.id,
      projectRevision: loaded.project.revision,
      command: args,
      startedAt: new Date().toISOString(),
      retryable: false,
    };
    await writeJsonAtomic(paths.json, job);
    await writeFile(paths.log, `Starting ${kind} for ${loaded.project.id}\n`, { flag: "wx" });
    const child = spawn(process.execPath, [
      join(DEMO_REPOSITORY_ROOT, "scripts", "demo-studio", "studioJobRunner.mjs"),
      paths.json,
      paths.log,
      loaded.path,
      kind,
      ...args,
    ], {
      cwd: DEMO_REPOSITORY_ROOT,
      env: process.env,
      detached: true,
      shell: false,
      stdio: "ignore",
    });
    child.unref();
    const running = { ...job, pid: child.pid };
    return running;
  }

  async function cancel(projectPath, jobId) {
    const loaded = await readProject(projectPath);
    const paths = jobPaths(loaded.directory, jobId);
    if (!existsSync(paths.json)) throw new Error(`unknown job "${jobId}"`);
    const job = await readJson(paths.json);
    if (job.state !== "running") throw new Error(`${jobId} is not running`);
    await writeJsonAtomic(paths.json, { ...job, state: "cancelling", cancelRequestedAt: new Date().toISOString() });
    if (Number.isInteger(job.pid)) {
      try { process.kill(-job.pid, "SIGTERM"); } catch {
        try { process.kill(job.pid, "SIGTERM"); } catch {}
      }
    }
    return { ...job, state: "cancelling" };
  }

  return { start, cancel };
}
