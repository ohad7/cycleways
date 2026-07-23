import { appendFile, chmod, mkdir, open, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDemoProject, migrateDemoProject, reduceDemoProject } from "./projectState.mjs";

export const DEMO_REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const DEMO_WORKSPACE_ROOT = join(DEMO_REPOSITORY_ROOT, "build", "demo-studio");

export function validateDemoId(id) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || "")) {
    throw new Error("demo id must use kebab-case letters, numbers, and hyphens");
  }
  return id;
}

export function assertNarrowDemoPath(path, workspaceRoot = DEMO_WORKSPACE_ROOT) {
  const target = resolve(path);
  const root = resolve(workspaceRoot);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || target === parse(target).root) {
    throw new Error(`unsafe demo-studio target: ${target}`);
  }
  return target;
}

async function writeAtomic(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, contents, { flag: "wx" });
  await rename(temporary, path);
}

export async function writeJsonAtomic(path, value) {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function createProjectWorkspace({
  id,
  sourcePath = null,
  csvPath = null,
  routeValue = null,
  directory = null,
  workspaceRoot = DEMO_WORKSPACE_ROOT,
  at,
} = {}) {
  validateDemoId(id);
  const root = resolve(workspaceRoot);
  const projectDirectory = directory ? resolve(directory) : join(root, id);
  assertNarrowDemoPath(projectDirectory, root);
  if (existsSync(projectDirectory)) throw new Error(`project already exists: ${projectDirectory}`);
  await mkdir(dirname(projectDirectory), { recursive: true });
  await mkdir(projectDirectory, { recursive: false });
  const project = createDemoProject({ id, sourcePath, csvPath, routeValue, at });
  await writeJsonAtomic(join(projectDirectory, "project.json"), project);
  await writeFile(join(projectDirectory, "history.jsonl"), "", { flag: "wx" });
  for (const child of ["artifacts", "attempts", "cache", "logs", "publish", "jobs", "revisions"]) {
    await mkdir(join(projectDirectory, child));
  }
  await writeJsonAtomic(join(projectDirectory, "revisions", "revision-000.json"), project);
  const launcherPath = join(projectDirectory, "studio");
  const cliUrl = pathToFileURL(join(DEMO_REPOSITORY_ROOT, "scripts", "demo-studio", "cli.mjs")).href;
  await writeFile(launcherPath, `#!/usr/bin/env node\nprocess.chdir(${JSON.stringify(DEMO_REPOSITORY_ROOT)});\nconst { runCli } = await import(${JSON.stringify(cliUrl)});\ntry {\n  const result = await runCli([...process.argv.slice(2), "--project", ${JSON.stringify(join(projectDirectory, "project.json"))}]);\n  if (result?.ok === false) process.exitCode = 2;\n} catch (error) {\n  console.error(\`RESULT   Command failed\\nWHY      \${error.message}\\nNEXT     ./studio help\`);\n  process.exitCode = 1;\n}\n`);
  await chmod(launcherPath, 0o755);
  return { directory: projectDirectory, path: join(projectDirectory, "project.json"), project };
}

export async function findProjectPath(start = process.cwd()) {
  let cursor = resolve(start);
  try {
    if ((await stat(cursor)).isFile()) return cursor;
  } catch {}
  while (true) {
    const candidate = join(cursor, "project.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error("no project.json found; pass --project or run from a demo project");
}

export async function readProject(projectOption) {
  const path = await findProjectPath(projectOption || process.cwd());
  const project = migrateDemoProject(JSON.parse(await readFile(path, "utf8")));
  const revisionDirectory = join(dirname(path), "revisions");
  await mkdir(revisionDirectory, { recursive: true });
  const currentSnapshot = join(revisionDirectory, `revision-${String(project.revision).padStart(3, "0")}.json`);
  if (!existsSync(currentSnapshot)) await writeJsonAtomic(currentSnapshot, project);
  const pendingPath = join(dirname(path), ".pending-history.json");
  if (existsSync(pendingPath)) {
    const pending = JSON.parse(await readFile(pendingPath, "utf8"));
    const historyPath = join(dirname(path), "history.jsonl");
    const history = await readFile(historyPath, "utf8").catch(() => "");
    const lines = history.split("\n").filter(Boolean);
    const validEvents = [];
    let damaged = false;
    for (const line of lines) {
      try { validEvents.push(JSON.parse(line)); } catch { damaged = true; }
    }
    if (pending.revision <= project.revision && !validEvents.some((event) => event.id === pending.id)) {
      validEvents.push(pending);
      if (damaged) await writeAtomic(historyPath, `${validEvents.map(JSON.stringify).join("\n")}\n`);
      else await appendFile(historyPath, `${JSON.stringify(pending)}\n`);
    }
    await unlink(pendingPath).catch(() => {});
  }
  return { path, directory: dirname(path), project };
}

export async function updateProject(projectPath, action) {
  const { project, directory } = await readProject(projectPath);
  const reduced = reduceDemoProject(project, action);
  if (!reduced.historyEvent) return { ...reduced, directory, path: resolve(projectPath) };
  const lockPath = join(directory, ".project.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("project is being changed by another studio process");
    throw error;
  }
  try {
    await mkdir(join(directory, "revisions"), { recursive: true });
    const previousSnapshot = join(directory, "revisions", `revision-${String(project.revision).padStart(3, "0")}.json`);
    if (!existsSync(previousSnapshot)) await writeJsonAtomic(previousSnapshot, project);
    await writeJsonAtomic(join(directory, ".pending-history.json"), reduced.historyEvent);
    await writeJsonAtomic(join(directory, "project.json"), reduced.project);
    await writeJsonAtomic(join(directory, "revisions", `revision-${String(reduced.project.revision).padStart(3, "0")}.json`), reduced.project);
    await appendFile(join(directory, "history.jsonl"), `${JSON.stringify(reduced.historyEvent)}\n`);
    await unlink(join(directory, ".pending-history.json"));
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
  return { ...reduced, directory, path: join(directory, "project.json") };
}

export async function listProjectRevisions(projectPath) {
  const { directory, project } = await readProject(projectPath);
  const revisions = [];
  for (let revision = 0; revision <= project.revision; revision += 1) {
    const path = join(directory, "revisions", `revision-${String(revision).padStart(3, "0")}.json`);
    if (!existsSync(path)) continue;
    const snapshot = migrateDemoProject(JSON.parse(await readFile(path, "utf8")));
    revisions.push({
      revision,
      at: snapshot.createdAt,
      accepted: snapshot.accepted,
      stages: snapshot.stages,
      sourceCount: snapshot.inputs.sources.length,
    });
  }
  const historyPath = join(directory, "history.jsonl");
  const historyText = await readFile(historyPath, "utf8").catch(() => "");
  const events = historyText.split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const byRevision = new Map(events.map((event) => [event.revision, event]));
  return revisions.map((revision) => ({ ...revision, event: byRevision.get(revision.revision) || null }));
}

export async function restoreProjectRevision(projectPath, targetRevision, { reason = null, actor = "operator" } = {}) {
  const loaded = await readProject(projectPath);
  const revision = Number(targetRevision);
  const snapshotPath = join(loaded.directory, "revisions", `revision-${String(revision).padStart(3, "0")}.json`);
  if (!existsSync(snapshotPath)) throw new Error(`revision ${revision} has no restorable snapshot`);
  const snapshot = migrateDemoProject(JSON.parse(await readFile(snapshotPath, "utf8")));
  return updateProject(loaded.path, {
    type: "restore-revision",
    targetRevision: revision,
    snapshot,
    reason: reason || `restored-revision-${revision}`,
    actor,
  });
}

export async function ensureContainedRealPath(projectDirectory, candidate) {
  const root = await realpath(projectDirectory);
  const target = await realpath(candidate);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("path escapes the demo project");
  return target;
}
