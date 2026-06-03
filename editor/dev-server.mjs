#!/usr/bin/env node
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..");
const serverPath = resolve(__dirname, "server.mjs");
const serverRestartEnabled = process.env.EDITOR_SERVER_RESTART === "1";

let child = null;
let restartTimer = null;
let restarting = false;
let shuttingDown = false;
let watcher = null;

function startServer() {
  child = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (restarting || shuttingDown) return;
    console.error(`[dev] editor server exited (${signal || code})`);
    process.exit(typeof code === "number" ? code : 1);
  });
}

function restartServer(reason) {
  if (shuttingDown) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    console.log(`[dev] restarting editor server after ${reason}`);
    const previous = child;
    restarting = true;

    const startNext = () => {
      restarting = false;
      startServer();
    };

    if (!previous || previous.exitCode !== null) {
      startNext();
      return;
    }

    let exited = false;
    const killTimer = setTimeout(() => {
      if (!exited) previous.kill("SIGKILL");
    }, 2000);
    killTimer.unref?.();

    previous.once("exit", () => {
      exited = true;
      clearTimeout(killTimer);
      startNext();
    });
    previous.kill("SIGTERM");
  }, 150);
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  watcher?.close();
  if (!child || child.exitCode !== null) {
    process.exit(0);
  }
  const killTimer = setTimeout(() => {
    child?.kill("SIGKILL");
    process.exit(1);
  }, 2000);
  killTimer.unref?.();
  child.once("exit", () => {
    clearTimeout(killTimer);
    process.exit(0);
  });
  child.kill(signal);
}

if (serverRestartEnabled) {
  watcher = watch(serverPath, { persistent: true }, (eventType) => {
    restartServer(`server.mjs ${eventType}`);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

if (serverRestartEnabled) {
  console.log("[dev] watching editor/server.mjs for automatic restarts");
} else {
  console.log("[dev] automatic editor server restarts disabled");
}
startServer();
