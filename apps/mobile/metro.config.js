// Monorepo-aware Metro config: lets the Expo app resolve and watch the
// workspace package @cycleways/core (symlinked at the repo-root node_modules),
// and enables package "exports" resolution so its subpath exports
// ("@cycleways/core/utils/...", "@cycleways/core/route-manager.js") work.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
