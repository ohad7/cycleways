import { spawn } from "node:child_process";

export function spawnChecked(executable, args = [], options = {}) {
  if (typeof executable !== "string" || executable.length === 0) throw new Error("executable is required");
  if (!Array.isArray(args)) throw new Error("process arguments must be an array");
  const limit = Math.max(1024, Number(options.maxOutputBytes) || 1024 * 1024);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args.map(String), {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const add = (current, chunk) => `${current}${chunk}`.slice(-limit);
    child.stdout.on("data", (chunk) => {
      stdout = add(stdout, chunk);
      options.onStdout?.(String(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderr = add(stderr, chunk);
      options.onStderr?.(String(chunk));
    });
    child.once("error", (error) => {
      if (error.code === "ENOENT") reject(new Error(`${executable} is not installed or not on PATH`));
      else reject(error);
    });
    child.once("close", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr, code, signal, child });
      else {
        const detail = stderr.trim() || stdout.trim() || `exit ${code}${signal ? ` (${signal})` : ""}`;
        const error = new Error(`${executable} failed: ${detail}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
    options.onChild?.(child);
  });
}

export async function toolVersion(executable, args = ["-version"]) {
  try {
    const result = await spawnChecked(executable, args, { maxOutputBytes: 8192 });
    return { available: true, version: (result.stdout || result.stderr).split("\n")[0].trim() };
  } catch (error) {
    return { available: false, error: error.message };
  }
}
