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
setlocal enabledelayedexpansion

:: Set UTF-8 code page so Unicode characters render correctly in this terminal
chcp 65001 > nul 2>&1

:: Set window title
title NearsecTogether

cd /d "%~dp0.."

:: Kill any existing process on port 3000
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :3000') do taskkill /f /pid %%a >nul 2>&1

if not exist .env (
    echo CF_TOKEN= > .env
)

echo.
echo ========================================
echo  NearsecTogether Launcher (Windows)
echo ========================================
echo.
echo  Gamepad support requires ViGEmBus driver:
echo  https://github.com/nefarius/ViGEmBus/releases
echo.
echo  Tunnel setup: run bin\windows_setup.ps1 if needed
echo  (installs cloudflared, zrok, and/or playit)
echo.

node -v >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

if not exist node_modules (
    echo Installing npm dependencies...
    call npm install --silent
    if errorlevel 1 (
        echo ERROR: npm install failed
        pause
        exit /b 1
    )
)

if exist node_modules\.bin\electron.cmd (
    call node_modules\.bin\electron.cmd . %*
) else (
    node src\scripts\server.js %*
)

:: Only pause if the app exited with an error so the user can read it.
:: Normal Electron close exits with code 0 and this window will auto-close.
if errorlevel 1 (
    echo.
    echo  Application exited with an error ^(code %errorlevel%^).
    echo  Press any key to close this window.
    pause > nul
)

endlocal
