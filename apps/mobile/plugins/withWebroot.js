const { withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Bundles the built web app (apps/mobile/webroot, produced by `npm run
// bundle:web`) into the iOS app as a folder-reference resource, so the local
// static server serves it from MainBundlePath/webroot
// (resolveAssetsPath("webroot")). Run `npm run bundle:web` before prebuild/build.
//
// NOTE: first-pass native config — verify on device. If the folder doesn't end
// up in the built app bundle, the likely culprit is the folder-reference add
// below (Xcode blue-folder vs group); iterate from the real build output.
const WEBROOT = "webroot";

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

    // Copy the bundle into the iOS project (git-ignored) so it's an in-project
    // resource with a stable relative path.
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });

    // Add as a folder reference (the whole tree ships as MainBundlePath/webroot).
    if (!project.hasFile(WEBROOT)) {
      const target = project.getFirstTarget().uuid;
      const mainGroup = project.getFirstProject().firstProject.mainGroup;
      project.addResourceFile(
        WEBROOT,
        { target, lastKnownFileType: "folder" },
        mainGroup,
      );
    }
    return config;
  });
}

module.exports = withWebroot;
