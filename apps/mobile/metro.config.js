// Monorepo-aware Metro config: lets the Expo app resolve and watch the
// workspace package @cycleways/core (symlinked at the repo-root node_modules),
// and enables package "exports" resolution so its subpath exports
// ("@cycleways/core/utils/...", "@cycleways/core/route-manager.js") work.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
const nativePlatformModules = new Set([
  "analytics",
  "assets",
  "download",
  "location",
  "storage",
]);
const devHarnessModules = new Set([
  "@cycleways/core/navigation/scenarios/index.js",
  "@cycleways/core/navigation/scenarios/resolve.js",
  "@cycleways/core/navigation/scenarios/journeySchema.js",
  "@cycleways/core/navigation/scenarioConnector.js",
  "../navigation/journeyPlaybackSource.js",
  "../planner/DevScenarioPicker.jsx",
  "../planner/DevCameraOverlay.jsx",
  "../planner/DevJourneyControls.jsx",
]);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.unstable_enablePackageExports = true;
config.resolver.assetExts = [...config.resolver.assetExts, "cwb"];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (context.dev === false && devHarnessModules.has(moduleName)) {
    return context.resolveRequest(
      context,
      path.resolve(projectRoot, "src/dev/emptyDevHarness.js"),
      platform,
    );
  }
  if (platform === "ios" || platform === "android") {
    const nativeModuleName = nativePlatformModuleName(moduleName);
    if (
      nativeModuleName &&
      isCoreSourceModule(context.originModulePath)
    ) {
      return context.resolveRequest(context, nativeModuleName, platform);
    }
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

function nativePlatformModuleName(moduleName) {
  const relativeMatch = moduleName.match(
    /^(.*\/platform\/)([^/]+)\.js$/,
  );
  if (relativeMatch && nativePlatformModules.has(relativeMatch[2])) {
    return `${relativeMatch[1]}${relativeMatch[2]}.native.js`;
  }

  const packageMatch = moduleName.match(
    /^@cycleways\/core\/platform\/([^/]+)\.js$/,
  );
  if (packageMatch && nativePlatformModules.has(packageMatch[1])) {
    return `@cycleways/core/platform/${packageMatch[1]}.native.js`;
  }

  return null;
}

function isCoreSourceModule(modulePath) {
  return modulePath.includes(
    `${path.sep}packages${path.sep}core${path.sep}src${path.sep}`,
  );
}
