import {
  sanitizeDemoBundleForApp,
  stableDemoBundleDigest,
  validateDemoBundle,
} from "../../packages/core/src/navigation/demoBundle.js";

export function compileDemoBundle({ project, routeState, fixes, cleanup, toolVersions = {}, gitCommit = "unknown", compiledAt } = {}) {
  const proof = project.inputs.story.proof;
  const bundle = validateDemoBundle({
    schemaVersion: 1,
    id: project.id,
    routeState,
    fixes,
    capture: {
      ...project.inputs.captureProfile,
      proof: {
        inMs: Number(proof.inMs),
        outMs: Number(proof.outMs),
        preRollMs: Number(proof.preRollMs) || 0,
      },
    },
    expectations: {
      forbiddenStatuses: ["error"],
      allowOffRoute: false,
      requireVoice: true,
    },
    provenance: {
      sourceSha256: project.inputs.source.sha256,
      telemetrySha256: project.inputs.source.csvSha256 || project.inputs.source.sha256,
      routeDigest: project.inputs.route.snapshotDigest,
      compiledAt: compiledAt || new Date().toISOString(),
      gitCommit,
      toolVersions,
      cleanup,
      sourcePath: project.inputs.source.path,
    },
  });
  const appBundle = sanitizeDemoBundleForApp(bundle);
  return { privateBundle: bundle, appBundle, digest: stableDemoBundleDigest(appBundle) };
}
