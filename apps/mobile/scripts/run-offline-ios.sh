#!/usr/bin/env bash
#
# Build/install an iOS app that embeds the JavaScript bundle and bundled
# CycleWays data, so it can launch without a Metro/Expo dev server.
#
# Usage:
#   npm run ios:offline
#   npm run ios:offline -- --device
#   npm run ios:offline -- --device <UDID-or-device-name>
#   npm run ios:offline -- --device generic --output ./build
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$MOBILE_DIR"

npm run assets:sync

# Release builds hit AppDelegate.swift's bundled main.jsbundle path. The
# --no-bundler flag makes the no-Metro contract explicit even if Expo's defaults
# change later.
npx --no-install expo run:ios --configuration Release --no-bundler "$@"
