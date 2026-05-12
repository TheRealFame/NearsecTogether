# NearsecTogether - Platform-Specific Setup Guide

## Overview

NearsecTogether is a cross-platform game streaming application with three levels of support:

- **✓ Linux**: Fully supported and stable (primary target)
- **⚠ Windows**: Experimental - mostly working with some limitations
- **⚠ macOS**: Experimental - Gamepad emulation via keyboard/mouse, KBM passthrough

---

## Linux Setup (Stable)

### Prerequisites
- Node.js v18+
- Python 3.8+
- uinput kernel module

### Installation

```bash
# Clone/extract the repository
cd NearsecTogether

# Install Python dependencies
pip3 install -r bin/requirements-linux.txt

# Install Node.js dependencies
npm install

# Run the application (handles uinput permissions automatically)
./bin/start.cmd
# OR
npm run electron
```

### What Works
✓ Full gamepad support (buttons, analog sticks, triggers, D-Pad)
✓ Keyboard and mouse input passthrough
✓ Motion controls (6DOF)
✓ Multiple concurrent controllers
✓ Native uinput driver (no external tools needed)

### Notes
- The `start.cmd` script automatically loads the `uinput` kernel module
- You may be prompted for `sudo` password for uinput permissions
- To avoid sudo, add your user to the input group:
  ```bash
  sudo usermod -a -G input $USER
  # Logout and login for changes to take effect
  ```

---

## Windows Setup (Experimental)

### Prerequisites

**Mandatory:**
- Node.js v18+ (https://nodejs.org/)
- Python 3.8+ (https://www.python.org/downloads/)

**For Full Gamepad Support:**
- ViGEmBus driver (https://github.com/nefarius/ViGEmBus/releases)
  - Download the latest `.exe` installer
  - Run as Administrator and reboot
  - This provides virtual Xbox controller injection

### Quick Start for Beginners

If you're new to Windows development tools, follow this step-by-step guide:

#### Step 1: Install Node.js

1. Go to https://nodejs.org/
2. Click the **"LTS"** button (green one - this is the stable version)
3. Download will start automatically
4. Open the downloaded `.msi` file
5. Click **"Next"** through all the screens (keep defaults)
6. Check **"Automatically install necessary tools"** if prompted
7. Click **"Install"** and wait for completion
8. Click **"Finish"** and restart your computer

**Verify it worked:**
- Press `Windows Key + R`
- Type `cmd` and press Enter
- In the black window, type: `node --version`
- You should see a version number (like `v20.x.x`)

#### Step 2: Install Python

1. Go to https://www.python.org/downloads/
2. Click the yellow **"Download Python"** button
3. Open the downloaded `.exe` file
4. ⚠️ **IMPORTANT**: Check the box that says **"Add Python to PATH"** at the bottom
5. Click **"Install Now"**
6. Wait for completion and click **"Close"**

**Verify it worked:**
- Press `Windows Key + R`
- Type `cmd` and press Enter
- In the black window, type: `python --version`
- You should see a version number (like `Python 3.x.x`)

#### Step 3: Extract NearsecTogether

1. Download the NearsecTogether files as a `.zip` file
2. Right-click the `.zip` file
3. Select **"Extract All..."**
4. Choose where you want to save it (e.g., `C:\Users\YourName\NearsecTogether`)
5. Click **"Extract"**

#### Step 4: Open PowerShell in the NearsecTogether Folder

1. Navigate to your NearsecTogether folder
2. Hold `Shift` and right-click in an empty area
3. Select **"Open PowerShell window here"** (or **"Open Command Prompt window here"**)
4. If you see a blue window with text at the bottom, you're ready!

#### Step 5: Install Dependencies

In the PowerShell window, copy and paste this command, then press Enter:

```powershell
pip install -r bin/requirements-windows.txt
```

Wait for it to finish (you'll see lots of downloading messages).

Then run:

```powershell
npm install
```

Again, wait for it to finish. This can take a few minutes.

#### Step 6: (Optional) Install ViGEmBus for Gamepad Support

If you want to use a gamepad controller:

1. Go to https://github.com/nefarius/ViGEmBus/releases
2. Look for the latest release and download the `.exe` installer
3. Right-click the downloaded `.exe`
4. Select **"Run as Administrator"**
5. Click **"Install"**
6. When done, click **"Finish"** and **restart your computer**

#### Step 7: Run the Application

In PowerShell (in your NearsecTogether folder), run:

```powershell
npm run electron
```

A window should open with the NearsecTogether application!

### Installation (Advanced/Command Reference)

```bash
# 1. Extract NearsecTogether to a folder

# 2. Open PowerShell/Command Prompt (right-click "Run as administrator" for better performance)

# 3. Navigate to the folder
cd C:\path\to\NearsecTogether
And run with "PowerShell.exe -ExecutionPolicy Bypass -File .\windows_setup.ps1"

# 4. Install Python dependencies
pip install -r bin/requirements-windows.txt

# 5. Install Node.js dependencies
npm install

# 6. (Optional but recommended) Install ViGEmBus driver
#    Download from: https://github.com/nefarius/ViGEmBus/releases
#    Run installer and reboot

# 7. Run the application
node bin/start.cmd
# OR for Electron UI:
npm run electron
```

### What Works
✓ WebRTC streaming (core feature)
✓ Keyboard and mouse input forwarding
✓ Audio playback (via Windows Media Player)
✓ Gamepad injection (if ViGEmBus installed)

### Known Limitations
✗ Gamepad will NOT work without ViGEmBus driver
✗ KBM input forwarding has limited key coverage (basic WASD/arrows/mouse)
✗ Process priority may be limited without admin rights
⚠ First connection may show system permission dialogs

### Troubleshooting

**"Node is not recognized" or "Python is not recognized":**
- You skipped the "Add to PATH" step during installation
- Restart your computer after installing Node.js/Python
- If still not working, reinstall with the **"Add to PATH"** option checked

**"vgamepad not installed" error:**
```bash
pip install vgamepad
```

**Gamepad not working:**
- Verify ViGEmBus is installed: Device Manager → Other devices → ViGEmBus Device
- If not present, download and install from: https://github.com/nefarius/ViGEmBus/releases
- Reboot after installation

**PowerShell won't run my commands:**
- Right-click PowerShell and select "Run as Administrator"
- This gives the application the permissions it needs

**Audio not playing:**
- Check that PowerShell can execute: `powershell -Command "Write-Host 'test'"`
- If disabled, enable scripts in PowerShell (run as admin):
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```

**"Permission Denied" when running commands:**
- Right-click PowerShell and select "Run as Administrator"
- You need admin rights for full functionality

**Dependencies won't install (pip/npm errors):**
- Make sure you're in the correct folder (should see files like `package.json` and `requirements-windows.txt`)
- Try running PowerShell as Administrator
- Check your internet connection

---

## macOS Setup (Experimental)

### Prerequisites

**Mandatory:**
- Node.js v18+ (https://nodejs.org/ or `brew install node`)
- Python 3.8+ (usually pre-installed, or `brew install python@3.11`)

**For Gamepad Emulation (Optional but Recommended):**
- **Accessibility Permission** required for pynput to work
  - See "Permissions" section below

### Installation

```bash
# 1. Extract NearsecTogether to a folder
# 2. Open Terminal

# 3. Navigate to the folder
cd /path/to/NearsecTogether

# 4. Install Python dependencies (includes pynput for gamepad emulation)
pip3 install -r bin/requirements-mac.txt

# 5. Install Node.js dependencies
npm install

# 6. Grant Accessibility permission (required for gamepad emulation)
#    → System Settings → Security & Privacy → Accessibility
#    → Add NearsecTogether to the allowed apps list

# 7. Run the application
./bin/start.cmd
# OR for Electron UI:
npm run electron
```

### What Works
✓ WebRTC streaming (core feature)
✓ Keyboard and mouse input passthrough (via pyautogui)
✓ **NEW: Gamepad emulation** - translates controller input to keyboard/mouse events
✓ Audio playback (native afplay)
✓ Screen capture and display
✓ Steam Input remapping (works with emulated keys/mouse)

### Gamepad Emulation Details

**How it works:**
- Gamepad input is translated to keyboard and mouse events
- Left stick → WASD keys (movement)
- Right stick → Mouse movement (camera)
- A button → Space (action/jump)
- B button → Escape (menu)
- X button → R (reload/interact)
- Y button → E (equipment/ability)
- LB/RB → Shift/Cmd modifiers
- Triggers → Mouse clicks

**Compatibility:**
- Works with any game that accepts keyboard/mouse input
- Compatible with Steam Input for additional remapping
- Cross-architecture: Works on Intel and Apple Silicon (M1/M2/M3)

### Permissions Required

**Accessibility Permission** (for pynput gamepad emulation):
1. Open System Settings
2. Go to **Security & Privacy** → **Accessibility**
3. Click the lock to unlock it
4. Add your Terminal or iTerm2 application to the list
5. Or add the NearsecTogether application if running as standalone Electron app

### Known Limitations
✗ No direct gamepad injection (macOS system limitation)
✗ Gamepad input emulated via keyboard/mouse (not native controller API)
✗ Motion controls not supported
✗ One viewer/gamepad at a time (not multiple concurrent controllers)

### Troubleshooting

**"pynput not installed" error:**
```bash
pip3 install pynput
```

**Gamepad emulation not working:**
- Verify Accessibility permission is granted (see Permissions section)
- Try restarting the application after granting permission
- Check console for permission error messages

**"pyautogui not installed" error:**
```bash
pip3 install pyautogui
```

**KBM input not working:**
- Check Terminal has accessibility permissions:
  - System Settings → Privacy & Security → Accessibility
  - Add Terminal or iTerm2 to the list

**Audio not playing:**
- Check afplay is available: `which afplay`
- Should be present on all modern macOS versions

---

## Platform Comparison

| Feature | Linux | Windows | macOS |
|---------|-------|---------|-------|
| **WebRTC Streaming** | ✓ | ✓ | ✓ |
| **Gamepad Support** | ✓ Full | ⚠ Conditional* | ⚠ Emulated** |
| **Keyboard/Mouse** | ✓ Full | ⚠ Limited | ✓ Full |
| **Motion Controls** | ✓ | ✗ | ✗ |
| **Multiple Controllers** | ✓ | ⚠ Limited | ✗ |
| **Audio Playback** | ✓ | ⚠ PowerShell | ✓ afplay |
| **Display Capture** | ✓ | ✓ | ✓ |
| **Admin Required** | Optional | Recommended | Optional |
| **Stability** | Production | Experimental | Experimental |

*Windows: Requires ViGEmBus driver for gamepad injection
**macOS: Gamepad input translated to keyboard/mouse events (works with most games)

*Windows gamepad requires ViGEmBus driver

---

## Common Issues Across Platforms

### Port 3000 Already in Use
```bash
# Linux/macOS: Kill the process
lsof -ti:3000 | xargs kill -9

# Windows (PowerShell as Admin):
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Node.js/npm Not Found
```bash
# Verify installation
node --version
npm --version

# Install Node.js from https://nodejs.org/
# Or use package manager:
# Ubuntu: sudo apt install nodejs npm
# Fedora: sudo dnf install nodejs npm
# macOS: brew install node
# Windows: Download installer
```

### Python Not Found
```bash
# Verify installation
python3 --version

# Install Python 3 from https://www.python.org/
# Or use package manager:
# Ubuntu: sudo apt install python3 python3-pip
# Fedora: sudo dnf install python3
# macOS: brew install python@3.11
# Windows: Download installer
```

### Socket/Permission Errors
- **Linux**: Run with sudo or fix uinput permissions (see Linux setup)
- **Windows**: Run PowerShell as Administrator
- **macOS**: Grant Terminal accessibility permissions (System Settings → Privacy & Security)

---

## Environment Variables

Optional configuration via `.env` file:

```bash
CF_TOKEN=<your-cloudflare-token>    # For persistent tunnels
CUSTOM_URL=<custom-domain>           # Your tunnel URL
USE_VPS=false                        # Enable VPS tunnel mode
TUNNEL=cloudflared                   # Force specific tunnel provider
```

---

## Performance Tips

### Linux
- Run with admin rights for full process priority
- Use native GPU drivers for better encoding
- Check GPU is being used: `vgpu_device -l`

### Windows
- Run as Administrator for better performance
- Disable Windows Game Bar to reduce interference
- Check GPU is working: Device Manager → Display adapters

### macOS
- Disable system screen effects for better performance
- Close other bandwidth-heavy applications
- Use 5GHz WiFi for wireless streaming

---

## Getting Help

If you encounter issues:
1. Check the console output for specific error messages
2. Verify all prerequisites are installed
3. Review the platform-specific troubleshooting section above
4. Check .env configuration
5. Try on Linux if possible to confirm it's a platform-specific issue

For bugs and feature requests, see the main README.md

---

## Quick Reference Commands

### Linux
```bash
./bin/start.cmd
# OR
npm run electron
```

### Windows (PowerShell)
```powershell
npm run electron
# OR
node bin/start.cmd
```

### macOS
```bash
./bin/start.cmd
# OR
npm run electron
```

All platforms will start an Electron window (if available) or terminal-based server on http://localhost:3000/host
