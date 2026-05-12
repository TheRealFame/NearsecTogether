#!/bin/sh
# shellcheck disable=SC2039
: << 'BATCH_SECTION'
@echo off
goto :WINDOWS
BATCH_SECTION

# --- UNIX SECTION (Linux, Mac, FreeBSD, Arch) ---
# 1. Get the directory of the script
# 2. Move up one level (..)
# 3. Enter that parent directory
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

cleanup() {
    echo "\n  ! Shutting down... cleaning up port 3000"
    lsof -ti:3000 | xargs kill -9 >/dev/null 2>&1
    exit
}
trap cleanup 2 15

echo "  ┌─────────────────────────────────────┐"
echo "  │      Nearsec Together Launcher      │"
echo "  └─────────────────────────────────────┘"

# OS Detection & Environment Logic
OS="$(uname -s)"
if [ "$OS" = "Linux" ]; then
    ! lsmod | grep -q uinput && sudo modprobe uinput 2>/dev/null
    [ -e /dev/uinput ] && [ ! -w /dev/uinput ] && sudo chmod 666 /dev/uinput 2>/dev/null
fi

if [ "$OS" = "Darwin" ]; then
    echo "  [WARNING] macOS Experimental Mode:"
    echo "  - Gamepad injection is NOT supported"
    echo "  - Keyboard/Mouse passthrough available only"
    echo "  - Install pyautogui: pip3 install pyautogui"
    echo ""
fi

[ ! -f .env ] && printf "CF_TOKEN=\nUSE_VPS=false\n" > .env
! command -v node >/dev/null 2>&1 && { echo "X Node.js missing"; exit 1; }
[ ! -d node_modules ] && npm install --silent

# export SDL_GAMECONTROLLER_IGNORE_DEVICES="0x045e/0x028e,0x054c/0x09cc,0x054c/0x0ce6"
if [ -f node_modules/.bin/electron ]; then
    ./node_modules/.bin/electron . "$@"
else
    exec node src/scripts/server.js "$@"
fi
exit 0

:WINDOWS
:: --- WINDOWS SECTION ---
@echo off
:: %~dp0 is the folder containing the script.
:: %~dp0.. moves the path up one level.
cd /d "%~dp0.."

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do taskkill /f /pid %%a >nul 2>&1
if not exist .env echo CF_TOKEN= > .env

echo ========================================
echo    Nearsec Together Launcher (Windows)
echo ========================================
echo.
echo IMPORTANT: Windows requires ViGEmBus driver for gamepad support!
echo Download and install from:
echo https://github.com/nefarius/ViGEmBus/releases
echo.
echo For KBM and basic testing:
echo - KBM input will work (keyboard/mouse passthrough)
echo - Gamepad will NOT work without ViGEmBus
echo - Audio playback uses Windows Media Player
echo.

node -v >nul 2>&1 || (echo Node.js missing & pause & exit)
if not exist node_modules call npm install --silent

:: set SDL_GAMECONTROLLER_IGNORE_DEVICES=0x045e/0x028e,0x054c/0x09cc,0x054c/0x0ce6
if exist node_modules\.bin\electron.cmd (
    call node_modules\.bin\electron.cmd . %*
) else (
    node src\scripts\server.js %*
)
pause
