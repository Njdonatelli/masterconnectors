#!/bin/bash
# DataBridge dev script — watch & auto-rebuild + relaunch as .app bundle
# Usage: ./dev.sh

set -e

APP_NAME="DataBridge"
BUILD_DIR=".build/debug"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"

build_app_bundle() {
    # Wrap the executable into a proper .app bundle with icon
    local contents="$APP_BUNDLE/Contents"
    local macos="$contents/MacOS"
    local resources="$contents/Resources"

    rm -rf "$APP_BUNDLE"
    mkdir -p "$macos" "$resources"

    # Copy executable
    cp "$BUILD_DIR/$APP_NAME" "$macos/$APP_NAME"

    # Copy Info.plist
    cp "DataBridge/Resources/Info.plist" "$contents/Info.plist"

    # Copy icon
    cp "DataBridge/Resources/AppIcon.icns" "$resources/AppIcon.icns"

    # Copy SPM-generated resources bundle (Assets.xcassets, entitlements)
    if [ -d "$BUILD_DIR/${APP_NAME}_${APP_NAME}.bundle" ]; then
        cp -R "$BUILD_DIR/${APP_NAME}_${APP_NAME}.bundle" "$resources/"
    fi

    # Refresh the Finder icon cache for this bundle
    touch "$APP_BUNDLE"
}

cleanup() {
    killall "$APP_NAME" 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

build_and_run() {
    echo "🔨 Building..."
    killall "$APP_NAME" 2>/dev/null || true

    if swift build 2>&1; then
        echo "📦 Creating .app bundle..."
        build_app_bundle
        echo "✅ Build succeeded — launching app..."
        open "$APP_BUNDLE"
    else
        echo "❌ Build failed"
    fi
    echo ""
    echo "👀 Watching for changes... (Ctrl+C to stop)"
}

# Initial build
build_and_run

# Watch for .swift file changes using a simple polling loop
# Install fswatch for better performance: brew install fswatch
LAST_HASH=""
while true; do
    sleep 2
    CURRENT_HASH=$(find DataBridge -name "*.swift" -newer "$BUILD_DIR/$APP_NAME" 2>/dev/null | head -1)
    if [ -n "$CURRENT_HASH" ]; then
        echo ""
        echo "📝 Change detected..."
        build_and_run
    fi
done
