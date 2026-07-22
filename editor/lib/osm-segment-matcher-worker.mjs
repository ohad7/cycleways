import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

function matcherError(message, { code = "MATCHER_WORKER_ERROR", status = 500 } = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function abortedError() {
  return matcherError("Obsolete authoring request cancelled", {
    code: "AUTHORING_REQUEST_ABORTED",
    status: 499,
  });
}

function statSignature(value) {
  return [value.dev, value.ino, value.size, value.mtimeMs].join(":");
}

export class OsmSegmentMatcherWorker {
  constructor({
    cwd,
    graphPath,
    workerScript,
    python = "python3",
    requestTimeoutMs = 30_000,
    log = () => {},
  }) {
    this.cwd = cwd;
    this.graphPath = graphPath;
    this.workerScript = workerScript;
    this.python = python;
    this.requestTimeoutMs = requestTimeoutMs;
    this.log = log;
    this.runtime = null;
    this.starting = null;
    this.graphIdentityCache = null;
    this.requestCounter = 0;
  }

  async graphIdentity() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = await stat(this.graphPath);
      const signature = statSignature(before);
      if (this.graphIdentityCache?.signature === signature) {
        return this.graphIdentityCache;
      }
      const contents = await readFile(this.graphPath);
      const after = await stat(this.graphPath);
      if (statSignature(after) !== signature) continue;
      this.graphIdentityCache = {
        signature,
        bytes: contents.length,
        digest: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
      };
      return this.graphIdentityCache;
    }
    throw matcherError("Base graph changed while preparing the matcher worker", {
      code: "BASE_EVIDENCE_SUPERSEDED",
      status: 409,
    });
  }

  async match(feature, { signal } = {}) {
    if (signal?.aborted) throw abortedError();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const identity = await this.graphIdentity();
      try {
        const runtime = await this.ensureRuntime(identity);
        return await this.request(runtime, feature, { signal });
      } catch (error) {
        if (error?.code === "AUTHORING_REQUEST_ABORTED") throw error;
        if (attempt === 0 && error?.code === "MATCHER_GRAPH_CHANGED") {
          this.graphIdentityCache = null;
          continue;
        }
        throw error;
      }
    }
    throw matcherError("Could not prepare a current matcher worker");
  }

  async warm() {
    const identity = await this.graphIdentity();
    return this.ensureRuntime(identity);
  }

  async ensureRuntime(identity) {
    if (
      this.runtime &&
      !this.runtime.closed &&
      this.runtime.graphDigest === identity.digest &&
      this.runtime.ready
    ) {
      return this.runtime;
    }
    if (this.starting?.graphDigest === identity.digest) {
      return this.starting.promise;
    }

    const promise = this.startRuntime(identity);
    this.starting = { graphDigest: identity.digest, promise };
    try {
      return await promise;
    } finally {
      if (this.starting?.promise === promise) this.starting = null;
    }
  }

  async startRuntime(identity) {
    this.stop();
    const child = spawn(
      this.python,
      [this.workerScript, "--graph-edges", this.graphPath],
      {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const runtime = {
      child,
      graphDigest: identity.digest,
      graphBytes: identity.bytes,
      ready: false,
      closed: false,
      stdoutBuffer: "",
      stderrBuffer: "",
      pending: new Map(),
      readyResolve: null,
      readyReject: null,
    };
    const readyPromise = new Promise((resolve, reject) => {
      runtime.readyResolve = resolve;
      runtime.readyReject = reject;
    });
    this.runtime = runtime;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.consumeStdout(runtime, chunk));
    child.stderr.on("data", (chunk) => {
      runtime.stderrBuffer = `${runtime.stderrBuffer}${chunk}`.slice(-16_000);
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        this.log("info", "matcher worker stderr", line);
      }
    });
    child.on("error", (error) => {
      this.closeRuntime(runtime, matcherError(`Matcher worker failed to start: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      const detail = runtime.stderrBuffer.trim();
      this.closeRuntime(
        runtime,
        matcherError(
          `Matcher worker exited${code === null ? "" : ` with code ${code}`}${
            signal ? ` (${signal})` : ""
          }${detail ? `: ${detail}` : ""}`,
        ),
      );
    });

    const ready = await readyPromise;
    if (ready.graphDigest !== identity.digest) {
      this.stop(runtime);
      throw matcherError("Base graph changed while matcher worker was starting", {
        code: "MATCHER_GRAPH_CHANGED",
        status: 409,
      });
    }
    runtime.ready = true;
    runtime.setupPerformance = ready.performance || null;
    this.log("info", "matcher worker ready", {
      graphDigest: ready.graphDigest,
      graphBytes: identity.bytes,
      setupPerformance: ready.performance,
    });
    return runtime;
  }

  consumeStdout(runtime, chunk) {
    if (runtime.closed) return;
    runtime.stdoutBuffer += chunk;
    while (true) {
      const newline = runtime.stdoutBuffer.indexOf("\n");
      if (newline < 0) return;
      const line = runtime.stdoutBuffer.slice(0, newline).trim();
      runtime.stdoutBuffer = runtime.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        this.closeRuntime(
          runtime,
          matcherError(`Matcher worker emitted invalid JSON: ${error.message}`),
        );
        this.stop(runtime);
        return;
      }
      this.handleMessage(runtime, message);
    }
  }

  handleMessage(runtime, message) {
    if (message?.type === "ready") {
      runtime.readyResolve?.(message);
      runtime.readyResolve = null;
      runtime.readyReject = null;
      return;
    }
    const key = String(message?.id ?? "");
    const pending = runtime.pending.get(key);
    if (!pending) return;
    runtime.pending.delete(key);
    pending.cleanup();
    if (message.type === "result") {
      pending.resolve(message.result);
      return;
    }
    pending.reject(
      matcherError(message?.error || "Matcher worker request failed", {
        code: "MATCHER_REQUEST_ERROR",
        status: 400,
      }),
    );
  }

  request(runtime, feature, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(abortedError());
    if (runtime.closed || !runtime.ready) {
      return Promise.reject(matcherError("Matcher worker is not ready"));
    }
    const id = String(++this.requestCounter);
    return new Promise((resolve, reject) => {
      let timeout = null;
      const abort = () => {
        const pending = runtime.pending.get(id);
        if (!pending) return;
        runtime.pending.delete(id);
        pending.cleanup();
        reject(abortedError());
      };
      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      };
      timeout = setTimeout(() => {
        if (!runtime.pending.delete(id)) return;
        cleanup();
        reject(
          matcherError(`Matcher worker request timed out after ${this.requestTimeoutMs} ms`, {
            code: "MATCHER_REQUEST_TIMEOUT",
            status: 504,
          }),
        );
      }, this.requestTimeoutMs);
      timeout.unref?.();
      runtime.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", abort, { once: true });
      runtime.child.stdin.write(
        `${JSON.stringify({ id, action: "match", feature })}\n`,
        (error) => {
          if (!error) return;
          const pending = runtime.pending.get(id);
          if (!pending) return;
          runtime.pending.delete(id);
          pending.cleanup();
          reject(matcherError(`Could not write to matcher worker: ${error.message}`));
        },
      );
    });
  }

  closeRuntime(runtime, error) {
    if (runtime.closed) return;
    runtime.closed = true;
    runtime.readyReject?.(error);
    runtime.readyResolve = null;
    runtime.readyReject = null;
    for (const pending of runtime.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    runtime.pending.clear();
    if (this.runtime === runtime) this.runtime = null;
  }

  stop(runtime = this.runtime) {
    if (!runtime || runtime.closed) return;
    this.closeRuntime(runtime, matcherError("Matcher worker stopped"));
    runtime.child.kill("SIGTERM");
  }
}
