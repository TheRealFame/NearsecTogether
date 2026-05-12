"""
Linux uinput backend — stable, primary target.
Uses python-uinput to create virtual gamepad devices.

Gamepad and KBM are separate uinput devices so the OS never
mistakes stick axes for mouse movement.
"""

import sys
import json
import uinput
import time
import os


# ── 1. Gamepad Layout ────────────────────────────────────────────────────────
W3C_MAPPING = {
    0: uinput.BTN_A,
    1: uinput.BTN_B,
    2: uinput.BTN_X,
    3: uinput.BTN_Y,
    4: uinput.BTN_TL,
    5: uinput.BTN_TR,
    # 6 and 7 are Triggers (ABS_Z and ABS_RZ)
    8: uinput.BTN_SELECT,
    9: uinput.BTN_START,
    10: uinput.BTN_THUMBL,
    11: uinput.BTN_THUMBR,
    # 12-15 are D-Pad (ABS_HAT)
    16: uinput.BTN_MODE,
}
BTNS = list(W3C_MAPPING.values())
AXES = [
    uinput.ABS_X  + (-32767, 32767, 16, 128),
    uinput.ABS_Y  + (-32767, 32767, 16, 128),
    uinput.ABS_RX + (-32767, 32767, 16, 128),
    uinput.ABS_RY + (-32767, 32767, 16, 128),
    uinput.ABS_Z  + (0, 255, 0, 0),     # LT / L2
    uinput.ABS_RZ + (0, 255, 0, 0),     # RT / R2
    uinput.ABS_HAT0X + (-1, 1, 0, 0),   # D-Pad X
    uinput.ABS_HAT0Y + (-1, 1, 0, 0),   # D-Pad Y
]
GAMEPAD_EVENTS = BTNS + AXES  # ← clean gamepad only, no mouse/keyboard events

# ── 2. Keyboard & Mouse Layout ───────────────────────────────────────────────
# Kept separate so the OS never registers the gamepad as a pointer device
KBM_EVENTS = [
    uinput.REL_X,
    uinput.REL_Y,
    uinput.REL_WHEEL,
    uinput.BTN_LEFT,
    uinput.BTN_RIGHT,
    uinput.BTN_MIDDLE,
    uinput.KEY_W,
    uinput.KEY_A,
    uinput.KEY_S,
    uinput.KEY_D,
    uinput.KEY_UP,
    uinput.KEY_DOWN,
    uinput.KEY_LEFT,
    uinput.KEY_RIGHT,
    uinput.KEY_SPACE,
    uinput.KEY_ENTER,
    uinput.KEY_ESC,
    uinput.KEY_LEFTSHIFT,
    uinput.KEY_LEFTCTRL,
    uinput.KEY_TAB,
    uinput.KEY_Q,
    uinput.KEY_E,
    uinput.KEY_R,
    uinput.KEY_F,
    uinput.KEY_C,
    uinput.KEY_Z,
    uinput.KEY_X,
    uinput.KEY_V,
    uinput.KEY_B,
    uinput.KEY_1,
    uinput.KEY_2,
]

AXIS_DEADZONE = 1800
force_xboxone = False  # Default off — host UI sends ctrl-settings on connect to sync
enable_dualshock = False
enable_motion = False

# ── 3. Load or Generate KBM Bindings ────────────────────────────────────────
BINDINGS_FILE = "kbm_bindings.json"
DEFAULT_BINDINGS = {
    "buttons": {
        "KEY_SPACE": "BTN_A",
        "KEY_LEFTSHIFT": "BTN_B",
        "KEY_E": "BTN_X",
        "KEY_R": "BTN_Y",
        "KEY_Q": "BTN_TL",
        "KEY_C": "BTN_TR",
        "KEY_F": "BTN_SELECT",
        "KEY_ENTER": "BTN_START",
    },
    "left_stick": {
        "KEY_W": {"axis": "ABS_Y", "val": -32767},
        "KEY_S": {"axis": "ABS_Y", "val": 32767},
        "KEY_A": {"axis": "ABS_X", "val": -32767},
        "KEY_D": {"axis": "ABS_X", "val": 32767},
    },
    "dpad": {
        "KEY_UP":    {"axis": "ABS_HAT0Y", "val": -1},
        "KEY_DOWN":  {"axis": "ABS_HAT0Y", "val": 1},
        "KEY_LEFT":  {"axis": "ABS_HAT0X", "val": -1},
        "KEY_RIGHT": {"axis": "ABS_HAT0X", "val": 1},
    },
    "right_stick_mouse": True,
    "right_stick_multiplier": 1500,
}

if not os.path.exists(BINDINGS_FILE):
    with open(BINDINGS_FILE, "w") as f:
        json.dump(DEFAULT_BINDINGS, f, indent=4)
    kbm_binds = DEFAULT_BINDINGS
    print(f"[input] Created default {BINDINGS_FILE}", flush=True)
else:
    try:
        with open(BINDINGS_FILE, "r") as f:
            kbm_binds = json.load(f)
        print(f"[input] Loaded {BINDINGS_FILE}", flush=True)
    except Exception as e:
        print(f"[input] Error reading {BINDINGS_FILE}, using defaults: {e}", flush=True)
        kbm_binds = DEFAULT_BINDINGS

# ── Profiles ──────────────────────────────────────────────────────────────────
PROFILES = {
    "xbox": {
        "name": "Microsoft X-Box 360 pad",
        "vendor": 0x045e,
        "product": 0x028e,
        "version": 0x0114,
    },
    "xboxone": {
        "name": "Microsoft Xbox One S Pad",
        "vendor": 0x045e,
        "product": 0x02ea,
        "version": 0x0301,
    },
    "xboxseries": {
        "name": "Microsoft Xbox Series S|X Controller",
        "vendor": 0x045e,
        "product": 0x0b12,
        "version": 0x0507,
    },
    "ps4": {
        "name": "Sony DualShock 4 Wireless Controller",
        "vendor": 0x054c,
        "product": 0x09cc,
        "version": 0x0100,
    },
    "ps5": {
        "name": "Sony DualSense Wireless Controller",
        "vendor": 0x054c,
        "product": 0x0ce6,
        "version": 0x0100,
    },
}


def detect_profile(gpid: str) -> str:
    g = gpid.lower()
    is_sony = any(k in g for k in ["054c", "sony", "dualsense", "dualshock", "playstation"])
    if is_sony:
        native = "ps5" if any(k in g for k in ["0ce6", "dualsense", "ps5"]) else "ps4"
        return native if enable_dualshock else "xboxone"
    if "0b12" in g or "xbox series" in g:
        return "xboxseries"
    if not force_xboxone:
        if any(k in g for k in ["028e", "028f", "xbox 360"]):
            return "xbox"
    is_xbox_one = any(
        k in g for k in ["xbox one", "xbox wireless", "02ea", "02d1", "02fd", "02dd", "0291", "0b00", "0b05"]
    )
    if is_xbox_one:
        return "xboxone"
    return "xboxone" if force_xboxone else "xbox"


def make_gamepad(profile_key: str):
    """Create a pure gamepad device — no mouse/keyboard events."""
    p = PROFILES[profile_key]
    return uinput.Device(
        GAMEPAD_EVENTS,
        name=p["name"],
        vendor=p["vendor"],
        product=p["product"],
        version=p.get("version", 0x0100),
        bustype=0x0003,
    )


def make_kbm(pad_id: str):
    """Create a separate KBM device for a viewer in kbm/kbm_emulated mode."""
    return uinput.Device(
        KBM_EVENTS,
        name=f"NearsecTogether KBM {pad_id}",
        vendor=0x5354,   # 'ST' — custom vendor so it's never confused with a real device
        product=0x4b42,  # 'KB'
        version=0x0100,
        bustype=0x0003,
    )


def apply_deadzone(value: int, deadzone: int) -> int:
    return 0 if abs(value) < deadzone else value


def flush_neutral_for_device(gp, is_kbm=False):
    try:
        if is_kbm:
            for key in KBM_EVENTS:
                try:
                    gp.emit(key, 0, syn=False)
                except Exception:
                    pass
        else:
            for btn in BTNS:
                gp.emit(btn, 0, syn=False)
            gp.emit(uinput.ABS_X,     0, syn=False)
            gp.emit(uinput.ABS_Y,     0, syn=False)
            gp.emit(uinput.ABS_RX,    0, syn=False)
            gp.emit(uinput.ABS_RY,    0, syn=False)
            gp.emit(uinput.ABS_Z,     0, syn=False)
            gp.emit(uinput.ABS_RZ,    0, syn=False)
            gp.emit(uinput.ABS_HAT0X, 0, syn=False)
            gp.emit(uinput.ABS_HAT0Y, 0, syn=False)
        gp.syn()
    except Exception:
        pass


# ── Dynamic device manager ───────────────────────────────────────────────────
devices     = {}   # pad_id → gamepad uinput.Device
kbm_devices = {}   # pad_id → KBM uinput.Device (only exists in kbm/kbm_emulated mode)
device_profiles = {}
viewer_modes    = {}

# ── Raw KBM State & Panic Mode ─────────────────────────────────────────────────
kbm_pressed_keys = {}  # viewer_id → set of currently pressed key codes
panic_mode = False     # Global panic toggle to freeze all KBM input

# ── JS-to-Uinput Mapping Dictionary ────────────────────────────────────────────
JS_TO_UINPUT_MAP = {
    # Letters (A-Z)
    'KeyA': 'KEY_A', 'KeyB': 'KEY_B', 'KeyC': 'KEY_C', 'KeyD': 'KEY_D',
    'KeyE': 'KEY_E', 'KeyF': 'KEY_F', 'KeyG': 'KEY_G', 'KeyH': 'KEY_H',
    'KeyI': 'KEY_I', 'KeyJ': 'KEY_J', 'KeyK': 'KEY_K', 'KeyL': 'KEY_L',
    'KeyM': 'KEY_M', 'KeyN': 'KEY_N', 'KeyO': 'KEY_O', 'KeyP': 'KEY_P',
    'KeyQ': 'KEY_Q', 'KeyR': 'KEY_R', 'KeyS': 'KEY_S', 'KeyT': 'KEY_T',
    'KeyU': 'KEY_U', 'KeyV': 'KEY_V', 'KeyW': 'KEY_W', 'KeyX': 'KEY_X',
    'KeyY': 'KEY_Y', 'KeyZ': 'KEY_Z',
    
    # Numbers (0-9)
    'Digit0': 'KEY_0', 'Digit1': 'KEY_1', 'Digit2': 'KEY_2', 'Digit3': 'KEY_3',
    'Digit4': 'KEY_4', 'Digit5': 'KEY_5', 'Digit6': 'KEY_6', 'Digit7': 'KEY_7',
    'Digit8': 'KEY_8', 'Digit9': 'KEY_9',
    
    # Function Keys (F1-F12)
    'F1': 'KEY_F1', 'F2': 'KEY_F2', 'F3': 'KEY_F3', 'F4': 'KEY_F4',
    'F5': 'KEY_F5', 'F6': 'KEY_F6', 'F7': 'KEY_F7', 'F8': 'KEY_F8',
    'F9': 'KEY_F9', 'F10': 'KEY_F10', 'F11': 'KEY_F11', 'F12': 'KEY_F12',
    
    # Control Keys
    'Space': 'KEY_SPACE',
    'Enter': 'KEY_ENTER',
    'Escape': 'KEY_ESC',
    'Tab': 'KEY_TAB',
    'Backspace': 'KEY_BACKSPACE',
    'Delete': 'KEY_DELETE',
    'Insert': 'KEY_INSERT',
    'Home': 'KEY_HOME',
    'End': 'KEY_END',
    'PageUp': 'KEY_PAGEUP',
    'PageDown': 'KEY_PAGEDOWN',
    
    # Arrow Keys
    'ArrowUp': 'KEY_UP',
    'ArrowDown': 'KEY_DOWN',
    'ArrowLeft': 'KEY_LEFT',
    'ArrowRight': 'KEY_RIGHT',
    
    # Modifiers
    'ShiftLeft': 'KEY_LEFTSHIFT',
    'ShiftRight': 'KEY_RIGHTSHIFT',
    'ControlLeft': 'KEY_LEFTCTRL',
    'ControlRight': 'KEY_RIGHTCTRL',
    'AltLeft': 'KEY_LEFTALT',
    'AltRight': 'KEY_RIGHTALT',
    'MetaLeft': 'KEY_LEFTMETA',
    'MetaRight': 'KEY_RIGHTMETA',
    
    # Already mapped uinput strings (in case viewer sends these directly)
    'KEY_A': 'KEY_A', 'KEY_B': 'KEY_B', 'KEY_C': 'KEY_C', 'KEY_D': 'KEY_D',
    'KEY_W': 'KEY_W', 'KEY_S': 'KEY_S', 'KEY_E': 'KEY_E', 'KEY_R': 'KEY_R',
    'KEY_Q': 'KEY_Q', 'KEY_F': 'KEY_F', 'KEY_Z': 'KEY_Z', 'KEY_X': 'KEY_X',
    'KEY_V': 'KEY_V', 'KEY_SPACE': 'KEY_SPACE', 'KEY_ENTER': 'KEY_ENTER', 'KEY_ESC': 'KEY_ESC',
    'KEY_LEFTSHIFT': 'KEY_LEFTSHIFT', 'KEY_LEFTCTRL': 'KEY_LEFTCTRL', 'KEY_TAB': 'KEY_TAB',
    
    # Mouse Buttons
    'BTN_LEFT': 'BTN_LEFT',
    'BTN_RIGHT': 'BTN_RIGHT',
    'BTN_MIDDLE': 'BTN_MIDDLE',
}


def flush_kbm_device(kbm, viewer_id):
    """
    Release all currently pressed keys/buttons for a viewer.
    Called on disconnect or panic toggle to prevent stuck keys.
    """
    if viewer_id not in kbm_pressed_keys:
        return
    
    pressed = kbm_pressed_keys[viewer_id]
    if not pressed:
        return
    
    try:
        for key_code in list(pressed):
            try:
                if hasattr(uinput, key_code):
                    kbm.emit(getattr(uinput, key_code), 0, syn=False)
            except Exception as e:
                print(f"[input] Error releasing {key_code} for {viewer_id}: {e}", flush=True)
        
        kbm.syn()
    except Exception as e:
        print(f"[input] Error flushing KBM for {viewer_id}: {e}", flush=True)
    finally:
        kbm_pressed_keys[viewer_id] = set()
        print(f"[input] Flushed all KBM keys for {viewer_id}", flush=True)


def handle_kbm_raw(kbm, viewer_id, msg):
    """
    Handle Raw KBM mode with robust key mapping, panic support, and stuck-key prevention.
    """
    global panic_mode

    if panic_mode:
        return

    event_type = msg.get("event")

    if event_type == "mousemove":
        dx = msg.get("dx", 0)
        dy = msg.get("dy", 0)
        if dx != 0 or dy != 0:
            try:
                kbm.emit(uinput.REL_X, dx, syn=False)
                kbm.emit(uinput.REL_Y, dy, syn=False)
                kbm.syn()
            except Exception as e:
                print(f"[input] Mouse move error for {viewer_id}: {e}", flush=True)
        return

    if event_type not in ["keydown", "keyup"]:
        return

    key_code_input = msg.get("key", "")
    key_code = JS_TO_UINPUT_MAP.get(key_code_input, key_code_input)

    if not hasattr(uinput, key_code):
        print(f"[input] Unknown key code: {key_code_input} (no uinput mapping) for {viewer_id}", flush=True)
        return

    if viewer_id not in kbm_pressed_keys:
        kbm_pressed_keys[viewer_id] = set()

    try:
        if event_type == "keydown":
            value = 1
            kbm_pressed_keys[viewer_id].add(key_code)
        else:
            value = 0
            kbm_pressed_keys[viewer_id].discard(key_code)

        kbm.emit(getattr(uinput, key_code), value, syn=False)
        kbm.syn()
    except Exception as e:
        print(f"[input] KBM emit error for {viewer_id} key {key_code}: {e}", flush=True)


def run():
    """Main input loop for Linux uinput backend."""
    global force_xboxone, enable_dualshock, enable_motion, panic_mode

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)

            if msg.get("type") == "panic_toggle":
                panic_mode = msg.get("enabled", False)
                if panic_mode:
                    print("[input] PANIC MODE ENABLED - All KBM input frozen", flush=True)
                    for viewer_id, kbm in list(kbm_devices.items()):
                        flush_kbm_device(kbm, viewer_id)
                else:
                    print("[input] Panic mode disabled", flush=True)
                continue

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
                full_id = str(msg.get("viewerId", ""))
                vid = full_id.split("_")[0]
                mode = msg.get("mode", "gamepad")
                viewer_modes[vid] = mode
                print(f"[input] Viewer {vid} mode set to: {mode}", flush=True)
                if mode == "disabled":
                    for k, gp in list(devices.items()):
                        if str(k).startswith(vid + "_") or str(k) == vid:
                            flush_neutral_for_device(gp)
                    for k, kbm in list(kbm_devices.items()):
                        if str(k).startswith(vid + "_") or str(k) == vid:
                            flush_kbm_device(kbm, vid)
                            flush_neutral_for_device(kbm, is_kbm=True)
                continue

            if msg.get("type") in ["flush_neutral", "disconnect_viewer"]:
                vid = str(msg.get("viewer_id", ""))
                keys = [k for k in devices.keys() if str(k).startswith(vid + "_") or str(k) == vid]
                for k in keys:
                    if msg.get("type") == "flush_neutral":
                        flush_neutral_for_device(devices[k])
                    else:
                        del devices[k]
                        device_profiles.pop(k, None)
                kbm_keys = [k for k in kbm_devices.keys() if str(k).startswith(vid + "_") or str(k) == vid]
                for k in kbm_keys:
                    if msg.get("type") == "flush_neutral":
                        flush_kbm_device(kbm_devices[k], k)
                        flush_neutral_for_device(kbm_devices[k], is_kbm=True)
                    else:
                        flush_kbm_device(kbm_devices[k], k)
                        del kbm_devices[k]
                continue

            pad_id = str(msg.get("pad_id", "default"))
            vid = str(msg.get("viewer_id", pad_id.split("_")[0]))
            current_mode = viewer_modes.get(vid, "gamepad")

            if current_mode == "disabled":
                continue

            if msg.get("type") == "gpid":
                profile = detect_profile(str(msg.get("id", "")))
                if pad_id not in device_profiles or device_profiles[pad_id] != profile:
                    try:
                        devices[pad_id] = make_gamepad(profile)
                        device_profiles[pad_id] = profile
                        print(f"[input] [{pad_id}] Created gamepad: {PROFILES[profile]['name']}", flush=True)
                    except Exception as e:
                        print(f"[input] Device error: {e}", flush=True)
                continue

            if msg.get("type") == "gamepad" and current_mode == "gamepad":
                if pad_id not in devices:
                    fallback = "xboxone" if force_xboxone else "xbox"
                    devices[pad_id] = make_gamepad(fallback)
                    device_profiles[pad_id] = fallback

                gp = devices[pad_id]
                btns = msg.get("buttons", [])
                axes = msg.get("axes", [])

                for w3c_idx, btn_event in W3C_MAPPING.items():
                    if w3c_idx < len(btns):
                        gp.emit(btn_event, 1 if btns[w3c_idx]["pressed"] else 0, syn=False)

                if len(axes) >= 4:
                    gp.emit(uinput.ABS_X,  apply_deadzone(axes[0], AXIS_DEADZONE), syn=False)
                    gp.emit(uinput.ABS_Y,  apply_deadzone(axes[1], AXIS_DEADZONE), syn=False)
                    gp.emit(uinput.ABS_RX, apply_deadzone(axes[2], AXIS_DEADZONE), syn=False)
                    gp.emit(uinput.ABS_RY, apply_deadzone(axes[3], AXIS_DEADZONE), syn=False)

                if len(btns) >= 8:
                    gp.emit(uinput.ABS_Z,  btns[6].get("value", 0), syn=False)
                    gp.emit(uinput.ABS_RZ, btns[7].get("value", 0), syn=False)

                if len(btns) >= 16:
                    hat_x = max(-1, min(1,
                        (1 if btns[15]["pressed"] else 0) - (1 if btns[14]["pressed"] else 0)
                    ))
                    hat_y = max(-1, min(1,
                        (1 if btns[13]["pressed"] else 0) - (1 if btns[12]["pressed"] else 0)
                    ))
                    gp.emit(uinput.ABS_HAT0X, hat_x, syn=False)
                    gp.emit(uinput.ABS_HAT0Y, hat_y, syn=False)
                gp.syn()

            if msg.get("type") in ("kbm", "keyboard"):
                if pad_id not in kbm_devices:
                    try:
                        kbm_devices[pad_id] = make_kbm(pad_id)
                        print(f"[input] [{pad_id}] Created KBM device", flush=True)
                    except Exception as e:
                        print(f"[input] KBM device error: {e}", flush=True)
                        continue

                kbm = kbm_devices[pad_id]
                event_type = msg.get("event")

                if current_mode == "kbm":
                    handle_kbm_raw(kbm, vid, msg)

                elif current_mode == "kbm_emulated":
                    if event_type == "mousemove" and kbm_binds.get("right_stick_mouse", True):
                        if pad_id not in devices:
                            fallback = "xboxone" if force_xboxone else "xbox"
                            devices[pad_id] = make_gamepad(fallback)
                            device_profiles[pad_id] = fallback
                        mult = kbm_binds.get("right_stick_multiplier", 1500)
                        rx = max(-32767, min(32767, msg.get("dx", 0) * mult))
                        ry = max(-32767, min(32767, msg.get("dy", 0) * mult))
                        devices[pad_id].emit(uinput.ABS_RX, int(rx), syn=False)
                        devices[pad_id].emit(uinput.ABS_RY, int(ry), syn=False)
                        devices[pad_id].syn()

                    if event_type in ["keydown", "keyup"]:
                        if pad_id not in devices:
                            fallback = "xboxone" if force_xboxone else "xbox"
                            devices[pad_id] = make_gamepad(fallback)
                            device_profiles[pad_id] = fallback
                        gp = devices[pad_id]
                        key = msg.get("key")
                        is_down = 1 if event_type == "keydown" else 0

                        if key in kbm_binds.get("buttons", {}):
                            target_btn = kbm_binds["buttons"][key]
                            if hasattr(uinput, target_btn):
                                gp.emit(getattr(uinput, target_btn), is_down)

                        if key in kbm_binds.get("left_stick", {}):
                            mapping = kbm_binds["left_stick"][key]
                            target_axis = mapping["axis"]
                            val = mapping["val"] if is_down else 0
                            if hasattr(uinput, target_axis):
                                gp.emit(getattr(uinput, target_axis), val)

                        if key in kbm_binds.get("dpad", {}):
                            mapping = kbm_binds["dpad"][key]
                            target_axis = mapping["axis"]
                            val = mapping["val"] if is_down else 0
                            if hasattr(uinput, target_axis):
                                gp.emit(getattr(uinput, target_axis), val)

        except json.JSONDecodeError:
            pass
        except Exception as e:
            print(f"[input] Error processing message: {e}", flush=True)
