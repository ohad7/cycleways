#!/usr/bin/env bash
#
# Detect a connected physical iPhone, register it + create a Development
# provisioning profile via fastlane, patch the project for manual signing,
# and (optionally) build & install onto the device.
#
# Usage:
#   scripts/run-on-device.sh            # detect + profile + patch signing
#   scripts/run-on-device.sh --build    # also run `expo run:ios --device`
#
# No personal data is hardcoded here: the UDID, device name, Team ID and
# profile are all derived at runtime. Credentials are read from the
# out-of-repo file ~/.appstoreconnect/cycleways-asc.env.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IOS_DIR="$MOBILE_DIR/ios"
ASC_ENV="$HOME/.appstoreconnect/cycleways-asc.env"

BUILD=0
[ "${1:-}" = "--build" ] && BUILD=1

# --- preconditions -----------------------------------------------------------
command -v fastlane >/dev/null 2>&1 || { echo "ERROR: fastlane not found (brew install fastlane)."; exit 1; }
command -v python3  >/dev/null 2>&1 || { echo "ERROR: python3 not found."; exit 1; }
[ -f "$ASC_ENV" ] || { echo "ERROR: missing credentials file $ASC_ENV"; exit 1; }
[ -d "$IOS_DIR" ] || { echo "ERROR: no ios/ dir at $IOS_DIR (run a prebuild first)."; exit 1; }

# --- ensure a usable signing certificate exists ------------------------------
# The cert is only missing on first setup, a new Mac, or after it expires (~1yr).
# When we have to create one, pass the login-keychain password to fastlane so it
# sets the keychain ACL ("partition list") at import time -- otherwise codesign
# silently blocks mid-build on a GUI popup. The password is read without echo and
# never stored or logged.
if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Development"; then
  echo "==> No valid 'Apple Development' certificate found; creating one via fastlane."
  echo "    macOS needs your Mac LOGIN password once so the new signing key is usable by"
  echo "    codesign without an interactive popup. It is read silently, not stored or logged."
  printf "    Mac login password: "
  read -rs KEYCHAIN_PASSWORD; echo
  ( cd "$MOBILE_DIR" && KEYCHAIN_PASSWORD="$KEYCHAIN_PASSWORD" fastlane dev_cert )
  unset KEYCHAIN_PASSWORD
fi

# --- detect a connected physical iOS device ----------------------------------
echo "==> Detecting a connected iPhone..."
TMP_JSON="$(mktemp)"
trap 'rm -f "$TMP_JSON"' EXIT
xcrun devicectl list devices --json-output "$TMP_JSON" >/dev/null 2>&1 || true

# Emit: "<udid>\t<device name>" for the first connected iOS device, else nothing.
DEVICE_LINE="$(python3 - "$TMP_JSON" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
for dev in data.get("result", {}).get("devices", []):
    hw = dev.get("hardwareProperties", {})
    if hw.get("platform") != "iOS":
        continue
    udid = hw.get("udid", "")
    name = dev.get("deviceProperties", {}).get("name", "iPhone")
    if udid:
        print(f"{udid}\t{name}")
        break
PY
)"

if [ -z "$DEVICE_LINE" ]; then
  cat <<'MSG'
ERROR: No physical iOS device detected.
  1. Plug the iPhone in with a cable.
  2. Unlock it and tap "Trust This Computer" (enter passcode).
  3. Enable Settings > Privacy & Security > Developer Mode, then restart.
Then re-run this script.
MSG
  exit 1
fi

UDID="${DEVICE_LINE%%$'\t'*}"
DEVICE_NAME="${DEVICE_LINE#*$'\t'}"
# fastlane wants a single token for the device label; keep it simple/safe.
PROFILE_DEVICE_NAME="$(printf '%s' "$DEVICE_NAME" | tr -c 'A-Za-z0-9._-' '_')"
echo "==> Found device: $DEVICE_NAME (UDID ****${UDID: -6})"

# --- register device + profile + patch signing (all via fastlane) ------------
echo "==> Registering device, ensuring App ID + profile, patching signing..."
( cd "$MOBILE_DIR" && fastlane dev_profile udid:"$UDID" name:"$PROFILE_DEVICE_NAME" )

echo "==> Signing configured (manual, fastlane-managed profile)."

# --- optional build + install ------------------------------------------------
if [ "$BUILD" -eq 1 ]; then
  echo "==> Building web bundle + syncing offline assets (expo run:ios bypasses npm pre-hooks)..."
  ( cd "$MOBILE_DIR" && node scripts/sync-web-bundle.mjs && node scripts/sync-offline-assets.mjs )

  echo "==> Building & installing onto the device (expo run:ios --device)..."
  if ! ( cd "$MOBILE_DIR" && npx expo run:ios --device "$UDID" ); then
    cat <<'MSG'

Build failed. If the error mentions code signing, "errSecInternalComponent",
"User interaction is not allowed", or a codesign keychain prompt, your login
keychain ACL needs a refresh. Run these (enter your Mac login password when asked):

    security unlock-keychain ~/Library/Keychains/login.keychain-db
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s ~/Library/Keychains/login.keychain-db

then re-run this script.
MSG
    exit 1
  fi
else
  echo
  echo "Done. To build & install now, run:"
  echo "    scripts/run-on-device.sh --build"
  echo "or:"
  echo "    (cd \"$MOBILE_DIR\" && npx expo run:ios --device)"
fi
