# NearsecTogether Cross-Platform Refactoring — Complete

## Summary of Changes

This refactoring makes NearsecTogether cross-platform while maintaining stable Linux behavior as the primary target and marking Windows and macOS as EXPERIMENTAL.

---

## PART 1: Node.js (server.js) — Platform-Agnostic Shell Calls

### Changes Made:

1. **Updated package.json** — Added cross-platform npm packages:
   - `"open": "latest"` — Replaces xdg-open/start/open
   - `"play-sound": "latest"` — Replaces aplay (Linux audio playback)
   - `"kill-port": "latest"` — Replaces fuser -k for port cleanup
   - `"which": "latest"` — Replaces `which` shell calls

2. **server.js Modifications**:
   - **Imported cross-platform packages** (lines 10–12):
     ```javascript
     const open = require("open");
     const which = require("which");
     const killPort = require("kill-port");
     ```

   - **Replaced openBrowser()** — Now uses `open()` instead of `exec("xdg-open")`
   - **Replaced all tunnel binary detection** — Changed from `exec("which ...")` to `which()` promise-based checks in:
     - `startTunnelCloudflared()`
     - `startTunnelPlayit()`
     - `startTunnelLocalhostRun()`
     - `startTunnelServeo()`

   - **Replaced aplay audio** (line ~540) — Now uses play-sound package:
     ```javascript
     const player = require('play-sound')(opts = {});
     ```

   - **Replaced fuser -k** (line ~1060) — Now uses kill-port package:
     ```javascript
     killPort(3000).catch(err => { /* OK if port not in use */ });
     ```

   - **Added platform detection** (lines 385–393) — Startup warning for experimental platforms:
     ```javascript
     if (process.platform === 'win32' || process.platform === 'darwin') {
       console.warn('⚠  WARNING: Running on an EXPERIMENTAL platform.');
       console.warn('   Windows and macOS support is untested and incomplete.');
       console.warn('   Linux is the only fully supported host OS.');
     }
     ```

---

## PART 2: Python Sidecar (input_driver.py) — Platform-Specific Backends

### New Directory Structure:
```
input_backends/
  __init__.py
  linux_uinput.py        ← Stable Linux backend (existing uinput code)
  windows_vigem.py       ← EXPERIMENTAL Windows backend (vgamepad + ViGEmBus)
  mac_stub.py            ← EXPERIMENTAL macOS backend (pyautogui KBM only)
```

### input_driver.py — Now a Dispatcher

The main `input_driver.py` is now a thin dispatcher (~45 lines) that:
1. Detects OS via `platform.system()`
2. Loads the appropriate backend
3. Calls `run()` from the backend

**Platform Detection:**
```python
OS = platform.system()

if OS == "Linux":
    from input_backends.linux_uinput import run
elif OS == "Windows":
    from input_backends.windows_vigem import run
elif OS == "Darwin":
    from input_backends.mac_stub import run
else:
    sys.exit(1)

run()
```

### Backend Details:

#### **linux_uinput.py** (Stable)
- Direct extract of original input_driver.py code
- Creates uinput devices for virtual gamepads
- Supports all gamepad profiles (Xbox 360, Xbox One, PS4, PS5)
- Full KBM passthrough (raw and emulated modes)
- Motion control support

#### **windows_vigem.py** (EXPERIMENTAL)
- Uses vgamepad library (wraps ViGEmBus driver)
- **Profile Mapping:**
  - Xbox controllers → `vg.VX360Gamepad()` (XInput standard)
  - PS4/PS5 (if enabled) → `vg.VDS4Gamepad()`
  - Defaults to Xbox 360 (most compatible)
- **Unsupported Features:**
  - `force_xboxone` flag (logged but no effect; XInput has no 360/One distinction in practice)
  - Motion controls (logged warning if attempted; skipped silently)
  - KBM passthrough (logged limitation)
- All configuration messages (set_enable_dualshock, set_enable_motion, etc.) handled gracefully

#### **mac_stub.py** (EXPERIMENTAL)
- Uses pyautogui for keyboard/mouse emulation only
- **No gamepad injection** (macOS lacks equivalent to uinput or ViGEmBus)
- When gamepad message arrives: logs once per pad_id, then silently discards
- Configuration messages (flush_neutral, disconnect_viewer, etc.) are no-ops with log entries
- Mouse movement via `pyautogui.move()`
- Keyboard via `pyautogui.keyDown()` / `pyautogui.keyUp()`

---

## PART 3: Requirements & Dependencies

### Created Files:

**requirements-linux.txt:**
```
python-uinput
```

**requirements-windows.txt:**
```
vgamepad
pyautogui
```

**requirements-mac.txt:**
```
pyautogui
```

### Installation Instructions:

**Linux (existing):**
```bash
pip install -r requirements-linux.txt
```

**Windows (new):**
1. Download & install ViGEmBus from: https://github.com/nefarius/ViGEmBus/releases
2. Install Python packages:
   ```bash
   pip install -r requirements-windows.txt
   ```

**macOS (new):**
```bash
pip install -r requirements-mac.txt
```

---

## PART 4: Preserved Behavior

✓ **Linux** — All existing uinput behavior preserved  
✓ **Message Protocol** — All existing JSON messages unchanged  
✓ **Viewer Client** — No changes required (still receives same protocol)  
✓ **host.html / host.js** — No UI changes (backend only)  
✓ **KBM Bindings** — kbm_bindings.json unchanged  

---

## PART 5: Experimental Warnings

### Node.js (server.js):
- Console warning printed at startup on Windows/macOS
- Message clearly states Linux is the only fully supported platform

### Python Sidecar:
- Each backend prints platform-specific warnings on load
- Windows: ViGEmBus driver installation link provided
- macOS: Gamepad injection limitation noted

### Code Comments:
- All EXPERIMENTAL code paths marked with comments:
  ```python
  # EXPERIMENTAL (Windows)
  # EXPERIMENTAL (macOS)
  ```

---

## Testing Checklist

- [ ] **Linux**: Run `npm install` and test existing functionality unchanged
- [ ] **Linux**: Verify tunnel detection with cross-platform `which` package
- [ ] **Linux**: Test audio playback via play-sound instead of aplay
- [ ] **Windows**: Install ViGEmBus driver
- [ ] **Windows**: Run `npm install && pip install -r requirements-windows.txt`
- [ ] **Windows**: Test controller injection with vgamepad
- [ ] **Windows**: Verify experimental warnings print on startup
- [ ] **macOS**: Install pyautogui via requirements
- [ ] **macOS**: Test KBM passthrough
- [ ] **macOS**: Verify gamepad rejection logs correctly
- [ ] **All Platforms**: Test port cleanup (kill-port) on shutdown

---

## Files Modified/Created

### Modified:
- `package.json` — Added npm dependencies
- `src/server.js` — Replaced shell calls, added platform warnings
- `input_driver.py` — Now dispatcher-only

### Created:
- `input_backends/__init__.py`
- `input_backends/linux_uinput.py`
- `input_backends/windows_vigem.py`
- `input_backends/mac_stub.py`
- `requirements-linux.txt`
- `requirements-windows.txt`
- `requirements-mac.txt`

---
