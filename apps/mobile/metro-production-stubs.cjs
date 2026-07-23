const demoCaptureModules = new Set([
  "../dev/demoCaptureClient.js",
  "../dev/demoCaptureLaunch.js",
  "./src/dev/demoCaptureLaunch.js",
  "../navigation/mediaClockPlaybackSource.js",
  "../navigation/demoCaptureEvents.js",
  "../navigation/useDemoCaptureSession.js",
  "../planner/DevDemoCaptureSlate.jsx",
]);

const devHarnessModules = new Set([
  "@cycleways/core/navigation/scenarios/index.js",
  "@cycleways/core/navigation/scenarios/resolve.js",
  "@cycleways/core/navigation/scenarios/journeySchema.js",
  "@cycleways/core/navigation/scenarioConnector.js",
  "../navigation/journeyPlaybackSource.js",
  "../navigation/journeyHarnessState.js",
  "../planner/DevScenarioPicker.jsx",
  "../planner/DevCameraOverlay.jsx",
  "../planner/DevJourneyControls.jsx",
  ...demoCaptureModules,
]);

function productionDevStubFor(moduleName) {
  if (!devHarnessModules.has(moduleName)) {
    return null;
  }

  return demoCaptureModules.has(moduleName)
    ? "emptyDemoCapture.js"
    : "emptyDevHarness.js";
}

module.exports = {
  demoCaptureModules,
  devHarnessModules,
  productionDevStubFor,
};
