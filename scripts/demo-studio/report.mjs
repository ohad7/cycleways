import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "./workspace.mjs";

async function jsonOrNull(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "string" && (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value))) return "[redacted local path]";
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (/path|rows|fixes|samples|latitude|longitude|\blat\b|\blng\b|artifact|filename|workspace|directory|output|raw|token/i.test(key)) continue;
    result[key] = redact(child);
  }
  return result;
}

export function redactShareableReport(value) {
  return redact(value);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function reportHtml(report) {
  const sections = Object.entries(report.sections || {}).map(([name, value]) => `<section><h2>${escapeHtml(name)}</h2><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>CycleWays demo validation</title><style>body{font:15px system-ui;margin:32px auto;max-width:960px;color:#173025}h1{margin-bottom:4px}.pass{color:#287d35}.fail{color:#b43b2f}section{border-top:1px solid #dce6df;padding:16px 0}pre{white-space:pre-wrap;background:#f4f7f5;padding:14px;border-radius:8px}</style></head><body><h1>CycleWays navigation demo validation</h1><p class="${report.publishable ? "pass" : "fail"}">${report.publishable ? "Publishable" : "Not publishable"}</p>${sections}</body></html>`;
}

export async function generateValidationReport({ project, directory, shareable = false } = {}) {
  const artifacts = {};
  for (const [name, file] of Object.entries({
    media: "media-probe.json",
    track: "normalized-track.json",
    routeFit: "ride-validation.json",
    navigation: "navigation-validation.json",
  })) artifacts[name] = await jsonOrNull(join(directory, "artifacts", file));
  const acceptedCapture = project.attempts.capture.find((attempt) => attempt.id === project.accepted.capture) || null;
  const acceptedRender = project.attempts.render.find((attempt) => attempt.id === project.accepted.render) || null;
  const metadataAudit = acceptedRender ? await jsonOrNull(join(directory, "attempts", acceptedRender.id, "privacy-metadata.json")) : null;
  const gates = {
    sourceReady: project.stages.source.state === "ready",
    navigationReady: project.stages.navigation.state === "ready",
    inputsAccepted: project.stages.inputs.state === "accepted",
    captureAccepted: project.stages.capture.state === "accepted",
    renderAccepted: project.stages.render.state === "accepted",
    sensitiveMetadataRemoved: metadataAudit?.pass === true,
    routeFitPassed: artifacts.routeFit?.pass === true,
    navigationPassed: artifacts.navigation?.pass === true,
  };
  const report = {
    schemaVersion: 1,
    projectId: project.id,
    revision: project.revision,
    publishable: Object.values(gates).every(Boolean),
    gates,
    sections: {
      provenance: { sourceSha256: project.inputs.source.sha256, routeDigest: project.inputs.route.snapshotDigest, capture: acceptedCapture?.id || null, render: acceptedRender?.id || null },
      media: artifacts.media,
      cleanup: artifacts.track?.cleanup || null,
      gaps: artifacts.track?.warnings || [],
      routeFit: artifacts.routeFit ? { pass: artifacts.routeFit.pass, metrics: artifacts.routeFit.metrics, gates: artifacts.routeFit.gates } : null,
      navigation: artifacts.navigation ? { pass: artifacts.navigation.pass, error: artifacts.navigation.error || null, voiceEventCount: artifacts.navigation.voiceEvents?.length || 0 } : null,
      privacyMetadata: metadataAudit,
      attempts: { capture: project.attempts.capture, render: project.attempts.render },
      attestations: project.attestations,
    },
  };
  return shareable ? redactShareableReport(report) : report;
}

export async function writeValidationReport({ project, directory, shareable = false, basename = "validation-report" } = {}) {
  const report = await generateValidationReport({ project, directory, shareable });
  const jsonPath = join(directory, "artifacts", `${basename}.json`);
  const htmlPath = join(directory, "artifacts", `${basename}.html`);
  await writeJsonAtomic(jsonPath, report);
  await (await import("node:fs/promises")).writeFile(htmlPath, reportHtml(report));
  return { report, jsonPath, htmlPath };
}
