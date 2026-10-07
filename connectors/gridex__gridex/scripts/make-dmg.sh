#!/bin/bash
# make-dmg.sh — Package a signed .app into a DMG, then sign + notarize the DMG.
#
# Usage:
#   ./scripts/make-dmg.sh [path-to-app]
#   (defaults to dist/Gridex.app)
#
# Env:
#   VERSION         Override version (default: read from Info.plist)
#   ARCH            arm64 | x86_64 (default: host uname -m)
#   NOTARIZE=0      Skip notarization (for local testing)
#   SIGN_IDENTITY   Passed through to sign-notarize.sh
#   NOTARY_PROFILE  Passed through to sign-notarize.sh

set -euo pipefail

APP_PATH="${1:-dist/Gridex.app}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -d "$APP_PATH" ]; then
    echo "✗ .app not found: $APP_PATH"
    echo "  Run ./scripts/build-app.sh release first."
    exit 1
fi

APP_NAME="$(basename "$APP_PATH" .app)"
VERSION="${VERSION:-$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP_PATH/Contents/Info.plist")}"
ARCH="${ARCH:-$(uname -m)}"
NOTARIZE="${NOTARIZE:-1}"

OUTPUT_DIR="$PROJECT_DIR/dist"
DMG_PATH="$OUTPUT_DIR/${APP_NAME}-${VERSION}-${ARCH}.dmg"

echo "═══════════════════════════════════════════"
echo "  Packaging DMG"
echo "  App:     $APP_PATH"
echo "  Version: $VERSION"
echo "  Arch:    $ARCH"
echo "  Output:  $DMG_PATH"
echo "═══════════════════════════════════════════"

# Stage: .app + /Applications symlink for drag-to-install UX
STAGING="/tmp/gridex-dmg-staging"
rm -rf "$STAGING"
mkdir -p "$STAGING"
cp -R "$APP_PATH" "$STAGING/"
ln -s /Applications "$STAGING/Applications"

rm -f "$DMG_PATH"
hdiutil create \
    -volname "${APP_NAME} ${VERSION}" \
    -srcfolder "$STAGING" \
    -ov -format UDZO \
    "$DMG_PATH"

rm -rf "$STAGING"

echo "✓ DMG created: $DMG_PATH"

if [ "$NOTARIZE" = "1" ]; then
    echo ""
    "$SCRIPT_DIR/sign-notarize.sh" "$DMG_PATH"
else
    echo "⚠ Skipped notarization (NOTARIZE=0). Sign + notarize manually with:"
    echo "  ./scripts/sign-notarize.sh $DMG_PATH"
fi
