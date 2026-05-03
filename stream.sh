#!/usr/bin/env bash
# Nearsec Together Launcher
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo ""
echo "  ┌─────────────────────────────────────┐"
echo "  │      Nearsec Together Launcher      │"
echo "  └─────────────────────────────────────┘"
echo ""

# Node.js
if ! command -v node &>/dev/null; then
  echo "  ✗ Node.js not found. Install: https://nodejs.org"; exit 1
fi
echo "  ✓ Node.js $(node --version)"

# npm packages
if [ ! -d node_modules ]; then
  echo "  ! Installing npm packages..."
  npm install --silent && echo "  ✓ Packages installed"
else
  echo "  ✓ npm packages present"
fi

# uinput
if ! lsmod | grep -q uinput; then
  sudo modprobe uinput 2>/dev/null && echo "  ✓ uinput loaded" || echo "  ! uinput unavailable"
else
  echo "  ✓ uinput loaded"
fi
if [ -e /dev/uinput ] && [ ! -w /dev/uinput ]; then
  sudo chmod 666 /dev/uinput 2>/dev/null
fi

# python-uinput
python3 -c "import uinput" 2>/dev/null && echo "  ✓ python-uinput installed" || {
  echo "  ! Installing python-uinput..."
  pip install python-uinput --break-system-packages --quiet 2>/dev/null \
    && echo "  ✓ python-uinput installed" \
    || echo "  ! python-uinput unavailable"
}

# Kill existing server on port 3000
fuser -k 3000/tcp 2>/dev/null || true

echo ""

# Launch Electron if available, otherwise plain Node
if [ -f node_modules/.bin/electron ]; then
  echo "  ▶ Launching Electron host app..."
  exec node_modules/.bin/electron . "$@"
else
  echo "  ▶ Launching in browser mode (run 'npm install' to get Electron)..."
  exec node server.js
fi
