#!/usr/bin/env bash
#
# Build a Release archive of the iOS app and upload it to TestFlight.
#
# Chains the steps that were previously manual:
#   1. Bump the iOS build number in app.json (TestFlight requires a unique
#      build number per version; skip with --no-bump).
#   2. Rebuild the web app + sync it and offline assets into the native shell.
#   3. Regenerate the native ios/ project (`expo prebuild`), which is
#      gitignored and gets wiped/regenerated every release.
#   4. Ensure a Distribution certificate + App Store provisioning profile
#      exist (via fastlane), installing them if missing.
#   5. fastlane archive  -> builds & signs CycleWays.ipa
#   6. fastlane beta     -> uploads the ipa to TestFlight
#
# Credentials are read from the out-of-repo file
# ~/.appstoreconnect/cycleways-asc.env (see apps/mobile/fastlane/Fastfile).
#
# Usage:
#   scripts/release-testflight.sh              # full release
#   scripts/release-testflight.sh --no-bump     # keep current buildNumber
#   scripts/release-testflight.sh --skip-build  # skip web build/prebuild,
#                                                # reuse the existing ios/ dir
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ASC_ENV="$HOME/.appstoreconnect/cycleways-asc.env"
APP_JSON="$MOBILE_DIR/app.json"

BUMP=1
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --no-bump) BUMP=0 ;;
    --skip-build) SKIP_BUILD=1 ;;
    *) echo "ERROR: unknown option '$arg'"; exit 1 ;;
  esac
done

# --- preconditions -----------------------------------------------------------
command -v fastlane >/dev/null 2>&1 || { echo "ERROR: fastlane not found (brew install fastlane)."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "ERROR: node not found."; exit 1; }
[ -f "$ASC_ENV" ] || { echo "ERROR: missing credentials file $ASC_ENV"; exit 1; }

# --- 1. bump the iOS build number --------------------------------------------
if [ "$BUMP" -eq 1 ]; then
  echo "==> Bumping iOS build number in app.json..."
  NEW_BUILD="$(node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const json = JSON.parse(fs.readFileSync(path, "utf8"));
    const current = parseInt(json.expo.ios.buildNumber, 10) || 0;
    const next = current + 1;
    json.expo.ios.buildNumber = String(next);
    fs.writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
    process.stdout.write(String(next));
  ' "$APP_JSON")"
  echo "    buildNumber -> $NEW_BUILD (uncommitted change in app.json — commit it once the upload succeeds)"
else
  echo "==> Skipping build-number bump (--no-bump)."
fi

# --- 2 & 3. web bundle + offline assets + native project ---------------------
if [ "$SKIP_BUILD" -eq 1 ]; then
  echo "==> Skipping web build / prebuild (--skip-build); reusing existing ios/ dir."
  [ -d "$MOBILE_DIR/ios" ] || { echo "ERROR: no ios/ dir and --skip-build was given."; exit 1; }
else
  echo "==> Building web app + syncing into the native shell..."
  ( cd "$MOBILE_DIR" && node scripts/sync-web-bundle.mjs && node scripts/sync-offline-assets.mjs )

  echo "==> Regenerating the native iOS project (expo prebuild)..."
  ( cd "$MOBILE_DIR" && npx expo prebuild -p ios --clean )
fi

# --- 4. ensure Distribution cert + App Store profile exist -------------------
if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Distribution"; then
  echo "==> No valid 'Apple Distribution' certificate found; creating one via fastlane."
  echo "    macOS needs your Mac LOGIN password once so the new signing key is usable by"
  echo "    codesign without an interactive popup. It is read silently, not stored or logged."
  printf "    Mac login password: "
  read -rs KEYCHAIN_PASSWORD; echo
  ( cd "$MOBILE_DIR" && KEYCHAIN_PASSWORD="$KEYCHAIN_PASSWORD" fastlane release_cert )
  unset KEYCHAIN_PASSWORD
fi

echo "==> Ensuring App Store provisioning profile is installed..."
( cd "$MOBILE_DIR" && fastlane release_profile )

# --- 5. archive ---------------------------------------------------------------
echo "==> Archiving Release build (fastlane archive)..."
( cd "$MOBILE_DIR" && fastlane archive )

# --- 6. upload to TestFlight ---------------------------------------------------
echo "==> Uploading to TestFlight (fastlane beta)..."
( cd "$MOBILE_DIR" && fastlane beta )

echo
echo "Done. Build uploaded to TestFlight."
if [ "$BUMP" -eq 1 ]; then
  echo "Remember to commit the buildNumber bump in app.json."
fi
