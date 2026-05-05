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

# ── Steam Input bypass ────────────────────────────────────────────────────────
# SDL (which Steam uses) will re-map controllers through "Steam Input" by default,
# causing doubled/remapped inputs and requiring the user to disable Steam Input.
# Setting SDL_GAMECONTROLLER_IGNORE_DEVICES tells SDL to completely skip
# our emulated gamepads (by VID:PID), so games receive raw uinput events instead.
#
# VID:PIDs covered:
#   045e:028e  Microsoft X-Box 360 pad (default emulated profile)
#   054c:09cc  Sony DualShock 4 Wireless Controller
#   054c:0ce6  Sony DualSense (PS5)
#
# If this doesn't help for a specific game, also try:
#   export SDL_GAMECONTROLLERCONFIG=""
#   (clears any custom Steam Input mapping for this session)
export SDL_GAMECONTROLLER_IGNORE_DEVICES="0x045e/0x028e,0x054c/0x09cc,0x054c/0x0ce6"
echo "  ✓ Steam Input bypass set (SDL_GAMECONTROLLER_IGNORE_DEVICES)"

# Check for untracked personal configs
if git status --porcelain | grep -qE "^\?\? (\.env|nearsectogether\.config\.json)"; then
  echo "  ! Warning: Uncommitted personal config files found."
  echo "    Please ensure .env and nearsectogether.config.json are in your .gitignore"
fi

if [ -f node_modules/.bin/electron ]; then
  echo "  ▶ Launching NearsecTogether host app..."
  exec node_modules/.bin/electron . "$@"
else
  echo "  ✗ Electron not found. Run 'npm install' to get it."; exit 1
fi
