const { withXcodeProject, IOSConfig } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Bundles the built web app (apps/mobile/webroot, produced by `npm run
// bundle:web`) into the iOS app as a FOLDER REFERENCE, so the local static
// server serves it from MainBundlePath/webroot (resolveAssetsPath("webroot")).
// Run `npm run bundle:web` before prebuild/build.
const WEBROOT = "webroot";

function alreadyReferenced(project) {
  const section = project.pbxFileReferenceSection();
  return Object.keys(section).some((key) => {
    const ref = section[key];
    const p = ref && typeof ref === "object" ? String(ref.path || "") : "";
    return p === WEBROOT || p === `"${WEBROOT}"`;
  });
}

// Force the webroot file reference to a folder reference (blue folder) so Xcode
// copies the whole tree into the bundle preserving its structure.
function forceFolderReference(project) {
  const section = project.pbxFileReferenceSection();
  for (const key of Object.keys(section)) {
    const ref = section[key];
    if (!ref || typeof ref !== "object") continue;
    const p = String(ref.path || "");
    if (p === WEBROOT || p === `"${WEBROOT}"`) {
      ref.lastKnownFileType = '"folder"';
      delete ref.explicitFileType;
      ref.sourceTree = '"<group>"';
    }
  }
}

function withWebroot(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const appRoot = config.modRequest.projectRoot; // apps/mobile
    const iosRoot = config.modRequest.platformProjectRoot; // apps/mobile/ios
    const src = path.join(appRoot, WEBROOT);
    const dest = path.join(iosRoot, WEBROOT);

    if (!fs.existsSync(path.join(src, "index.html"))) {
      console.warn(
        `[withWebroot] ${src} is missing/incomplete — run \`npm run bundle:web\` before building. Skipping.`,
      );
      return config;
    }

    // Copy the bundle into the iOS project (git-ignored) as an in-project
    // resource with a stable relative path.
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });

    if (!alreadyReferenced(project)) {
      IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: WEBROOT, // relative to the iOS project (ios/webroot)
        groupName: WEBROOT,
        isBuildFile: true,
        project,
        verbose: true,
      });
    }
    // Whether just added or pre-existing, make sure it's a folder reference.
    forceFolderReference(project);
    console.log("[withWebroot] bundled webroot as a folder reference.");
    return config;
  });
}

module.exports = withWebroot;
