"""
EXPERIMENTAL (macOS): KBM-only stub backend using pyautogui.
No gamepad injection support (no equivalent to uinput or ViGEmBus).
Keyboard and mouse emulation only.
"""

import sys
import json
import os

try:
    import pyautogui
except ImportError:
    print(
        "[input] ERROR: pyautogui not installed. Install with: pip install pyautogui",
        flush=True,
    )
    sys.exit(1)

# Disable failsafe (Ctrl+C) since we may want it for the host
pyautogui.FAILSAFE = False


# ── KBM Bindings ───────────────────────────────────────────────────────────────
BINDINGS_FILE = "kbm_bindings.json"
DEFAULT_BINDINGS = {
    "buttons": {},
    "left_stick": {},
    "dpad": {},
    "right_stick_mouse": True,
    "right_stick_multiplier": 1500,
}

if os.path.exists(BINDINGS_FILE):
    try:
        with open(BINDINGS_FILE, "r") as f:
            kbm_binds = json.load(f)
            print("[input] Loaded kbm_bindings.json", flush=True)
    except Exception as e:
        print(f"[input] Error loading KBM bindings: {e}, using defaults", flush=True)
        kbm_binds = DEFAULT_BINDINGS
else:
    kbm_binds = DEFAULT_BINDINGS


# ── Settings ────────────────────────────────────────────────────────────────────
force_xboxone = True
enable_dualshock = False
enable_motion = False

# ── Device manager ─────────────────────────────────────────────────────────────
devices = {}
viewer_modes = {}
logged_gamepad_warnings = set()


# ── Key mapping for pyautogui ───────────────────────────────────────────────────
# Map uinput key names to pyautogui key names
PYAUTOGUI_KEY_MAP = {
    "KEY_A": "a",
    "KEY_B": "b",
    "KEY_C": "c",
    "KEY_D": "d",
    "KEY_E": "e",
    "KEY_F": "f",
    "KEY_W": "w",
    "KEY_S": "s",
    "KEY_Q": "q",
    "KEY_R": "r",
    "KEY_UP": "up",
    "KEY_DOWN": "down",
    "KEY_LEFT": "left",
    "KEY_RIGHT": "right",
    "KEY_SPACE": "space",
    "KEY_ENTER": "enter",
    "KEY_ESC": "esc",
    "KEY_LEFTSHIFT": "shift",
    "KEY_LEFTCTRL": "ctrl",
    "KEY_TAB": "tab",
    "KEY_Z": "z",
    "KEY_X": "x",
    "KEY_V": "v",
    "KEY_1": "1",
    "KEY_2": "2",
}


def run():
    """
    EXPERIMENTAL (macOS): Main input loop for pyautogui stub backend.
    Supports only keyboard and mouse input via pyautogui.
    Gamepad injection is not supported.
    """
    global force_xboxone, enable_dualshock, enable_motion

    print("[input] macOS pyautogui stub backend initialized (KBM only)", flush=True)
    print("[input] WARNING: Gamepad injection is NOT supported on macOS", flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            msg = json.loads(line)

            # ── Configuration messages ──────────────────────────────────────
            if msg.get("type") == "set_force_xboxone":
                force_xboxone = bool(msg.get("value", True))
                continue

            if msg.get("type") == "set_enable_dualshock":
                enable_dualshock = bool(msg.get("value", False))
                continue

            if msg.get("type") == "set_enable_motion":
                enable_motion = bool(msg.get("value", False))
                continue

            if msg.get("type") == "set-input-mode":
                vid = str(msg.get("viewerId", ""))
                mode = msg.get("mode", "gamepad")
                viewer_modes[vid] = mode
                print(f"[input] Viewer {vid} mode set to: {mode}", flush=True)
                continue

            if msg.get("type") in ["flush_neutral", "disconnect_viewer"]:
                # No-op on macOS stub
                continue

            pad_id = str(msg.get("pad_id", "default"))
            vid = str(msg.get("viewer_id", pad_id.split("_")[0]))
            current_mode = viewer_modes.get(vid, "gamepad")

            # ── Gamepad ID detection (not supported) ────────────────────────
            if msg.get("type") == "gpid":
                if pad_id not in logged_gamepad_warnings:
                    print(
                        f"[input] macOS: gamepad injection not supported for {pad_id}. KBM emulation only.",
                        flush=True,
                    )
                    logged_gamepad_warnings.add(pad_id)
                continue

            # ── Gamepad input (not supported) ───────────────────────────────
            if msg.get("type") == "gamepad":
                if pad_id not in logged_gamepad_warnings:
                    print(
                        f"[input] macOS: Discarding gamepad input for {pad_id} (not supported)",
                        flush=True,
                    )
                    logged_gamepad_warnings.add(pad_id)
                continue

            # ── Motion control (not supported) ──────────────────────────────
            if msg.get("type") == "motion":
                continue

            # ── Keyboard and mouse ──────────────────────────────────────────
            if msg.get("type") == "kbm":
                event_type = msg.get("event")

                # Mouse movement
                if event_type == "mousemove":
                    dx = msg.get("dx", 0)
                    dy = msg.get("dy", 0)
                    if dx != 0 or dy != 0:
                        try:
                            # Move relative to current position
                            pyautogui.move(dx, dy, duration=0.01)
                        except Exception as e:
                            print(f"[input] Mouse move error: {e}", flush=True)

                # Keyboard
                if event_type in ["keydown", "keyup"]:
                    key_name = msg.get("key", "")
                    
                    # Try to map from uinput name
                    if key_name in PYAUTOGUI_KEY_MAP:
                        py_key = PYAUTOGUI_KEY_MAP[key_name]
                    else:
                        py_key = key_name.lower().replace("key_", "")

                    try:
                        if event_type == "keydown":
                            pyautogui.keyDown(py_key)
                        else:  # keyup
                            pyautogui.keyUp(py_key)
                    except Exception as e:
                        print(f"[input] Key '{py_key}' error: {e}", flush=True)

        except json.JSONDecodeError:
            pass
        except Exception as e:
            print(f"[input] Unexpected error: {e}", flush=True)
