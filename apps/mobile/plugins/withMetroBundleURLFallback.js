const { withAppDelegate } = require("@expo/config-plugins");

const BUNDLE_ROOT_DECLARATION =
  '  private let metroBundleRoot = ".expo/.virtual-metro-entry"\n\n';

const ORIGINAL_DEBUG_BUNDLE_URL =
  '    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")';

const PATCHED_DEBUG_BUNDLE_URL = `    let provider = RCTBundleURLProvider.sharedSettings()
    if let url = provider.jsBundleURL(forBundleRoot: metroBundleRoot) {
      return url
    }
    return RCTBundleURLProvider.jsBundleURL(
      forBundleRoot: metroBundleRoot,
      packagerHost: bundledMetroHost() ?? "localhost",
      enableDev: true,
      enableMinification: false,
      inlineSourceMap: false)`;

const BUNDLED_HOST_HELPER = `

  private func bundledMetroHost() -> String? {
    guard
      let path = Bundle.main.path(forResource: "ip", ofType: "txt"),
      let rawHost = try? String(contentsOfFile: path, encoding: .utf8)
    else {
      return nil
    }
    let host = rawHost.trimmingCharacters(in: .whitespacesAndNewlines)
    return host.isEmpty ? nil : host
  }`;

function patchSwiftAppDelegate(contents) {
  if (!contents.includes("class ReactNativeDelegate: ExpoReactNativeFactoryDelegate")) {
    return contents;
  }

  let next = contents;
  if (!next.includes("private let metroBundleRoot")) {
    next = next.replace(
      "class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {\n",
      `class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {\n${BUNDLE_ROOT_DECLARATION}`,
    );
  }

  if (next.includes(ORIGINAL_DEBUG_BUNDLE_URL)) {
    next = next.replace(ORIGINAL_DEBUG_BUNDLE_URL, PATCHED_DEBUG_BUNDLE_URL);
  }

  if (!next.includes("private func bundledMetroHost()")) {
    next = next.replace(/\n}\s*$/, `${BUNDLED_HOST_HELPER}\n}\n`);
  }

  return next;
}

function withMetroBundleURLFallback(config) {
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== "swift") {
      throw new Error(
        "withMetroBundleURLFallback only supports Swift AppDelegate files.",
      );
    }
    config.modResults.contents = patchSwiftAppDelegate(
      config.modResults.contents,
    );
    return config;
  });
}

module.exports = withMetroBundleURLFallback;
