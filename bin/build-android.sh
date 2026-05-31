#!/bin/bash
# Move to the directory containing this script, then up one level to the project root
cd "$(dirname "$0")/.." || exit

# Create a clean dist-android directory
rm -rf dist-android
mkdir -p dist-android

# Process dashboard.html -> index.html
if [ -f "src/pages/dashboard.html" ]; then
    echo "Processing dashboard.html..."
    sed -e 's|../scripts/|js/|g' \
        -e 's|../css/|css/|g' \
        -e 's|../../assets/|assets/|g' \
        -e 's|</head>|<style>#tab-host, #tab-containers, #settingRowOldUI, #settingRowAutoHost, #settingRowTray, #settingRowAlwaysOnTop, #settingRowHidePreview, #settingRowMic { display: none !important; }</style></head>|' \
        src/pages/dashboard.html > dist-android/index.html
else
    echo "ERROR: src/pages/dashboard.html not found!"
    exit 1
fi

# Process gamepad-popup.html
if [ -f "src/pages/gamepad-popup.html" ]; then
    echo "Processing gamepad-popup.html..."
    sed -e 's|../scripts/|js/|g' \
        -e 's|../css/|css/|g' \
        -e 's|../../assets/|assets/|g' \
        -e 's|</head>|<style>.host-only, [id*="driver"], [id*="Driver"], [class*="driver"] { display: none !important; }</style></head>|' \
        src/pages/gamepad-popup.html > dist-android/gamepad-popup.html
else
    echo "ERROR: src/pages/gamepad-popup.html not found!"
    exit 1
fi

echo "Build complete."
